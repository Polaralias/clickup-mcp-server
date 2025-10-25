import { z } from "zod";
import { ListListsInput, ListListsOutput, ListItem } from "../../../mcp/tools/schemas/hierarchy.js";
import { characterLimit } from "../../../config/runtime.js";
import { err, ok, Result } from "../../../shared/Result.js";
import { mapHttpError } from "../../../shared/httpErrors.js";
import type { ClickUpGateway } from "../../../infrastructure/clickup/ClickUpGateway.js";

type InputType = z.infer<typeof ListListsInput>;
type OutputType = z.infer<typeof ListListsOutput>;
type ListItemType = z.infer<typeof ListItem>;

type HttpErrorLike = { status?: number; data?: unknown };

type ParsedLists = { items: ListItemType[]; total: number | null };

function toStringId(value: unknown): string | null {
  if (typeof value === "string") {
    return value;
  }
  if (typeof value === "number" || typeof value === "boolean" || typeof value === "bigint") {
    return String(value);
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

function shrinkLongestName(items: ListItemType[]): boolean {
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

function parseLists(payload: unknown): ParsedLists {
  const record = payload as Record<string, unknown> | null | undefined;
  const rawLists: unknown[] = [];
  if (Array.isArray(record?.lists)) {
    rawLists.push(...(record?.lists as unknown[]));
  }
  const folderRecord = record?.folder as Record<string, unknown> | null | undefined;
  if (Array.isArray(folderRecord?.lists)) {
    rawLists.push(...(folderRecord?.lists as unknown[]));
  }
  const spaceRecord = record?.space as Record<string, unknown> | null | undefined;
  if (Array.isArray(spaceRecord?.lists)) {
    rawLists.push(...(spaceRecord?.lists as unknown[]));
  }
  const items: ListItemType[] = [];
  for (const entry of rawLists) {
    const list = entry as Record<string, unknown> | null | undefined;
    const idValue = list?.id ?? list?.list_id ?? list?.listId;
    const nameValue = list?.name ?? list?.list_name ?? list?.listName;
    const id = toStringId(idValue);
    const name = toStringId(nameValue);
    if (id === null || name === null) {
      continue;
    }
    const folderSource = list?.folder as Record<string, unknown> | null | undefined;
    const spaceSource = list?.space as Record<string, unknown> | null | undefined;
    const folderId = toStringId(list?.folder_id ?? list?.folderId ?? folderSource?.id ?? folderSource?.folder_id ?? folderSource?.folderId);
    const spaceId = toStringId(list?.space_id ?? list?.spaceId ?? spaceSource?.id ?? spaceSource?.space_id ?? spaceSource?.spaceId);
    const archivedValue = toBooleanValue(list?.archived ?? list?.is_archived ?? list?.isArchived ?? null);
    const element: ListItemType = { id, name };
    if (folderId !== null) {
      element.folderId = folderId;
    }
    if (spaceId !== null) {
      element.spaceId = spaceId;
    }
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

export class Lists {
  constructor(private readonly gateway: ClickUpGateway) {}

  async execute(ctx: unknown, input: InputType): Promise<Result<OutputType>> {
    void ctx;
    const parsed = ListListsInput.safeParse(input ?? {});
    if (!parsed.success) {
      return err("INVALID_PARAMETER", "Invalid parameters", parsed.error.flatten());
    }
    const data = parsed.data;
    try {
      const response = await this.gateway.list_lists_under(data.parentType, data.parentId, data.page, data.limit, data.includeArchived);
      const parsedData = parseLists(response);
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

export { parseLists };
