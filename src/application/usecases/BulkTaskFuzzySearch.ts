import {
  BulkTaskFuzzySearchInput,
  BulkTaskFuzzySearchInputType,
  BulkTaskFuzzySearchOutputType,
  TaskFuzzySearchOutputType,
  TaskHitType
} from "../../mcp/tools/schemas/taskSearch.js";
import { Result, ok, err } from "../../shared/Result.js";
import { characterLimit } from "../../config/runtime.js";
import { TaskFuzzySearch } from "./TaskFuzzySearch.js";

type WorkItem<T> = () => Promise<T>;

type BatchResult<T> = {
  successful: { idx: number; data: T }[];
  failed: { index: number; error: string }[];
};

type FailureCodeMap = Map<number, string | undefined>;

type QueryResult = { index: number; query: string; output: TaskFuzzySearchOutputType };

async function runBatch<T>(items: WorkItem<T>[], concurrency: number): Promise<BatchResult<T>> {
  const successful: { idx: number; data: T }[] = [];
  const failed: { index: number; error: string }[] = [];
  if (items.length === 0) {
    return { successful: [], failed: [] };
  }
  const workerCount = Math.max(1, Math.min(concurrency, items.length));
  let cursor = 0;
  const workers: Promise<void>[] = [];
  const worker = async () => {
    while (true) {
      const current = cursor;
      if (current >= items.length) {
        return;
      }
      cursor += 1;
      const task = items[current];
      try {
        const value = await task();
        successful.push({ idx: current, data: value });
      } catch (error) {
        const message = error instanceof Error ? error.message : String(error);
        failed.push({ index: current, error: message });
      }
    }
  };
  for (let i = 0; i < workerCount; i += 1) {
    workers.push(worker());
  }
  await Promise.all(workers);
  successful.sort((a, b) => a.idx - b.idx);
  failed.sort((a, b) => a.index - b.index);
  return { successful, failed };
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
  return 1;
}

function timeValue(value: string | null): number {
  if (typeof value === "string") {
    const parsed = Date.parse(value);
    if (!Number.isNaN(parsed)) {
      return parsed;
    }
  }
  return 0;
}

function compareHits(a: TaskHitType, b: TaskHitType): number {
  const scoreDiff = scoreValue(a.score) - scoreValue(b.score);
  if (scoreDiff !== 0) {
    return scoreDiff;
  }
  const timeDiff = timeValue(b.updatedAt ?? null) - timeValue(a.updatedAt ?? null);
  if (timeDiff !== 0) {
    return timeDiff;
  }
  if (a.taskId < b.taskId) {
    return -1;
  }
  if (a.taskId > b.taskId) {
    return 1;
  }
  return 0;
}

function collectHits(out: BulkTaskFuzzySearchOutputType): TaskHitType[] {
  const set = new Set<TaskHitType>();
  for (const hit of out.union.results) {
    set.add(hit);
  }
  for (const value of Object.values(out.perQuery)) {
    for (const hit of value.results) {
      set.add(hit);
    }
  }
  return Array.from(set.values());
}

function shortenField(items: TaskHitType[], field: "snippet" | "name"): boolean {
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

function enforceLimit(out: BulkTaskFuzzySearchOutputType): void {
  const limit = characterLimit();
  let payload = JSON.stringify(out);
  if (payload.length <= limit) {
    return;
  }
  const items = collectHits(out);
  while (payload.length > limit) {
    if (!shortenField(items, "snippet")) {
      break;
    }
    payload = JSON.stringify(out);
  }
  while (payload.length > limit) {
    if (!shortenField(items, "name")) {
      break;
    }
    payload = JSON.stringify(out);
  }
  out.truncated = true;
  out.guidance = "Output trimmed to character_limit";
}

function buildUnion(results: QueryResult[]): TaskHitType[] {
  const map = new Map<string, { hit: TaskHitType; score: number; updatedAt: number }>();
  for (const result of results) {
    for (const hit of result.output.results) {
      const key = hit.taskId;
      const currentScore = scoreValue(hit.score);
      const currentTime = timeValue(hit.updatedAt ?? null);
      const existing = map.get(key);
      if (!existing) {
        map.set(key, { hit, score: currentScore, updatedAt: currentTime });
        continue;
      }
      if (currentScore < existing.score || (currentScore === existing.score && currentTime > existing.updatedAt)) {
        map.set(key, { hit, score: currentScore, updatedAt: currentTime });
      }
    }
  }
  const union = Array.from(map.values()).map(entry => entry.hit);
  union.sort(compareHits);
  return union;
}

export class BulkTaskFuzzySearch {
  constructor(private readonly inner: TaskFuzzySearch) {}

  async execute(ctx: unknown, input: BulkTaskFuzzySearchInputType): Promise<Result<BulkTaskFuzzySearchOutputType>> {
    const parsed = BulkTaskFuzzySearchInput.safeParse(input);
    if (!parsed.success) {
      return err("INVALID_PARAMETER", "Invalid parameters", parsed.error.flatten());
    }
    const data = parsed.data;
    const limit = data.options.limit ?? 20;
    const concurrency = Math.min(Math.max(data.options.concurrency ?? 5, 1), 10);
    const queries = normaliseQueries(data.queries);
    if (queries.length === 0) {
      const empty: BulkTaskFuzzySearchOutputType = { perQuery: {}, union: { results: [], dedupedCount: 0 }, failed: [] };
      return ok(empty, false);
    }
    const failures: FailureCodeMap = new Map();
    const workItems: WorkItem<QueryResult>[] = queries.map((query, index) => {
      return async () => {
        const result = await this.inner.execute(ctx, { query, scope: data.scope, limit });
        if (result.isError) {
          failures.set(index, result.code);
          throw new Error(result.message);
        }
        return { index, query, output: result.data };
      };
    });
    const batch = await runBatch(workItems, concurrency);
    const successes = batch.successful.map(entry => ({ index: entry.idx, query: entry.data.query, output: entry.data.output }));
    const perQuery: Record<string, TaskFuzzySearchOutputType> = {};
    for (const entry of successes) {
      perQuery[entry.query] = entry.output;
    }
    const failed = batch.failed.map(item => {
      const code = failures.get(item.index);
      if (code) {
        return { query: queries[item.index], error: item.error, code };
      }
      return { query: queries[item.index], error: item.error };
    });
    const unionResults = buildUnion(successes);
    const out: BulkTaskFuzzySearchOutputType = {
      perQuery,
      union: { results: unionResults, dedupedCount: unionResults.length },
      failed
    };
    enforceLimit(out);
    return ok(out, out.truncated === true, out.guidance);
  }
}
