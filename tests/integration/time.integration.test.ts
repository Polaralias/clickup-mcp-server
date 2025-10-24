import { describe, expect, it, vi } from "vitest";
import "../setup.js";
import { ReportTimeForTag } from "../../src/application/usecases/time/ReportTimeForTag.js";
import { ReportTimeForContainer } from "../../src/application/usecases/time/ReportTimeForContainer.js";
import { ReportTimeForSpaceTag } from "../../src/application/usecases/time/ReportTimeForSpaceTag.js";
import type { ClickUpGateway } from "../../src/infrastructure/clickup/ClickUpGateway.js";

describe("Time reporting integration", () => {
  it("aggregates totals by tag, list, and space within tolerance", async () => {
    const sharedEntries = [
      {
        id: "E1",
        task_id: "T-TAG-1",
        user: { id: 11 },
        start: Date.parse("2025-02-01T09:00:00.000Z"),
        end: Date.parse("2025-02-01T10:30:00.000Z"),
        billable: true
      },
      {
        id: "E2",
        task_id: "T-TAG-2",
        user: { id: 12 },
        start: Date.parse("2025-02-01T11:00:00.000Z"),
        end: Date.parse("2025-02-01T12:15:00.000Z"),
        billable: false
      }
    ];
    const tagGateway = {
      search_tasks: vi.fn().mockResolvedValue({
        tasks: [
          { id: "T-TAG-1", name: "Focus work", url: "https://app/tasks/T-TAG-1", tags: [{ name: "focus" }] },
          { id: "T-TAG-2", name: "Review", url: "https://app/tasks/T-TAG-2", tags: [{ name: "focus" }] }
        ],
        total_tasks: 2,
        page: 0,
        limit: 100,
        has_more: false
      }),
      list_time_entries: vi.fn().mockResolvedValue({ time_entries: sharedEntries, total: 2, page: 0, limit: 100 })
    } satisfies Partial<ClickUpGateway>;
    const tagUsecase = new ReportTimeForTag(tagGateway as ClickUpGateway);
    const tagResult = await tagUsecase.execute({}, { teamId: 7, tag: "focus" });
    expect(tagResult.isError).toBe(false);
    if (tagResult.isError) {
      throw new Error("Expected success");
    }
    const expectedTagTotal = 5400000 + 4500000;
    expect(Math.abs(tagResult.data.totals.totalMs - expectedTagTotal)).toBeLessThanOrEqual(5);
    const listGateway = {
      search_tasks: vi.fn().mockResolvedValue({
        tasks: [
          { id: "T-LIST-1", name: "Spec", url: "https://app/tasks/T-LIST-1", list: { id: "L1" }, tags: [] },
          { id: "T-LIST-2", name: "Implementation", url: "https://app/tasks/T-LIST-2", list: { id: "L1" }, tags: [] }
        ],
        total_tasks: 2,
        page: 0,
        limit: 100,
        has_more: false
      }),
      list_time_entries: vi.fn().mockResolvedValue({
        time_entries: [
          {
            id: "E3",
            task_id: "T-LIST-1",
            user: { id: 21 },
            start: Date.parse("2025-02-02T09:00:00.000Z"),
            end: Date.parse("2025-02-02T09:45:00.000Z"),
            billable: true
          },
          {
            id: "E4",
            task_id: "T-LIST-2",
            user: { id: 21 },
            start: Date.parse("2025-02-02T10:00:00.000Z"),
            end: Date.parse("2025-02-02T11:00:00.000Z"),
            billable: true
          }
        ],
        total: 2,
        page: 0,
        limit: 100
      }),
      list_view_tasks: vi.fn()
    } satisfies Partial<ClickUpGateway>;
    const listUsecase = new ReportTimeForContainer(listGateway as ClickUpGateway);
    const listResult = await listUsecase.execute({}, { teamId: 7, ref: { containerType: "list", containerId: "L1" } });
    expect(listResult.isError).toBe(false);
    if (listResult.isError) {
      throw new Error("Expected success");
    }
    const expectedListTotal = 2700000 + 3600000;
    expect(Math.abs(listResult.data.totals.totalMs - expectedListTotal)).toBeLessThanOrEqual(5);
    const spaceGateway = {
      search_tasks_by_space_and_tag: vi.fn().mockResolvedValue({
        tasks: [
          { id: "T-SPACE-1", name: "Planning", url: "https://app/tasks/T-SPACE-1", tags: ["ops"], list: { id: "L2" } }
        ],
        total: 1,
        page: 0,
        limit: 100,
        has_more: false
      }),
      list_time_entries: vi.fn().mockResolvedValue({
        time_entries: [
          {
            id: "E5",
            task_id: "T-SPACE-1",
            user: { id: 31 },
            start: Date.parse("2025-02-03T08:00:00.000Z"),
            end: Date.parse("2025-02-03T09:10:00.000Z"),
            billable: false
          }
        ],
        total: 1,
        page: 0,
        limit: 100
      })
    } satisfies Partial<ClickUpGateway>;
    const spaceUsecase = new ReportTimeForSpaceTag(spaceGateway as ClickUpGateway);
    const spaceResult = await spaceUsecase.execute({}, { teamId: 7, spaceId: "SPACE", tag: "ops" });
    expect(spaceResult.isError).toBe(false);
    if (spaceResult.isError) {
      throw new Error("Expected success");
    }
    const expectedSpaceTotal = 4200000;
    expect(Math.abs(spaceResult.data.totals.totalMs - expectedSpaceTotal)).toBeLessThanOrEqual(5);
  });
});
