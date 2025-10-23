import { z } from "zod";

export const DocSearchInput = z
  .object({
    workspaceId: z.number().int().positive(),
    query: z.string().min(1),
    limit: z.number().int().min(1).max(50).default(20),
    page: z.number().int().min(0).default(0),
    contentFormat: z.enum(["text/md", "text/html", "application/json"]).optional(),
    expandPages: z.boolean().default(false),
    pageBody: z
      .object({
        contentFormat: z.enum(["text/md", "text/html", "application/json"]).optional(),
        limit: z.number().int().min(1).max(10).optional()
      })
      .strict()
      .optional()
  })
  .strict();

export const DocSearchItem = z
  .object({
    docId: z.string(),
    pageId: z.string(),
    title: z.string().nullable(),
    snippet: z.string().nullable(),
    url: z.string(),
    score: z.number().nullable(),
    updatedAt: z.string().nullable(),
    visibility: z.enum(["PUBLIC", "PRIVATE", "PERSONAL", "HIDDEN"]).nullable(),
    content: z.string().optional()
  })
  .strict();

export const DocSearchOutput = z
  .object({
    total: z.number().int().nonnegative(),
    page: z.number().int().nonnegative(),
    limit: z.number().int().positive(),
    hasMore: z.boolean(),
    results: z.array(DocSearchItem),
    truncated: z.boolean().optional(),
    guidance: z.string().optional()
  })
  .strict();

export const BulkDocSearchInput = z
  .object({
    workspaceId: z.number().int().positive(),
    queries: z.array(z.string().min(1)).min(1).max(25),
    options: z
      .object({
        limit: z.number().int().min(1).max(50).optional(),
        page: z.number().int().min(0).optional(),
        concurrency: z.number().int().min(1).max(10).optional(),
        retryCount: z.number().int().min(0).max(6).optional(),
        retryDelayMs: z.number().int().min(0).optional(),
        exponentialBackoff: z.boolean().optional(),
        continueOnError: z.boolean().optional()
      })
      .default({})
  })
  .strict();

export const BulkDocSearchOutput = z
  .object({
    perQuery: z.record(DocSearchOutput).default({}),
    union: z.object({
      results: z.array(DocSearchItem),
      dedupedCount: z.number().int().nonnegative()
    }),
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
