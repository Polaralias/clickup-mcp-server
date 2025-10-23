import { describe, expect, it, vi } from "vitest";
import "./setup.js";
import type { ClickUpGateway } from "../src/infrastructure/clickup/ClickUpGateway.js";
import { ReportTimeForTag } from "../src/application/usecases/time/ReportTimeForTag.js";
import { ReportTimeForContainer } from "../src/application/usecases/time/ReportTimeForContainer.js";

type TagGatewayStub = Pick<ClickUpGateway, "search_tasks" | "list_time_entries">;
type ContainerGatewayStub = Pick<ClickUpGateway, "search_tasks" | "list_time_entries" | "list_view_tasks">;

describe("Time reports", () => {
  it("Report by tag aggregates correctly", async () => {
    const search_tasks = vi.fn().mockResolvedValue({
      tasks: [
        { id: "T1", name: "First", url: "https://app/tasks/T1", tags: [{ name: "alpha" }] },
        { id: "T2", name: "Second", url: "https://app/tasks/T2", tags: ["alpha"] }
      ],
      total_tasks: 2,
      page: 0,
      limit: 100
    });
    const list_time_entries = vi.fn().mockResolvedValue({
      time_entries: [
        {
          id: "E1",
          task_id: "T1",
          user: { id: 5 },
          start: Date.parse("2025-01-01T09:00:00.000Z"),
          end: Date.parse("2025-01-01T10:00:00.000Z"),
          billable: true
        },
        {
          id: "E2",
          task_id: "T2",
          user: { id: 6 },
          start: Date.parse("2025-01-01T11:00:00.000Z"),
          end: Date.parse("2025-01-01T11:30:00.000Z"),
          billable: false
        },
        {
          id: "E3",
          task_id: "T1",
          user: { id: 5 },
          start: Date.parse("2025-01-02T08:00:00.000Z"),
          end: Date.parse("2025-01-02T10:00:00.000Z"),
          billable: false
        }
      ],
      total: 3,
      page: 0,
      limit: 100
    });
    const gateway: TagGatewayStub = { search_tasks, list_time_entries };
    const usecase = new ReportTimeForTag(gateway as unknown as ClickUpGateway);
    const result = await usecase.execute({}, { teamId: 1, tag: "alpha" });
    expect(search_tasks).toHaveBeenCalledWith({
      teamId: 1,
      page: 0,
      limit: 100,
      include_closed: "true",
      "tags[]": ["alpha"]
    });
    expect(list_time_entries).toHaveBeenCalledTimes(1);
    expect(result.isError).toBe(false);
    if (result.isError) {
      throw new Error("Expected success result");
    }
    expect(result.data.totals.totalMs).toBe(12600000);
    expect(result.data.totals.billableMs).toBe(3600000);
    expect(result.data.byMember).toEqual([
      { memberId: 5, totalMs: 10800000, billableMs: 3600000 },
      { memberId: 6, totalMs: 1800000, billableMs: 0 }
    ]);
    expect(result.data.byTask.map(item => ({ taskId: item.taskId, totalMs: item.totalMs }))).toEqual([
      { taskId: "T1", totalMs: 10800000 },
      { taskId: "T2", totalMs: 1800000 }
    ]);
    expect(result.data.scope).toEqual({ type: "tag", value: "alpha" });
  });

  it("Report by list aggregates correctly", async () => {
    const search_tasks = vi.fn().mockResolvedValue({
      tasks: [
        { id: "L1-T1", name: "List One", url: "https://app/tasks/L1-T1", tags: [] },
        { id: "L1-T2", name: "List Two", url: "https://app/tasks/L1-T2", tags: [] }
      ],
      total_tasks: 2,
      page: 0,
      limit: 100
    });
    const list_time_entries = vi.fn().mockResolvedValue({
      time_entries: [
        {
          id: "LE1",
          task_id: "L1-T1",
          user: { id: 8 },
          start: Date.parse("2025-01-03T09:00:00.000Z"),
          end: Date.parse("2025-01-03T10:00:00.000Z"),
          billable: true
        }
      ],
      total: 1,
      page: 0,
      limit: 100
    });
    const list_view_tasks = vi.fn();
    const gateway: ContainerGatewayStub = { search_tasks, list_time_entries, list_view_tasks };
    const usecase = new ReportTimeForContainer(gateway as unknown as ClickUpGateway);
    const result = await usecase.execute({}, { teamId: 9, ref: { containerType: "list", containerId: "L1" } });
    expect(search_tasks).toHaveBeenCalledWith({
      teamId: 9,
      page: 0,
      limit: 100,
      include_closed: "true",
      "list_ids[]": ["L1"]
    });
    expect(list_time_entries).toHaveBeenCalled();
    expect(result.isError).toBe(false);
    if (result.isError) {
      throw new Error("Expected success result");
    }
    expect(result.data.scope).toEqual({ type: "list", value: "L1" });
    expect(result.data.totals.totalMs).toBe(3600000);
    expect(result.data.byTask[0].taskId).toBe("L1-T1");
  });

  it("Report handles large task sets with cap", async () => {
    const tasks = Array.from({ length: 600 }, (_, index) => ({
      id: `T${index}`,
      name: `Task ${index}`,
      url: `https://app/tasks/T${index}`,
      tags: []
    }));
    const search_tasks = vi.fn().mockResolvedValue({ tasks, total_tasks: 600, page: 0, limit: 100 });
    const list_time_entries = vi.fn().mockResolvedValue({ time_entries: [], total: 0, page: 0, limit: 100 });
    const gateway: TagGatewayStub = { search_tasks, list_time_entries };
    const usecase = new ReportTimeForTag(gateway as unknown as ClickUpGateway);
    const result = await usecase.execute({}, { teamId: 1, tag: "alpha" });
    expect(result.isError).toBe(false);
    if (result.isError) {
      throw new Error("Expected success result");
    }
    const callParams = list_time_entries.mock.calls[0][1] as Record<string, unknown>;
    const taskIds = callParams.taskIds as string[];
    expect(taskIds.length).toBe(500);
    expect(result.data.truncated).toBe(true);
    expect(result.data.guidance).toBe("Task set capped at 500 tasks for reporting");
  });

  it("Report by view path", async () => {
    const list_view_tasks = vi.fn().mockResolvedValue({
      tasks: [{ id: "V1-T1", name: "View Task", url: "https://app/tasks/V1-T1", tags: [] }],
      total_tasks: 1,
      page: 0,
      limit: 100
    });
    const list_time_entries = vi.fn().mockResolvedValue({
      time_entries: [
        {
          id: "VE1",
          task_id: "V1-T1",
          user: { id: 4 },
          start: Date.parse("2025-01-04T09:00:00.000Z"),
          end: Date.parse("2025-01-04T10:00:00.000Z"),
          billable: true
        }
      ],
      total: 1,
      page: 0,
      limit: 100
    });
    const search_tasks = vi.fn();
    const gateway: ContainerGatewayStub = { search_tasks, list_time_entries, list_view_tasks };
    const usecase = new ReportTimeForContainer(gateway as unknown as ClickUpGateway);
    const result = await usecase.execute({}, { teamId: 42, ref: { containerType: "view", containerId: "V1" } });
    expect(list_view_tasks).toHaveBeenCalledWith("team", 42, "V1", { page: 0, limit: 100 });
    expect(search_tasks).not.toHaveBeenCalled();
    expect(result.isError).toBe(false);
    if (result.isError) {
      throw new Error("Expected success result");
    }
    expect(result.data.scope).toEqual({ type: "view", value: "V1" });
    expect(result.data.totals.totalMs).toBe(3600000);
  });

  it("Date window applied", async () => {
    const search_tasks = vi.fn().mockResolvedValue({
      tasks: [{ id: "TW1", name: "Window Task", url: "https://app/tasks/TW1", tags: [] }],
      total_tasks: 1,
      page: 0,
      limit: 100
    });
    const list_time_entries = vi.fn().mockResolvedValue({
      time_entries: [
        {
          id: "DW1",
          task_id: "TW1",
          user: { id: 1 },
          start: Date.parse("2025-01-05T08:00:00.000Z"),
          end: Date.parse("2025-01-05T09:30:00.000Z"),
          billable: false
        },
        {
          id: "DW2",
          task_id: "TW1",
          user: { id: 1 },
          start: Date.parse("2025-01-05T10:00:00.000Z"),
          end: Date.parse("2025-01-05T11:00:00.000Z"),
          billable: true
        },
        {
          id: "DW3",
          task_id: "TW1",
          user: { id: 1 },
          start: Date.parse("2025-01-05T12:30:00.000Z"),
          end: Date.parse("2025-01-05T13:00:00.000Z"),
          billable: false
        }
      ],
      total: 3,
      page: 0,
      limit: 100
    });
    const gateway: TagGatewayStub = { search_tasks, list_time_entries };
    const usecase = new ReportTimeForTag(gateway as unknown as ClickUpGateway);
    const result = await usecase.execute({}, {
      teamId: 3,
      tag: "window",
      since: "2025-01-05T09:00:00.000Z",
      until: "2025-01-05T12:00:00.000Z"
    });
    expect(list_time_entries).toHaveBeenCalledWith(3, expect.objectContaining({
      since: "2025-01-05T09:00:00.000Z",
      until: "2025-01-05T12:00:00.000Z",
      includeRunning: false
    }));
    expect(result.isError).toBe(false);
    if (result.isError) {
      throw new Error("Expected success result");
    }
    expect(result.data.totals.totalMs).toBe(9000000);
    expect(result.data.totals.billableMs).toBe(3600000);
    expect(result.data.byTask[0].totalMs).toBe(9000000);
  });
});
