export type WorkItem<T> = () => Promise<T>;

export type BatchOptions = {
  concurrency: number;
  retryCount: number;
  retryDelayMs: number;
  exponentialBackoff: boolean;
  continueOnError: boolean;
};

export type BatchFailure = { index: number; error: string };

export type BatchResult<T> = { total: number; successful: T[]; failed: BatchFailure[] };

function clamp(value: number, min: number, max: number): number {
  if (value < min) {
    return min;
  }
  if (value > max) {
    return max;
  }
  return value;
}

function toInt(value: number | undefined, fallback: number): number {
  if (typeof value !== "number" || !Number.isFinite(value)) {
    return fallback;
  }
  return Math.trunc(value);
}

function wait(delay: number): Promise<void> {
  return new Promise(resolve => {
    setTimeout(resolve, delay);
  });
}

export class BulkProcessor {
  constructor(private readonly logger: { info: (msg: string, extras?: Record<string, unknown>) => void }) {}

  async run<T>(items: WorkItem<T>[], opts: Partial<BatchOptions>): Promise<BatchResult<T>> {
    const defaults: BatchOptions = {
      concurrency: 5,
      retryCount: 0,
      retryDelayMs: 200,
      exponentialBackoff: true,
      continueOnError: true
    };
    const total = items.length;
    const startTime = Date.now();
    const options: BatchOptions = {
      concurrency: clamp(toInt(opts.concurrency, defaults.concurrency), 1, 10),
      retryCount: clamp(toInt(opts.retryCount, defaults.retryCount), 0, 6),
      retryDelayMs: typeof opts.retryDelayMs === "number" && Number.isFinite(opts.retryDelayMs)
        ? opts.retryDelayMs
        : defaults.retryDelayMs,
      exponentialBackoff: opts.exponentialBackoff ?? defaults.exponentialBackoff,
      continueOnError: opts.continueOnError ?? defaults.continueOnError
    };
    const concurrencyLimit = options.continueOnError ? options.concurrency : 1;
    this.logger.info("batch_event", { event: "started", total });
    if (total === 0) {
      const durationMs = Date.now() - startTime;
      this.logger.info("batch_event", { event: "finished", total, succeeded: 0, failed: 0, durationMs });
      return { total, successful: [], failed: [] };
    }
    const successes: { index: number; value: T }[] = [];
    const failures: BatchFailure[] = [];
    let cursor = 0;
    let inFlight = 0;
    let stopped = false;
    let resolved = false;

    const finish = (resolve: (value: BatchResult<T>) => void) => {
      if (resolved) {
        return;
      }
      resolved = true;
      successes.sort((a, b) => a.index - b.index);
      failures.sort((a, b) => a.index - b.index);
      const durationMs = Date.now() - startTime;
      this.logger.info("batch_event", {
        event: "finished",
        total,
        succeeded: successes.length,
        failed: failures.length,
        durationMs
      });
      resolve({ total, successful: successes.map(entry => entry.value), failed: failures });
    };

    const runItem = async (index: number, work: WorkItem<T>) => {
      let attempt = 0;
      while (true) {
        try {
          const value = await work();
          successes.push({ index, value });
          return;
        } catch (error) {
          if (attempt >= options.retryCount) {
            const message = error instanceof Error && typeof error.message === "string" ? error.message : String(error);
            failures.push({ index, error: message });
            if (!options.continueOnError) {
              stopped = true;
            }
            return;
          }
          const delayMs = options.exponentialBackoff ? options.retryDelayMs * 2 ** attempt : options.retryDelayMs;
          this.logger.info("batch_event", { event: "retried", index, attempt, delayMs });
          attempt += 1;
          await wait(delayMs);
        }
      }
    };

    return await new Promise<BatchResult<T>>(resolve => {
      const trySchedule = () => {
        if (resolved) {
          return;
        }
        while (!stopped && inFlight < concurrencyLimit && cursor < total) {
          const index = cursor;
          cursor += 1;
          const work = items[index];
          inFlight += 1;
          void (async () => {
            try {
              await runItem(index, work);
            } finally {
              inFlight -= 1;
              this.logger.info("batch_event", {
                event: "progress",
                total,
                succeeded: successes.length,
                failed: failures.length,
                in_flight: inFlight
              });
              if (stopped) {
                if (inFlight === 0) {
                  finish(resolve);
                }
                return;
              }
              if (cursor < total) {
                trySchedule();
              } else if (inFlight === 0) {
                finish(resolve);
              }
            }
          })();
        }
        if ((stopped || cursor >= total) && inFlight === 0) {
          finish(resolve);
        }
      };

      trySchedule();
    });
  }
}
