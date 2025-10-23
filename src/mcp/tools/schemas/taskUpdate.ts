import { z } from "zod";

export const CustomFieldPatch = z
  .object({
    fieldId: z.string().min(1),
    value: z.unknown(),
    value_options: z.record(z.unknown()).optional()
  })
  .strict();

export const UpdateTaskInput = z
  .object({
    taskId: z.string().min(1),
    name: z.string().min(1).optional(),
    status: z.string().min(1).optional(),
    assigneeIds: z.array(z.number().int()).max(20).optional(),
    priority: z.union([z.string(), z.number()]).optional(),
    dueDateMs: z.number().int().nonnegative().optional(),
    timeEstimateMs: z.number().int().nonnegative().optional(),
    tags: z.array(z.string()).max(50).optional(),
    customFields: z.array(CustomFieldPatch).max(25).optional(),
    appendMarkdownDescription: z.string().min(1).optional(),
    addCommentMarkdown: z.string().min(1).optional()
  })
  .strict();

export const UpdateTaskOutput = z
  .object({
    taskId: z.string(),
    updated: z
      .object({
        core: z.boolean(),
        customFields: z.number().int().nonnegative(),
        descriptionAppended: z.boolean(),
        commentAdded: z.boolean()
      })
      .strict(),
    url: z.string().optional(),
    truncated: z.boolean().optional(),
    guidance: z.string().optional()
  })
  .strict();
