import { z } from "zod";
import {
  ReportForSpaceTagInput,
  ReportOutput,
  ReportTaskItem
} from "../../../mcp/tools/schemas/time.js";
import { Result, ok, err } from "../../../shared/Result.js";
import { mapHttpError } from "../../../shared/Errors.js";
import { characterLimit } from "../../../config/runtime.js";
import type { ClickUpGateway } from "../../../infrastructure/clickup/ClickUpGateway.js";
import {
  TaskInfo,
  fetchEntries,
  aggregateByTask,
  aggregateByMember,
  gatherTasks
} from "./ReportTimeForTag.js";

const TASK_CAP = 500;

type InputType = z.infer<typeof ReportForSpaceTagInput>;
type OutputType = z.infer<typeof ReportOutput>;
type ReportTaskItemType = z.infer<typeof ReportTaskItem>;

type HttpErrorLike = { status?: number; data?: unknown };

type ParsedEntry = Awaited<ReturnType<typeof fetchEntries>> extends (infer U)[] ? U : never;

type TaskFetchResult = { tasks: Map<string, TaskInfo>; truncated: boolean };

function isWithinWindow(entry: ParsedEntry, sinceMs: number | null, untilMs: number | null): boolean {
  if (sinceMs !== null && entry.endMs < sinceMs) {
    return false;
  }
  if (untilMs !== null && entry.startMs > untilMs) {
    return false;
  }
  return true;
}

function shrinkTaskNames(items: ReportTaskItemType[]): boolean {
  let index = -1;
  let maxLength = -1;
  for (let i = 0; i < items.length; i += 1) {
    const value = items[i]?.name;
    if (typeof value === "string" && value.length > maxLength) {
      index = i;
      maxLength = value.length;
    }
  }
  if (index === -1 || maxLength <= 0) {
    return false;
  }
  const current = items[index].name;
  if (typeof current !== "string") {
    return false;
  }
  const nextLength = Math.max(0, Math.floor(current.length / 2));
  items[index].name = nextLength > 0 ? current.slice(0, nextLength) : "";
  return true;
}

function shrinkTags(items: ReportTaskItemType[]): boolean {
  let target: { taskIndex: number; tagIndex: number } | null = null;
  let maxLength = -1;
  for (let i = 0; i < items.length; i += 1) {
    const tags = items[i]?.tags ?? [];
    for (let j = 0; j < tags.length; j += 1) {
      const value = tags[j];
      if (typeof value === "string" && value.length > maxLength) {
        maxLength = value.length;
        target = { taskIndex: i, tagIndex: j };
      }
    }
  }
  if (!target || maxLength <= 0) {
    return false;
  }
  const current = items[target.taskIndex].tags[target.tagIndex];
  const nextLength = Math.max(0, Math.floor(current.length / 2));
  items[target.taskIndex].tags[target.tagIndex] = nextLength > 0 ? current.slice(0, nextLength) : "";
  return true;
}

function enforceLimit(out: OutputType): void {
  const limit = characterLimit();
  let payload = JSON.stringify(out);
  if (payload.length <= limit) {
    return;
  }
  let truncated = false;
  while (payload.length > limit) {
    let changed = false;
    if (shrinkTaskNames(out.byTask)) {
      truncated = true;
      changed = true;
      payload = JSON.stringify(out);
      if (payload.length <= limit) {
        break;
      }
    }
    if (payload.length > limit && shrinkTags(out.byTask)) {
      truncated = true;
      changed = true;
      payload = JSON.stringify(out);
      if (payload.length <= limit) {
        break;
      }
    }
    if (!changed) {
      break;
    }
  }
  if (payload.length > limit) {
    truncated = true;
  }
  if (truncated) {
    out.truncated = true;
    out.guidance = out.guidance ? `${out.guidance}; Output trimmed to character_limit` : "Output trimmed to character_limit";
  }
}

async function fetchSpaceTagTasks(
  gateway: ClickUpGateway,
  teamId: number,
  spaceId: string,
  tag: string
): Promise<TaskFetchResult> {
  const tasks = new Map<string, TaskInfo>();
  let page = 0;
  const limit = 100;
  let truncated = false;
  for (let i = 0; i < 50; i += 1) {
    const response = await gateway.search_tasks_by_space_and_tag(teamId, spaceId, tag, page, limit);
    const parsed = gatherTasks(response);
    for (const task of parsed.tasks) {
      if (!tasks.has(task.taskId)) {
        tasks.set(task.taskId, task);
      }
      if (tasks.size >= TASK_CAP) {
        truncated = true;
        break;
      }
    }
    if (tasks.size >= TASK_CAP) {
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
    break;
  }
  return { tasks, truncated };
}

export class ReportTimeForSpaceTag {
  constructor(private readonly gateway: ClickUpGateway) {}

  async execute(ctx: unknown, input: InputType): Promise<Result<OutputType>> {
    void ctx;
    const parsed = ReportForSpaceTagInput.safeParse(input ?? {});
    if (!parsed.success) {
      return err("INVALID_PARAMETER", "Invalid parameters", parsed.error.flatten());
    }
    const data = parsed.data;
    try {
      const taskFetch = await fetchSpaceTagTasks(this.gateway, data.teamId, data.spaceId, data.tag);
      const tasks = taskFetch.tasks;
      const taskIds = Array.from(tasks.keys());
      const sinceMs = data.since ? Date.parse(data.since) : Number.NaN;
      const untilMs = data.until ? Date.parse(data.until) : Number.NaN;
      const sinceFilter = Number.isNaN(sinceMs) ? null : sinceMs;
      const untilFilter = Number.isNaN(untilMs) ? null : untilMs;
      let entries: ParsedEntry[] = [];
      if (taskIds.length > 0) {
        const rawEntries = await fetchEntries(
          this.gateway,
          data.teamId,
          taskIds,
          data.memberIds,
          data.since,
          data.until,
          data.includeBillable
        );
        const filtered = rawEntries.filter(entry => isWithinWindow(entry, sinceFilter, untilFilter));
        entries = filtered.filter(entry => tasks.has(entry.taskId));
      }
      const totalMs = entries.reduce((sum, entry) => sum + entry.durationMs, 0);
      const billableMs = entries.filter(entry => entry.billable).reduce((sum, entry) => sum + entry.durationMs, 0);
      const byMember = aggregateByMember(entries);
      const byTask = aggregateByTask(entries, tasks);
      const out: OutputType = {
        teamId: data.teamId,
        scope: { type: "space_tag", value: `${data.spaceId}:${data.tag}` },
        window: { since: data.since ?? null, until: data.until ?? null },
        totals: { totalMs, billableMs },
        byMember,
        byTask
      };
      if (taskFetch.truncated) {
        out.truncated = true;
        out.guidance = "Task set capped at 500 tasks for reporting";
      }
      enforceLimit(out);
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
