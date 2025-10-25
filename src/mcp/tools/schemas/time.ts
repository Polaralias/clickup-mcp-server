import { z } from "zod";

export const StartTimerInput = z
  .object({
    taskId: z.string().min(1),
    description: z.string().optional(),
    confirm: z.literal("yes").optional(),
    dryRun: z.boolean().optional()
  })
  .strict();

export const StopTimerInput = z
  .object({
    taskId: z.string().min(1),
    confirm: z.literal("yes").optional(),
    dryRun: z.boolean().optional()
  })
  .strict();

const TimerExecutionOutput = z
  .object({
    taskId: z.string(),
    started: z.boolean().optional(),
    stopped: z.boolean().optional(),
    entryId: z.string().optional(),
    running: z.boolean().optional(),
    truncated: z.boolean().optional(),
    guidance: z.string().optional()
  })
  .strict();

const TimerDryRunOutput = z
  .object({
    dryRun: z.literal(true),
    preview: z.record(z.unknown()),
    taskId: z.string().optional(),
    started: z.boolean().optional(),
    stopped: z.boolean().optional(),
    entryId: z.string().optional(),
    running: z.boolean().optional(),
    truncated: z.boolean().optional(),
    guidance: z.string().optional()
  })
  .strict();

export const TimerOutput = z.union([TimerExecutionOutput, TimerDryRunOutput]);

export type TimerSuccessOutput = z.infer<typeof TimerExecutionOutput>;

export const CreateEntryInput = z
  .object({
    taskId: z.string().min(1),
    memberId: z.number().int().positive().optional(),
    start: z.string().datetime(),
    end: z.string().datetime(),
    description: z.string().optional(),
    billable: z.boolean().default(false),
    dryRun: z.boolean().optional()
  })
  .strict();

export const UpdateEntryInput = z
  .object({
    entryId: z.string().min(1),
    start: z.string().datetime().optional(),
    end: z.string().datetime().optional(),
    description: z.string().optional(),
    billable: z.boolean().optional(),
    dryRun: z.boolean().optional()
  })
  .strict();

export const DeleteEntryInput = z
  .object({
    entryId: z.string().min(1),
    confirm: z.literal("yes").default("yes")
  })
  .strict();

export const ListEntriesInput = z
  .object({
    teamId: z.number().int().positive(),
    memberIds: z.array(z.number().int().positive()).max(50).optional(),
    taskIds: z.array(z.string()).max(50).optional(),
    since: z.string().datetime().optional(),
    until: z.string().datetime().optional(),
    page: z.number().int().min(0).default(0),
    limit: z.number().int().min(1).max(100).default(50),
    includeRunning: z.boolean().default(true),
    includeBillable: z.boolean().default(true)
  })
  .strict();

export const TimeEntryItem = z
  .object({
    entryId: z.string(),
    taskId: z.string(),
    memberId: z.number().int(),
    memberName: z.string().nullable(),
    start: z.string(),
    end: z.string(),
    durationMs: z.number().int().nonnegative(),
    description: z.string().nullable(),
    billable: z.boolean()
  })
  .strict();

export const ListEntriesOutput = z
  .object({
    total: z.number().int().nonnegative(),
    page: z.number().int().nonnegative(),
    limit: z.number().int().positive(),
    hasMore: z.boolean(),
    results: z.array(TimeEntryItem),
    byMember: z
      .array(
        z
          .object({
            memberId: z.number().int(),
            totalMs: z.number().int().nonnegative(),
            billableMs: z.number().int().nonnegative()
          })
          .strict()
      )
      .default([]),
    truncated: z.boolean().optional(),
    guidance: z.string().optional()
  })
  .strict();

export const ReportCommonFilters = z
  .object({
    teamId: z.number().int().positive(),
    since: z.string().datetime().optional(),
    until: z.string().datetime().optional(),
    includeBillable: z.boolean().default(true),
    memberIds: z.array(z.number().int().positive()).max(50).optional()
  })
  .strict();

export const ReportForTagInput = ReportCommonFilters.extend({
  tag: z.string().min(1)
}).strict();

export const ContainerRef = z
  .object({
    containerType: z.enum(["list", "view"]),
    containerId: z.string().min(1)
  })
  .strict();

export const ReportForContainerInput = ReportCommonFilters.extend({
  ref: ContainerRef
}).strict();

export const ReportForSpaceTagInput = z
  .object({
    teamId: z.number().int().positive(),
    spaceId: z.string().min(1),
    tag: z.string().min(1),
    since: z.string().datetime().optional(),
    until: z.string().datetime().optional(),
    includeBillable: z.boolean().default(true),
    memberIds: z.array(z.number().int().positive()).max(50).optional()
  })
  .strict();

export const ReportTaskItem = z
  .object({
    taskId: z.string(),
    name: z.string().nullable(),
    url: z.string(),
    tags: z.array(z.string()).default([]),
    totalMs: z.number().int().nonnegative(),
    billableMs: z.number().int().nonnegative()
  })
  .strict();

export const ReportOutput = z
  .object({
    teamId: z.number().int().positive(),
    scope: z
      .object({
        type: z.string(),
        value: z.string()
      })
      .strict(),
    window: z
      .object({
        since: z.string().nullable(),
        until: z.string().nullable()
      })
      .strict(),
    totals: z
      .object({
        totalMs: z.number().int().nonnegative(),
        billableMs: z.number().int().nonnegative()
      })
      .strict(),
    byMember: z
      .array(
        z
          .object({
            memberId: z.number().int(),
            totalMs: z.number().int().nonnegative(),
            billableMs: z.number().int().nonnegative()
          })
          .strict()
      )
      .default([]),
    byTask: z.array(ReportTaskItem).default([]),
    truncated: z.boolean().optional(),
    guidance: z.string().optional()
  })
  .strict();
