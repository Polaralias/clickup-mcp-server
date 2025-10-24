import { z } from "zod";

export const CreateDocInput = z
  .object({
    workspaceId: z.number().int().positive(),
    title: z.string().min(1),
    visibility: z.enum(["PUBLIC", "PRIVATE", "PERSONAL", "HIDDEN"]).default("PRIVATE")
  })
  .strict();

export const DocRef = z
  .object({
    docId: z.string(),
    url: z.string().optional(),
    title: z.string().nullable()
  })
  .strict();

export const CreateDocOutput = z
  .object({
    doc: DocRef,
    truncated: z.boolean().optional(),
    guidance: z.string().optional()
  })
  .strict();

export const ListDocPagesInput = z
  .object({
    workspaceId: z.number().int().positive(),
    docId: z.string().min(1),
    limit: z.number().int().min(1).max(50).default(20),
    page: z.number().int().min(0).default(0)
  })
  .strict();

export const DocPageItem = z
  .object({
    pageId: z.string(),
    title: z.string().nullable(),
    snippet: z.string().nullable(),
    updatedAt: z.string().nullable(),
    url: z.string()
  })
  .strict();

export const ListDocPagesOutput = z
  .object({
    total: z.number().int().nonnegative(),
    page: z.number().int().nonnegative(),
    limit: z.number().int().positive(),
    hasMore: z.boolean(),
    results: z.array(DocPageItem),
    truncated: z.boolean().optional(),
    guidance: z.string().optional()
  })
  .strict();

export const GetDocPageInput = z
  .object({
    workspaceId: z.number().int().positive(),
    docId: z.string().min(1),
    pageId: z.string().min(1),
    contentFormat: z.enum(["text/md", "text/html", "application/json"]).default("text/md")
  })
  .strict();

export const GetDocPageOutput = z
  .object({
    docId: z.string(),
    pageId: z.string(),
    title: z.string().nullable(),
    content: z.string(),
    contentFormat: z.enum(["text/md", "text/html", "application/json"]),
    truncated: z.boolean().optional(),
    guidance: z.string().optional()
  })
  .strict();

export const UpdateDocPageInput = z
  .object({
    workspaceId: z.number().int().positive(),
    docId: z.string().min(1),
    pageId: z.string().min(1),
    contentFormat: z.enum(["text/md", "text/html", "application/json"]).default("text/md"),
    content: z.string().min(1),
    title: z.string().optional(),
    dryRun: z.boolean().optional()
  })
  .strict();

const UpdateDocPageExecutionOutput = z
  .object({
    docId: z.string(),
    pageId: z.string(),
    updated: z.boolean(),
    truncated: z.boolean().optional(),
    guidance: z.string().optional()
  })
  .strict();

const UpdateDocPageDryRunOutput = z
  .object({
    dryRun: z.literal(true),
    preview: z
      .object({
        workspaceId: z.number().int().positive(),
        docId: z.string(),
        pageId: z.string(),
        body: z.record(z.unknown())
      })
      .strict(),
    truncated: z.boolean().optional(),
    guidance: z.string().optional()
  })
  .strict();

export const UpdateDocPageOutput = z.union([UpdateDocPageExecutionOutput, UpdateDocPageDryRunOutput]);

export type UpdateDocPageSuccessOutput = z.infer<typeof UpdateDocPageExecutionOutput>;
