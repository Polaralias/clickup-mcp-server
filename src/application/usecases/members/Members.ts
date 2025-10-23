import { z } from "zod";
import { ListMembersInput, ListMembersOutput, MemberItem } from "../../../mcp/tools/schemas/hierarchy.js";
import { characterLimit } from "../../../config/runtime.js";
import { err, ok, Result } from "../../../shared/Result.js";
import { mapHttpError } from "../../../shared/Errors.js";
import type { ClickUpGateway } from "../../../infrastructure/clickup/ClickUpGateway.js";

type InputType = z.infer<typeof ListMembersInput>;
type OutputType = z.infer<typeof ListMembersOutput>;
type MemberItemType = z.infer<typeof MemberItem>;

type HttpErrorLike = { status?: number; data?: unknown };

type ParsedMembers = { items: MemberItemType[]; total: number | null };

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

function toOptionalString(value: unknown): string | null {
  if (typeof value === "string") {
    const trimmed = value.trim();
    if (trimmed.length > 0) {
      return trimmed;
    }
    return null;
  }
  return null;
}

function shrinkMemberStrings(items: MemberItemType[]): boolean {
  let index = -1;
  let field: "username" | "email" | "initials" | null = null;
  let maxLength = -1;
  for (let i = 0; i < items.length; i += 1) {
    const candidate = items[i];
    if (!candidate) {
      continue;
    }
    for (const key of ["username", "email", "initials"] as const) {
      const value = candidate[key];
      if (typeof value === "string" && value.length > maxLength) {
        index = i;
        field = key;
        maxLength = value.length;
      }
    }
  }
  if (index === -1 || field === null || maxLength <= 1) {
    return false;
  }
  const current = items[index][field];
  if (typeof current !== "string") {
    return false;
  }
  const nextLength = Math.max(0, Math.floor(current.length / 2));
  items[index][field] = current.slice(0, nextLength);
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
    if (!shrinkMemberStrings(out.results)) {
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

function parseMembers(payload: unknown): ParsedMembers {
  const record = payload as Record<string, unknown> | null | undefined;
  const rawMembers: unknown[] = [];
  if (Array.isArray(record?.members)) {
    rawMembers.push(...(record?.members as unknown[]));
  }
  const teamRecord = record?.team as Record<string, unknown> | null | undefined;
  if (Array.isArray(teamRecord?.members)) {
    rawMembers.push(...(teamRecord?.members as unknown[]));
  }
  const items: MemberItemType[] = [];
  for (const entry of rawMembers) {
    const member = entry as Record<string, unknown> | null | undefined;
    const userRecord = member?.user as Record<string, unknown> | null | undefined;
    const idValue = userRecord?.id ?? member?.id ?? member?.user_id ?? member?.userId;
    const id = toInt(idValue);
    if (id === null) {
      continue;
    }
    const username = toOptionalString(userRecord?.username ?? member?.username ?? null);
    const email = toOptionalString(userRecord?.email ?? member?.email ?? null);
    const initials = toOptionalString(userRecord?.initials ?? member?.initials ?? null);
    const element: MemberItemType = {
      id,
      username: username ?? null,
      email: email ?? null,
      initials: initials ?? null
    };
    items.push(element);
  }
  const paginationRecord = record?.pagination as Record<string, unknown> | null | undefined;
  const pagesRecord = record?.pages as Record<string, unknown> | null | undefined;
  const totalCandidates = [record?.total, paginationRecord?.total, pagesRecord?.total, teamRecord?.total_members];
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

export class Members {
  constructor(private readonly gateway: ClickUpGateway) {}

  async execute(ctx: unknown, input: InputType): Promise<Result<OutputType>> {
    void ctx;
    const parsed = ListMembersInput.safeParse(input ?? {});
    if (!parsed.success) {
      return err("INVALID_PARAMETER", "Invalid parameters", parsed.error.flatten());
    }
    const data = parsed.data;
    try {
      const response = await this.gateway.list_members(data.teamId, data.page, data.limit);
      const parsedData = parseMembers(response);
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

export { parseMembers };
