import { describe, it, expect, afterEach } from "vitest";
import "./setup.js";
import { AttachFileToTask } from "../src/application/usecases/tasks/AttachFileToTask.js";
import { BulkTaskFuzzySearch } from "../src/application/usecases/BulkTaskFuzzySearch.js";
import { ok, type Result } from "../src/shared/Result.js";
import type { ClickUpGateway } from "../src/infrastructure/clickup/ClickUpGateway.js";
import type { TaskFuzzySearchOutputType } from "../src/mcp/tools/schemas/taskSearch.js";
import type { TaskFuzzySearch } from "../src/application/usecases/TaskFuzzySearch.js";

class StubGateway implements Pick<ClickUpGateway, "attach_file_to_task"> {
  async attach_file_to_task(): Promise<never> {
    throw new Error("Should not be called in limit tests");
  }
}

class StubTaskFuzzySearch implements Pick<TaskFuzzySearch, "execute"> {
  async execute(): Promise<Result<TaskFuzzySearchOutputType>> {
    return ok<TaskFuzzySearchOutputType>({ totalIndexed: 0, tookMs: 0, results: [] });
  }
}

const originalAttachmentLimit = process.env.MAX_ATTACHMENT_MB;
const originalBulkLimit = process.env.MAX_BULK_CONCURRENCY;

afterEach(() => {
  if (typeof originalAttachmentLimit === "undefined") {
    delete process.env.MAX_ATTACHMENT_MB;
  } else {
    process.env.MAX_ATTACHMENT_MB = originalAttachmentLimit;
  }
  if (typeof originalBulkLimit === "undefined") {
    delete process.env.MAX_BULK_CONCURRENCY;
  } else {
    process.env.MAX_BULK_CONCURRENCY = originalBulkLimit;
  }
});

describe("limit enforcement", () => {
  it("rejects attachments that exceed the configured size", async () => {
    process.env.MAX_ATTACHMENT_MB = "4";
    const gateway = new StubGateway();
    const usecase = new AttachFileToTask(gateway as unknown as ClickUpGateway);
    const limitBytes = 4 * 1024 * 1024;
    const payload = Buffer.alloc(limitBytes + 1, 1).toString("base64");
    const dataUri = `data:application/octet-stream;base64,${payload}`;
    const result = await usecase.execute(null, { taskId: "123", dataUri, name: "too-big.bin" });
    expect(result.isError).toBe(true);
    if (!result.isError) {
      return;
    }
    expect(result.code).toBe("LIMIT_EXCEEDED");
    expect(result.message).toBe("Attachment exceeds 4 MB");
  });

  it("rejects bulk operations over the concurrency cap", async () => {
    process.env.MAX_BULK_CONCURRENCY = "2";
    const search = new StubTaskFuzzySearch();
    const usecase = new BulkTaskFuzzySearch(search as unknown as TaskFuzzySearch);
    const result = await usecase.execute(null, {
      queries: ["foo", "bar"],
      options: { concurrency: 3 }
    });
    expect(result.isError).toBe(true);
    if (!result.isError) {
      return;
    }
    expect(result.code).toBe("LIMIT_EXCEEDED");
    expect(result.message).toBe("Requested concurrency 3 exceeds cap 2");
  });
});
