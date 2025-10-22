import { z } from "zod";

export const TaskScope = z
  .object({
    teamId: z.number().int().positive().optional(),
    spaceIds: z.array(z.string()).max(50).optional(),
    listIds: z.array(z.string()).max(50).optional(),
    assigneeIds: z.array(z.number().int()).max(50).optional(),
    statuses: z.array(z.string()).max(50).optional(),
    includeClosed: z.boolean().optional(),
    updatedSince: z.string().datetime().optional()
  })
  .strict();

export const TaskFuzzySearchInput = z
  .object({
    query: z.string().min(1),
    scope: TaskScope.optional(),
    limit: z.number().int().min(1).max(50).default(20)
  })
  .strict();

export const TaskHit = z
  .object({
    taskId: z.string(),
    name: z.string().nullable(),
    url: z.string(),
    listId: z.string().nullable(),
    listName: z.string().nullable(),
    spaceId: z.string().nullable(),
    spaceName: z.string().nullable(),
    status: z.string().nullable(),
    priority: z.string().nullable(),
    assignees: z
      .array(z.object({ id: z.number().int(), username: z.string().nullable() }).strict())
      .default([]),
    score: z.number().nullable(),
    matchedFields: z.array(z.string()).default([]),
    snippet: z.string().nullable(),
    updatedAt: z.string().nullable()
  })
  .strict();

export const TaskFuzzySearchOutput = z
  .object({
    totalIndexed: z.number().int().nonnegative(),
    tookMs: z.number().int().nonnegative(),
    results: z.array(TaskHit),
    truncated: z.boolean().optional(),
    guidance: z.string().optional()
  })
  .strict();

export const BulkTaskFuzzySearchInput = z
  .object({
    queries: z.array(z.string().min(1)).min(1).max(25),
    scope: TaskScope.optional(),
    options: z
      .object({
        limit: z.number().int().min(1).max(50).optional(),
        concurrency: z.number().int().min(1).max(10).optional()
      })
      .default({})
  })
  .strict();

export const BulkTaskFuzzySearchOutput = z
  .object({
    perQuery: z.record(TaskFuzzySearchOutput).default({}),
    union: z
      .object({
        results: z.array(TaskHit),
        dedupedCount: z.number().int().nonnegative()
      })
      .strict(),
    failed: z
      .array(
        z
          .object({
            query: z.string(),
            error: z.string(),
            code: z.string().optional()
          })
          .strict()
      )
      .default([]),
    truncated: z.boolean().optional(),
    guidance: z.string().optional()
  })
  .strict();

export type TaskScopeType = z.infer<typeof TaskScope>;
export type TaskFuzzySearchInputType = z.infer<typeof TaskFuzzySearchInput>;
export type TaskHitType = z.infer<typeof TaskHit>;
export type TaskFuzzySearchOutputType = z.infer<typeof TaskFuzzySearchOutput>;
export type BulkTaskFuzzySearchInputType = z.infer<typeof BulkTaskFuzzySearchInput>;
export type BulkTaskFuzzySearchOutputType = z.infer<typeof BulkTaskFuzzySearchOutput>;
