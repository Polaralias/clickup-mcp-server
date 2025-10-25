import { z } from "zod";
import { ListFoldersInput, ListFoldersOutput, FolderItem } from "../../../mcp/tools/schemas/hierarchy.js";
import { characterLimit } from "../../../config/runtime.js";
import { err, ok, Result } from "../../../shared/Result.js";
import { mapHttpError } from "../../../shared/httpErrors.js";
import type { ClickUpGateway } from "../../../infrastructure/clickup/ClickUpGateway.js";

type InputType = z.infer<typeof ListFoldersInput>;
type OutputType = z.infer<typeof ListFoldersOutput>;
type FolderItemType = z.infer<typeof FolderItem>;

type HttpErrorLike = { status?: number; data?: unknown };

type ParsedFolders = { items: FolderItemType[]; total: number | null };

function toStringId(value: unknown): string | null {
  if (typeof value === "string") {
    return value;
  }
  if (typeof value === "number" || typeof value === "boolean" || typeof value === "bigint") {
    return String(value);
  }
  return null;
}

function toInt(value: unknown): number | null {
  if (typeof value === "number" && Number.isFinite(value)) {
    return Math.trunc(value);
  }
  if (typeof value === "string" && value.trim().length > 0) {
    const parsed = Number.parseInt(value, 10);
    if (Number.isFinite(parsed)) {
      return parsed;
    }
  }
  return null;
}

function toBooleanValue(value: unknown): boolean | null {
  if (typeof value === "boolean") {
    return value;
  }
  if (typeof value === "number") {
    if (value === 1) {
      return true;
    }
    if (value === 0) {
      return false;
    }
  }
  if (typeof value === "string") {
    const lower = value.toLowerCase();
    if (lower === "true" || lower === "1" || lower === "yes") {
      return true;
    }
    if (lower === "false" || lower === "0" || lower === "no") {
      return false;
    }
  }
  return null;
}

function shrinkLongestName(items: FolderItemType[]): boolean {
  let index = -1;
  let maxLength = -1;
  for (let i = 0; i < items.length; i += 1) {
    const name = items[i]?.name;
    if (typeof name === "string" && name.length > maxLength) {
      index = i;
      maxLength = name.length;
    }
  }
  if (index === -1 || maxLength <= 1) {
    return false;
  }
  const current = items[index]?.name;
  if (typeof current !== "string") {
    return false;
  }
  const nextLength = Math.max(0, Math.floor(current.length / 2));
  items[index].name = current.slice(0, nextLength);
  return true;
}

function enforceLimit(out: OutputType): void {
  const limit = characterLimit();
  let payload = JSON.stringify(out);
  if (payload.length <= limit) {
    return;
  }
  let truncated = false;
  while (payload.length > limit) {
    if (!shrinkLongestName(out.results)) {
      break;
    }
    truncated = true;
    payload = JSON.stringify(out);
  }
  if (payload.length > limit) {
    truncated = true;
  }
  if (truncated) {
    out.truncated = true;
    out.guidance = "Output trimmed to character_limit";
  }
}

function parseFolders(payload: unknown): ParsedFolders {
  const record = payload as Record<string, unknown> | null | undefined;
  const rawFolders: unknown[] = [];
  if (Array.isArray(record?.folders)) {
    rawFolders.push(...(record?.folders as unknown[]));
  }
  const spaceRecord = record?.space as Record<string, unknown> | null | undefined;
  if (Array.isArray(spaceRecord?.folders)) {
    rawFolders.push(...(spaceRecord?.folders as unknown[]));
  }
  const items: FolderItemType[] = [];
  for (const entry of rawFolders) {
    const folder = entry as Record<string, unknown> | null | undefined;
    const idValue = folder?.id ?? folder?.folder_id ?? folder?.folderId;
    const nameValue = folder?.name ?? folder?.folder_name ?? folder?.folderName;
    const id = toStringId(idValue);
    const name = toStringId(nameValue);
    if (id === null || name === null) {
      continue;
    }
    const archivedValue = toBooleanValue(folder?.archived ?? folder?.is_archived ?? folder?.isArchived ?? null);
    const element: FolderItemType = { id, name };
    if (archivedValue !== null) {
      element.archived = archivedValue;
    }
    items.push(element);
  }
  const paginationRecord = record?.pagination as Record<string, unknown> | null | undefined;
  const pagesRecord = record?.pages as Record<string, unknown> | null | undefined;
  const totalCandidates = [record?.total, paginationRecord?.total, pagesRecord?.total];
  let total: number | null = null;
  for (const candidate of totalCandidates) {
    const numeric = toInt(candidate);
    if (numeric !== null) {
      total = numeric;
      break;
    }
  }
  return { items, total };
}

export class Folders {
  constructor(private readonly gateway: ClickUpGateway) {}

  async execute(ctx: unknown, input: InputType): Promise<Result<OutputType>> {
    void ctx;
    const parsed = ListFoldersInput.safeParse(input ?? {});
    if (!parsed.success) {
      return err("INVALID_PARAMETER", "Invalid parameters", parsed.error.flatten());
    }
    const data = parsed.data;
    try {
      const response = await this.gateway.list_folders(data.spaceId, data.page, data.limit, data.includeArchived);
      const parsedData = parseFolders(response);
      const results = parsedData.items;
      const total = parsedData.total ?? results.length;
      const hasMore = parsedData.total !== null ? (data.page + 1) * data.limit < parsedData.total : results.length === data.limit;
      const out: OutputType = { total, page: data.page, limit: data.limit, hasMore, results };
      enforceLimit(out);
      return ok(out, out.truncated === true, out.guidance);
    } catch (error) {
      const httpError = error as HttpErrorLike;
      if (httpError && typeof httpError.status === "number") {
        const mapped = mapHttpError(httpError.status, httpError.data);
        return err(mapped.code, mapped.message, mapped.details);
      }
      const message = error instanceof Error ? error.message : String(error);
      return err("UNKNOWN", message);
    }
  }
}

export { parseFolders };
