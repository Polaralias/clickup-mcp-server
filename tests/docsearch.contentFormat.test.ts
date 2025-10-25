import { describe, expect, it, vi } from "vitest";
import "./setup.js";
import type { ClickUpGateway } from "../src/infrastructure/clickup/ClickUpGateway.js";
import { ApiCache } from "../src/infrastructure/cache/ApiCache.js";
import { makeMemoryKV } from "../src/shared/KV.js";
import { DocSearch } from "../src/application/usecases/DocSearch.js";

describe("doc search content format", () => {
  it("forwards content format and reports it in guidance", async () => {
    const searchDocs = vi.fn(async () => ({ total: 0, items: [] }));
    const gateway: Partial<ClickUpGateway> = {
      search_docs: searchDocs
    };
    const cache = new ApiCache(makeMemoryKV());
    const usecase = new DocSearch(gateway as ClickUpGateway, cache);
    const result = await usecase.execute({}, {
      workspaceId: 1,
      query: "alpha",
      contentFormat: "text/html"
    });
    expect(searchDocs).toHaveBeenCalledTimes(1);
    expect(searchDocs).toHaveBeenCalledWith(1, "alpha", 20, 0, { content_format: "text/html" });
    expect(result.isError).toBe(false);
    if (result.isError) {
      throw new Error("Expected doc search to succeed");
    }
    expect(result.data.guidance).toBe("contentFormat:text/html");
  });
});

