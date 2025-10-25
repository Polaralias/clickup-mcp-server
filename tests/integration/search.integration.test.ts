import { describe, expect, it, vi } from "vitest";
import "../setup.js";
import { TaskSearchIndex } from "../../src/application/services/TaskSearchIndex.js";
import { TaskFuzzySearch } from "../../src/application/usecases/TaskFuzzySearch.js";
import { SearchTasks } from "../../src/application/usecases/tasks/SearchTasks.js";
import type { ClickUpGateway } from "../../src/infrastructure/clickup/ClickUpGateway.js";

describe("Search integration", () => {
  it("keeps fuzzy and REST outputs consistent while exposing distinct metadata", async () => {
    const loader = vi.fn().mockResolvedValue([
      {
        taskId: "T1",
        name: "Alpha planning",
        description: "Plan the alpha milestone",
        url: "https://app/tasks/T1",
        listName: "Backlog",
        spaceName: "Product",
        updatedAt: new Date("2025-02-01T09:00:00.000Z").toISOString()
      },
      {
        taskId: "T2",
        name: "Alpha bugfix",
        description: "Fix alpha regression",
        url: "https://app/tasks/T2",
        listName: "Backlog",
        spaceName: "Product",
        updatedAt: new Date("2025-02-02T12:00:00.000Z").toISOString()
      }
    ]);
    const gateway = {
      get_task_by_id: vi.fn(),
      search_tasks: vi.fn().mockResolvedValue({
        tasks: [
          {
            id: "T2",
            name: "Alpha bugfix",
            url: "https://app/tasks/T2",
            date_updated: Date.parse("2025-02-02T12:00:00.000Z")
          },
          {
            id: "T1",
            name: "Alpha planning",
            url: "https://app/tasks/T1",
            date_updated: Date.parse("2025-02-01T09:00:00.000Z")
          }
        ],
        total_tasks: 2,
        page: 0,
        limit: 2
      })
    } satisfies Partial<ClickUpGateway>;
    const index = new TaskSearchIndex(loader, 60);
    const fuzzyUsecase = new TaskFuzzySearch(index, gateway as ClickUpGateway);
    const restUsecase = new SearchTasks(gateway as ClickUpGateway);
    const fuzzyResult = await fuzzyUsecase.execute({}, { query: "Alpha", limit: 2 });
    expect(fuzzyResult.isError).toBe(false);
    if (fuzzyResult.isError) {
      throw new Error("Expected success");
    }
    expect(loader).toHaveBeenCalledTimes(1);
    expect(fuzzyResult.data.results).toHaveLength(2);
    expect(fuzzyResult.data.results.some(item => typeof item.score === "number")).toBe(true);
    const fuzzyIds = fuzzyResult.data.results.map(item => item.taskId);
    expect(new Set(fuzzyIds)).toEqual(new Set(["T1", "T2"]));
    expect(fuzzyResult.data.results[0]?.updatedAt ?? "").not.toBe("");
    const restResult = await restUsecase.execute(
      {},
      { teamId: 5, query: "Alpha", limit: 2, page: 0, includeClosed: false }
    );
    expect(restResult.isError).toBe(false);
    if (restResult.isError) {
      throw new Error("Expected success");
    }
    expect(gateway.search_tasks).toHaveBeenCalledWith({
      teamId: 5,
      page: 0,
      limit: 2,
      include_closed: "false",
      order_by: "date_updated",
      reverse: "true",
      search: "Alpha"
    });
    expect(restResult.data.results).toHaveLength(2);
    const restIds = restResult.data.results.map(item => item.taskId);
    expect(new Set(restIds)).toEqual(new Set(["T1", "T2"]));
    const restFirst = restResult.data.results[0];
    expect(restFirst.dateUpdated).toContain("2025-02-02");
    const restShape = restFirst as Record<string, unknown>;
    expect(restShape.score).toBeUndefined();
    const fuzzyFirst = fuzzyResult.data.results[0] as Record<string, unknown>;
    expect(fuzzyFirst.dateUpdated).toBeUndefined();
    expect(typeof fuzzyFirst.score === "number" || fuzzyFirst.score === null).toBe(true);
  });
});
