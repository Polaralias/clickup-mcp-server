import { z } from "zod";
import { ListTagsForSpaceInput, ListTagsForSpaceOutput, TagItem } from "../../../mcp/tools/schemas/hierarchy.js";
import { characterLimit } from "../../../config/runtime.js";
import { err, ok, Result } from "../../../shared/Result.js";
import { mapHttpError } from "../../../shared/Errors.js";
import type { ClickUpGateway } from "../../../infrastructure/clickup/ClickUpGateway.js";

type InputType = z.infer<typeof ListTagsForSpaceInput>;
type OutputType = z.infer<typeof ListTagsForSpaceOutput>;
type TagItemType = z.infer<typeof TagItem>;

type HttpErrorLike = { status?: number; data?: unknown };

function toStringValue(value: unknown): string | null {
  if (typeof value === "string") {
    return value;
  }
  if (typeof value === "number" || typeof value === "boolean" || typeof value === "bigint") {
    return String(value);
  }
  return null;
}

function shrinkLongestName(items: TagItemType[]): boolean {
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

function parseTags(payload: unknown): TagItemType[] {
  const record = payload as Record<string, unknown> | null | undefined;
  const rawTags: unknown[] = [];
  if (Array.isArray(record?.tags)) {
    rawTags.push(...(record?.tags as unknown[]));
  }
  const items: TagItemType[] = [];
  for (const entry of rawTags) {
    const tag = entry as Record<string, unknown> | null | undefined;
    const nameValue = tag?.name ?? tag?.tag_name ?? tag?.tagName;
    const name = toStringValue(nameValue);
    if (name === null) {
      continue;
    }
    const fg = toStringValue(tag?.tag_fg ?? tag?.fg ?? tag?.color ?? null);
    const bg = toStringValue(tag?.tag_bg ?? tag?.bg ?? tag?.background ?? null);
    const element: TagItemType = { name };
    if (typeof fg === "string") {
      element.tag_fg = fg;
    }
    if (typeof bg === "string") {
      element.tag_bg = bg;
    }
    items.push(element);
  }
  return items;
}

export class Tags {
  constructor(private readonly gateway: ClickUpGateway) {}

  async execute(ctx: unknown, input: InputType): Promise<Result<OutputType>> {
    void ctx;
    const parsed = ListTagsForSpaceInput.safeParse(input ?? {});
    if (!parsed.success) {
      return err("INVALID_PARAMETER", "Invalid parameters", parsed.error.flatten());
    }
    const data = parsed.data;
    try {
      const response = await this.gateway.list_tags_for_space(data.spaceId);
      const results = parseTags(response);
      const out: OutputType = { spaceId: data.spaceId, results };
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

export { parseTags };
