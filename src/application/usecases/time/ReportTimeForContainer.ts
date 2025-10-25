import { z } from "zod";
import { ReportForContainerInput, ReportOutput } from "../../../mcp/tools/schemas/time.js";
import { Result, ok, err } from "../../../shared/Result.js";
import { mapHttpError } from "../../../shared/httpErrors.js";
import type { ClickUpGateway } from "../../../infrastructure/clickup/ClickUpGateway.js";
import {
  fetchTasks,
  fetchEntries,
  aggregateByTask,
  aggregateByMember,
  enforceReportLimit,
  TaskInfo,
  gatherTasks
} from "./ReportTimeForTag.js";

type InputType = z.infer<typeof ReportForContainerInput>;
type OutputType = z.infer<typeof ReportOutput>;

type HttpErrorLike = { status?: number; data?: unknown };

type FetchResult = { tasks: Map<string, TaskInfo>; truncated: boolean };

const TASK_CAP_MESSAGE = "Task set capped at 500 tasks for reporting";

async function fetchTasksForList(
  gateway: ClickUpGateway,
  teamId: number,
  listId: string
): Promise<FetchResult> {
  return fetchTasks(gateway, (page, limit) => ({
    teamId,
    page,
    limit,
    include_closed: "true",
    "list_ids[]": [listId]
  }));
}

async function fetchTasksViaViewEndpoint(
  gateway: ClickUpGateway,
  teamId: number,
  viewId: string
): Promise<FetchResult> {
  const tasks = new Map<string, TaskInfo>();
  let page = 0;
  const limit = 100;
  let truncated = false;
  for (let i = 0; i < 50; i += 1) {
    const params: Record<string, unknown> = { page, limit };
    const response = await gateway.list_view_tasks("team", teamId, viewId, params);
    const parsed = gatherTasks(response);
    for (const task of parsed.tasks) {
      if (!tasks.has(task.taskId)) {
        tasks.set(task.taskId, task);
      }
      if (tasks.size >= 500) {
        truncated = true;
        break;
      }
    }
    if (tasks.size >= 500) {
      break;
    }
    if (parsed.hasMore === true) {
      page = (parsed.page ?? page) + 1;
      continue;
    }
    const limitValue = parsed.limit ?? limit;
    if (parsed.hasMore === null && parsed.tasks.length === limitValue) {
      page = (parsed.page ?? page) + 1;
      continue;
    }
    if (parsed.tasks.length === 0) {
      break;
    }
    break;
  }
  return { tasks, truncated };
}

async function fetchTasksForView(
  gateway: ClickUpGateway,
  teamId: number,
  viewId: string
): Promise<FetchResult> {
  if (typeof gateway.list_view_tasks === "function") {
    return fetchTasksViaViewEndpoint(gateway, teamId, viewId);
  }
  return fetchTasks(gateway, (page, limit) => ({
    teamId,
    page,
    limit,
    include_closed: "true",
    "view_ids[]": [viewId]
  }));
}

function filterEntries(entries: Awaited<ReturnType<typeof fetchEntries>>, tasks: Map<string, TaskInfo>, since: string | undefined, until: string | undefined) {
  const sinceMs = since ? Date.parse(since) : Number.NaN;
  const untilMs = until ? Date.parse(until) : Number.NaN;
  const sinceFilter = Number.isNaN(sinceMs) ? null : sinceMs;
  const untilFilter = Number.isNaN(untilMs) ? null : untilMs;
  return entries.filter(entry => {
    if (!tasks.has(entry.taskId)) {
      return false;
    }
    if (sinceFilter !== null && entry.endMs < sinceFilter) {
      return false;
    }
    if (untilFilter !== null && entry.startMs > untilFilter) {
      return false;
    }
    return true;
  });
}

export class ReportTimeForContainer {
  constructor(private readonly gateway: ClickUpGateway) {}

  async execute(ctx: unknown, input: InputType): Promise<Result<OutputType>> {
    void ctx;
    const parsed = ReportForContainerInput.safeParse(input ?? {});
    if (!parsed.success) {
      return err("INVALID_PARAMETER", "Invalid parameters", parsed.error.flatten());
    }
    const data = parsed.data;
    try {
      const fetchResult =
        data.ref.containerType === "list"
          ? await fetchTasksForList(this.gateway, data.teamId, data.ref.containerId)
          : await fetchTasksForView(this.gateway, data.teamId, data.ref.containerId);
      const tasks = fetchResult.tasks;
      const taskIds = Array.from(tasks.keys());
      let entries = [] as Awaited<ReturnType<typeof fetchEntries>>;
      if (taskIds.length > 0) {
        const raw = await fetchEntries(
          this.gateway,
          data.teamId,
          taskIds,
          data.memberIds,
          data.since,
          data.until,
          data.includeBillable
        );
        entries = raw;
      }
      const filteredEntries = filterEntries(entries, tasks, data.since, data.until);
      const totalMs = filteredEntries.reduce((sum, entry) => sum + entry.durationMs, 0);
      const billableMs = filteredEntries.filter(entry => entry.billable).reduce((sum, entry) => sum + entry.durationMs, 0);
      const byMember = aggregateByMember(filteredEntries);
      const byTask = aggregateByTask(filteredEntries, tasks);
      const out: OutputType = {
        teamId: data.teamId,
        scope: { type: data.ref.containerType, value: data.ref.containerId },
        window: { since: data.since ?? null, until: data.until ?? null },
        totals: { totalMs, billableMs },
        byMember,
        byTask
      };
      if (fetchResult.truncated) {
        out.truncated = true;
        out.guidance = TASK_CAP_MESSAGE;
      }
      enforceReportLimit(out);
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
