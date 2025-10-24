import { describe, it, expect, beforeEach, afterEach, vi } from "vitest";
import "./setup.js";
import { BulkProcessor, type WorkItem } from "../src/application/services/BulkProcessor.js";
import { createLogger } from "../src/shared/logging.js";

type BatchLog = {
  event: string;
  total?: number;
  succeeded?: number;
  failed?: number;
  in_flight?: number;
  index?: number;
  attempt?: number;
  delayMs?: number;
  durationMs?: number;
};

describe("BulkProcessor", () => {
  let events: BatchLog[];
  let originalWrite: typeof process.stdout.write;

  beforeEach(() => {
    events = [];
    originalWrite = process.stdout.write;
    process.stdout.write = ((chunk: string | Uint8Array, encoding?: BufferEncoding | ((err?: Error | null) => void), cb?: (err?: Error | null) => void) => {
      const text =
        typeof chunk === "string"
          ? chunk
          : Buffer.from(chunk).toString(typeof encoding === "string" ? encoding : "utf8");
      for (const line of text.split("\n")) {
        if (!line) {
          continue;
        }
        try {
          const parsed = JSON.parse(line) as Record<string, unknown>;
          if (parsed.msg === "batch_event" && typeof parsed.event === "string") {
            events.push(parsed as BatchLog);
          }
        } catch {}
      }
      const callback = typeof encoding === "function" ? encoding : cb;
      if (callback) {
        callback(null);
      }
      return true;
    }) as unknown as typeof process.stdout.write;
  });

  afterEach(() => {
    process.stdout.write = originalWrite;
  });

  it("controls concurrency", async () => {
    const logger = createLogger("tests.bulk_processor");
    const processor = new BulkProcessor(logger);
    const items: WorkItem<number>[] = Array.from({ length: 6 }, (_, index) => {
      return async () => {
        await new Promise<void>(resolve => setTimeout(resolve, 1000));
        return index;
      };
    });
    const promise = processor.run(items, { concurrency: 2, retryCount: 0 });
    const started = events.filter(entry => entry.event === "started");
    expect(started.length).toBe(1);
    await vi.advanceTimersByTimeAsync(1000);
    const progressAfterFirst = events.filter(entry => entry.event === "progress");
    const firstPhase = progressAfterFirst[progressAfterFirst.length - 1];
    expect(firstPhase?.succeeded).toBe(2);
    await vi.advanceTimersByTimeAsync(1000);
    await vi.advanceTimersByTimeAsync(1000);
    const result = await promise;
    expect(result.total).toBe(6);
    expect(result.failed.length).toBe(0);
    expect(result.successful).toEqual([0, 1, 2, 3, 4, 5]);
    const finished = events.filter(entry => entry.event === "finished");
    expect(finished.length).toBe(1);
    expect(finished[0].succeeded).toBe(6);
    expect(finished[0].failed).toBe(0);
  });

  it("retries on failure and succeeds", async () => {
    const logger = createLogger("tests.bulk_processor");
    const processor = new BulkProcessor(logger);
    let attempts = 0;
    const items: WorkItem<string>[] = [
      async () => {
        attempts += 1;
        if (attempts === 1) {
          throw new Error("temporary");
        }
        return "ok";
      }
    ];
    const promise = processor.run(items, { retryCount: 2, retryDelayMs: 200, exponentialBackoff: true });
    await vi.advanceTimersByTimeAsync(0);
    const retried = events.filter(entry => entry.event === "retried");
    expect(retried.length).toBe(1);
    expect(retried[0].index).toBe(0);
    expect(retried[0].attempt).toBe(0);
    expect(retried[0].delayMs).toBe(200);
    await vi.advanceTimersByTimeAsync(200);
    const result = await promise;
    expect(result.successful).toEqual(["ok"]);
    expect(result.failed.length).toBe(0);
    const finished = events.filter(entry => entry.event === "finished");
    expect(finished.length).toBe(1);
    expect(finished[0].succeeded).toBe(1);
    expect(finished[0].failed).toBe(0);
  });

  it("stops after first failure when continueOnError is false", async () => {
    const logger = createLogger("tests.bulk_processor");
    const processor = new BulkProcessor(logger);
    const started: number[] = [];
    const items: WorkItem<number>[] = [
      async () => {
        started.push(0);
        await new Promise<void>(resolve => setTimeout(resolve, 100));
        return 0;
      },
      async () => {
        started.push(1);
        throw new Error("fail");
      },
      async () => {
        started.push(2);
        await new Promise<void>(resolve => setTimeout(resolve, 100));
        return 2;
      }
    ];
    const promise = processor.run(items, { concurrency: 3, retryCount: 0, continueOnError: false });
    await vi.advanceTimersByTimeAsync(100);
    const result = await promise;
    expect(result.total).toBe(3);
    expect(result.successful).toEqual([0]);
    expect(result.failed.length).toBe(1);
    expect(result.failed[0].index).toBe(1);
    expect(started).not.toContain(2);
    const finished = events.filter(entry => entry.event === "finished");
    expect(finished.length).toBe(1);
    expect(finished[0].succeeded).toBe(1);
    expect(finished[0].failed).toBe(1);
  });
});
