import { z } from "zod";
import { BulkDocSearchInput, BulkDocSearchOutput, DocSearchInput, DocSearchOutput, DocSearchItem } from "../../mcp/tools/schemas/doc.js";
import { Result, ok, err } from "../../shared/Result.js";
import { characterLimit, maxBulkConcurrency } from "../../config/runtime.js";
import { BulkProcessor, type WorkItem } from "../services/BulkProcessor.js";
import type { ClickUpGateway } from "../../infrastructure/clickup/ClickUpGateway.js";
import type { ApiCache } from "../../infrastructure/cache/ApiCache.js";
import { DocSearch } from "./DocSearch.js";
import { createLogger } from "../../shared/logging.js";

type DocSearchOutputType = z.infer<typeof DocSearchOutput>;
type DocSearchItemType = z.infer<typeof DocSearchItem>;
type BulkDocSearchOutputType = z.infer<typeof BulkDocSearchOutput>;
type DocSearchInputType = z.infer<typeof DocSearchInput>;

type FailureCodeMap = Map<number, string | undefined>;

type QuerySuccess = { index: number; q: string; out: DocSearchOutputType };

function shortenField(items: DocSearchItemType[], field: "snippet" | "title"): boolean {
  let index = -1;
  let maxLength = -1;
  for (let i = 0; i < items.length; i += 1) {
    const value = items[i][field];
    if (typeof value === "string" && value.length > maxLength) {
      index = i;
      maxLength = value.length;
    }
  }
  if (index === -1 || maxLength <= 0) {
    return false;
  }
  const source = items[index][field];
  if (typeof source !== "string") {
    return false;
  }
  const nextLength = Math.floor(source.length / 2);
  items[index][field] = nextLength > 0 ? source.slice(0, nextLength) : "";
  return true;
}

function collectItems(out: BulkDocSearchOutputType): DocSearchItemType[] {
  const set = new Set<DocSearchItemType>();
  for (const item of out.union.results) {
    set.add(item);
  }
  for (const value of Object.values(out.perQuery)) {
    for (const item of value.results) {
      set.add(item);
    }
  }
  return Array.from(set.values());
}

function enforceLimit(out: BulkDocSearchOutputType): void {
  const limit = characterLimit();
  let payload = JSON.stringify(out);
  if (payload.length <= limit) {
    return;
  }
  const items = collectItems(out);
  let truncated = false;
  while (payload.length > limit) {
    if (!shortenField(items, "snippet")) {
      break;
    }
    truncated = true;
    payload = JSON.stringify(out);
  }
  while (payload.length > limit) {
    if (!shortenField(items, "title")) {
      break;
    }
    truncated = true;
    payload = JSON.stringify(out);
  }
  if (truncated) {
    out.truncated = true;
    out.guidance = "Output trimmed to character_limit";
  }
}

function normaliseQueries(values: string[]): string[] {
  const seen = new Set<string>();
  const result: string[] = [];
  for (const value of values) {
    const normalised = value.trim().toLowerCase();
    if (normalised.length === 0) {
      continue;
    }
    if (seen.has(normalised)) {
      continue;
    }
    seen.add(normalised);
    result.push(normalised);
  }
  return result;
}

function scoreValue(score: number | null): number {
  if (typeof score === "number" && Number.isFinite(score)) {
    return score;
  }
  return Number.NEGATIVE_INFINITY;
}

function timeValue(value: string | null): number {
  if (typeof value === "string") {
    const parsed = Date.parse(value);
    if (!Number.isNaN(parsed)) {
      return parsed;
    }
  }
  return Number.NEGATIVE_INFINITY;
}

function makeKeyGenerator() {
  let fallback = 0;
  return (item: DocSearchItemType) => {
    if (item.pageId && item.pageId.length > 0) {
      return item.pageId;
    }
    if (item.docId && item.docId.length > 0) {
      return `doc:${item.docId}`;
    }
    const key = `auto:${fallback}`;
    fallback += 1;
    return key;
  };
}

function buildUnion(outputs: DocSearchOutputType[]): DocSearchItemType[] {
  const selector = makeKeyGenerator();
  const map = new Map<string, { item: DocSearchItemType; score: number; updatedAt: number }>();
  for (const output of outputs) {
    for (const item of output.results) {
      const key = selector(item);
      const currentScore = scoreValue(item.score);
      const currentTime = timeValue(item.updatedAt ?? null);
      const existing = map.get(key);
      if (!existing) {
        map.set(key, { item, score: currentScore, updatedAt: currentTime });
        continue;
      }
      if (currentScore > existing.score || (currentScore === existing.score && currentTime > existing.updatedAt)) {
        map.set(key, { item, score: currentScore, updatedAt: currentTime });
      }
    }
  }
  const union = Array.from(map.values()).map(entry => entry.item);
  union.sort((a, b) => {
    const scoreDiff = scoreValue(b.score) - scoreValue(a.score);
    if (scoreDiff !== 0) {
      return scoreDiff > 0 ? 1 : -1;
    }
    const timeDiff = timeValue(b.updatedAt ?? null) - timeValue(a.updatedAt ?? null);
    if (timeDiff !== 0) {
      return timeDiff > 0 ? 1 : -1;
    }
    const aKey = `${a.pageId}|${a.docId}`;
    const bKey = `${b.pageId}|${b.docId}`;
    if (aKey < bKey) {
      return -1;
    }
    if (aKey > bKey) {
      return 1;
    }
    return 0;
  });
  return union;
}

export class BulkDocSearch {
  private readonly docSearch: DocSearch;

  constructor(private readonly gateway: ClickUpGateway, private readonly cache: ApiCache) {
    this.docSearch = new DocSearch(gateway, cache);
  }

  async execute(ctx: unknown, input: z.infer<typeof BulkDocSearchInput>): Promise<Result<z.infer<typeof BulkDocSearchOutput>>> {
    const parsed = BulkDocSearchInput.safeParse(input);
    if (!parsed.success) {
      return err("INVALID_PARAMETER", "Invalid parameters", parsed.error.flatten());
    }
    const data = parsed.data;
    const limit = data.options.limit ?? 20;
    const page = data.options.page ?? 0;
    const concurrencyCap = Math.max(1, maxBulkConcurrency());
    const requestedConcurrency = Math.max(Math.trunc(data.options.concurrency ?? 5), 1);
    if (requestedConcurrency > concurrencyCap) {
      return err(
        "LIMIT_EXCEEDED",
        `Requested concurrency ${requestedConcurrency} exceeds cap ${concurrencyCap}`
      );
    }
    const concurrency = Math.min(requestedConcurrency, concurrencyCap);
    const retryCount = Math.min(Math.max(Math.trunc(data.options.retryCount ?? 2), 0), 6);
    const retryDelayMs = data.options.retryDelayMs ?? 200;
    const exponentialBackoff = data.options.exponentialBackoff ?? true;
    const continueOnError = data.options.continueOnError ?? true;
    const queries = normaliseQueries(data.queries);
    if (queries.length === 0) {
      const empty: BulkDocSearchOutputType = { perQuery: {}, union: { results: [], dedupedCount: 0 }, failed: [] };
      return ok(empty, false);
    }
    const logger = createLogger("application.bulk_doc_search");
    const processor = new BulkProcessor(logger);
    const failures: FailureCodeMap = new Map();
    const workItems: WorkItem<QuerySuccess>[] = queries.map((query, index) => {
      return async () => {
        const request: DocSearchInputType = {
          workspaceId: data.workspaceId,
          query,
          limit,
          page,
          expandPages: false
        };
        const result = await this.docSearch.execute(ctx, request);
        if (result.isError) {
          failures.set(index, result.code);
          throw new Error(result.message);
        }
        return { index, q: query, out: result.data };
      };
    });
    const batch = await processor.run(workItems, {
      concurrency,
      retryCount,
      retryDelayMs,
      exponentialBackoff,
      continueOnError
    });
    const successes = batch.successful;
    const perQuery: Record<string, DocSearchOutputType> = {};
    for (const entry of successes) {
      perQuery[entry.q] = entry.out;
    }
    const failed = batch.failed.map(item => {
      const code = failures.get(item.index);
      return code ? { query: queries[item.index], error: item.error, code } : { query: queries[item.index], error: item.error };
    });
    const unionResults = buildUnion(successes.map(entry => entry.out));
    const out: BulkDocSearchOutputType = {
      perQuery,
      union: { results: unionResults, dedupedCount: unionResults.length },
      failed
    };
    enforceLimit(out);
    return ok(out, out.truncated === true, out.guidance);
  }
}
