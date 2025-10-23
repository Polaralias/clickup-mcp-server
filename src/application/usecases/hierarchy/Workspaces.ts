import { z } from "zod";
import { ListWorkspacesInput, ListWorkspacesOutput, WorkspaceItem } from "../../../mcp/tools/schemas/hierarchy.js";
import { characterLimit } from "../../../config/runtime.js";
import { err, ok, Result } from "../../../shared/Result.js";
import { mapHttpError } from "../../../shared/Errors.js";
import type { ClickUpGateway } from "../../../infrastructure/clickup/ClickUpGateway.js";

type InputType = z.infer<typeof ListWorkspacesInput>;
type OutputType = z.infer<typeof ListWorkspacesOutput>;
type WorkspaceItemType = z.infer<typeof WorkspaceItem>;

type HttpErrorLike = { status?: number; data?: unknown };

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

function toStringValue(value: unknown): string | null {
  if (typeof value === "string") {
    return value;
  }
  if (typeof value === "number" || typeof value === "boolean" || typeof value === "bigint") {
    return String(value);
  }
  return null;
}

function toOptionalColor(value: unknown): string | null {
  if (typeof value === "string" && value.length > 0) {
    return value;
  }
  return null;
}

function shrinkLongestName(items: WorkspaceItemType[]): boolean {
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

function parseWorkspaces(payload: unknown): { items: WorkspaceItemType[]; total: number | null } {
  const record = payload as Record<string, unknown> | null | undefined;
  const rawTeams: unknown[] = [];
  if (Array.isArray(record?.teams)) {
    rawTeams.push(...(record?.teams as unknown[]));
  }
  if (record?.team && !Array.isArray(record?.teams)) {
    rawTeams.push(record.team as unknown);
  }
  const items: WorkspaceItemType[] = [];
  for (const entry of rawTeams) {
    const workspace = entry as Record<string, unknown> | null | undefined;
    const idValue = workspace?.id ?? workspace?.team_id ?? workspace?.teamId;
    const id = toInt(idValue);
    const nameValue = workspace?.name ?? workspace?.team_name ?? workspace?.teamName;
    const name = toStringValue(nameValue);
    if (id === null || name === null) {
      continue;
    }
    const colour = toOptionalColor(workspace?.color ?? workspace?.team_color ?? workspace?.teamColor ?? null);
    const element: WorkspaceItemType = { id, name };
    if (colour !== null) {
      element.color = colour;
    }
    items.push(element);
  }
  const totalValue = toInt(record?.total);
  return { items, total: totalValue };
}

export class Workspaces {
  constructor(private readonly gateway: ClickUpGateway) {}

  async execute(ctx: unknown, input: InputType): Promise<Result<OutputType>> {
    void ctx;
    const parsed = ListWorkspacesInput.safeParse(input ?? {});
    if (!parsed.success) {
      return err("INVALID_PARAMETER", "Invalid parameters", parsed.error.flatten());
    }
    try {
      const response = await this.gateway.list_workspaces(0, 100);
      const parsedData = parseWorkspaces(response);
      const results = parsedData.items;
      const total = parsedData.total ?? results.length;
      const out: OutputType = { total, page: 0, limit: results.length, hasMore: total > results.length, results };
      if (results.length === 0) {
        out.limit = 0;
        out.hasMore = false;
      }
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

export { parseWorkspaces };
