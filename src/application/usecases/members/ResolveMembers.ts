import { z } from "zod";
import { ResolveMembersInput, ResolveMembersOutput, MemberItem } from "../../../mcp/tools/schemas/hierarchy.js";
import { characterLimit } from "../../../config/runtime.js";
import { err, ok, Result } from "../../../shared/Result.js";
import { mapHttpError } from "../../../shared/Errors.js";
import type { ClickUpGateway } from "../../../infrastructure/clickup/ClickUpGateway.js";
import { parseMembers } from "./Members.js";

type InputType = z.infer<typeof ResolveMembersInput>;
type OutputType = z.infer<typeof ResolveMembersOutput>;
type MemberItemType = z.infer<typeof MemberItem>;

type HttpErrorLike = { status?: number; data?: unknown };

type ResolvedEntry = { query: string; matches: MemberItemType[] };

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

function shrinkResolved(resolved: ResolvedEntry[]): boolean {
  for (const entry of resolved) {
    if (shrinkMemberStrings(entry.matches)) {
      return true;
    }
  }
  return false;
}

function enforceLimit(out: OutputType): void {
  const limit = characterLimit();
  let payload = JSON.stringify(out);
  if (payload.length <= limit) {
    return;
  }
  let truncated = false;
  while (payload.length > limit) {
    if (!shrinkResolved(out.resolved)) {
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

function matchesQuery(item: MemberItemType, query: string): boolean {
  const values: (string | null)[] = [item.username ?? null, item.email ?? null, item.initials ?? null];
  for (const value of values) {
    if (typeof value === "string" && value.toLowerCase().includes(query)) {
      return true;
    }
  }
  return false;
}

export class ResolveMembers {
  constructor(private readonly gateway: ClickUpGateway) {}

  async execute(ctx: unknown, input: InputType): Promise<Result<OutputType>> {
    void ctx;
    const parsed = ResolveMembersInput.safeParse(input ?? {});
    if (!parsed.success) {
      return err("INVALID_PARAMETER", "Invalid parameters", parsed.error.flatten());
    }
    const data = parsed.data;
    try {
      const allMembers: MemberItemType[] = [];
      const limit = 100;
      let page = 0;
      while (true) {
        const response = await this.gateway.list_members(data.teamId, page, limit);
        const parsedPage = parseMembers(response);
        allMembers.push(...parsedPage.items);
        const hasMore = parsedPage.total !== null ? (page + 1) * limit < parsedPage.total : parsedPage.items.length === limit;
        if (!hasMore || parsedPage.items.length === 0) {
          break;
        }
        page += 1;
        if (page >= 100) {
          break;
        }
      }
      const resolved: ResolvedEntry[] = [];
      for (const rawQuery of data.queries) {
        const trimmed = rawQuery.trim();
        const query = trimmed.length > 0 ? trimmed : rawQuery;
        const queryLower = query.toLowerCase();
        const matches: MemberItemType[] = [];
        for (const member of allMembers) {
          if (matches.length >= 5) {
            break;
          }
          if (matchesQuery(member, queryLower)) {
            matches.push({ id: member.id, username: member.username ?? null, email: member.email ?? null, initials: member.initials ?? null });
          }
        }
        resolved.push({ query, matches });
      }
      const out: OutputType = { resolved };
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
