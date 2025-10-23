import { z } from "zod";

export const CreateTaskInput = z
  .object({
    listId: z.string().min(1),
    name: z.string().min(1),
    description: z.string().optional(),
    assigneeIds: z.array(z.number().int()).max(20).optional(),
    status: z.string().optional(),
    priority: z.union([z.string(), z.number()]).optional(),
    dueDateMs: z.number().int().nonnegative().optional(),
    timeEstimateMs: z.number().int().nonnegative().optional(),
    tags: z.array(z.string()).max(50).optional()
  })
  .strict();

export const TaskRef = z
  .object({
    taskId: z.string(),
    url: z.string().optional()
  })
  .strict();

export const CreateTaskOutput = z
  .object({
    task: TaskRef,
    truncated: z.boolean().optional(),
    guidance: z.string().optional()
  })
  .strict();

export const MoveTaskInput = z
  .object({
    taskId: z.string().min(1),
    targetListId: z.string().min(1)
  })
  .strict();

export const DuplicateTaskInput = z
  .object({
    taskId: z.string().min(1),
    include: z
      .object({
        assignees: z.boolean().default(true),
        attachments: z.boolean().default(false),
        comments: z.boolean().default(false),
        customFields: z.boolean().default(true),
        tags: z.boolean().default(true),
        checklists: z.boolean().default(true),
        subtasks: z.boolean().default(true)
      })
      .default({})
  })
  .strict();

export const DeleteTaskInput = z
  .object({
    taskId: z.string().min(1),
    confirm: z.literal("yes").default("yes")
  })
  .strict();

export const SearchTasksInput = z
  .object({
    teamId: z.number().int().positive().optional(),
    listIds: z.array(z.string()).max(50).optional(),
    spaceIds: z.array(z.string()).max(50).optional(),
    assigneeIds: z.array(z.number().int()).max(50).optional(),
    statuses: z.array(z.string()).max(50).optional(),
    includeClosed: z.boolean().default(false),
    query: z.string().min(0).max(200).default(""),
    page: z.number().int().min(0).default(0),
    limit: z.number().int().min(1).max(100).default(50)
  })
  .strict();

export const SearchTaskItem = z
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
      .array(z.object({ id: z.number().int(), username: z.string().nullable() }))
      .default([]),
    dateUpdated: z.string().nullable()
  })
  .strict();

export const SearchTasksOutput = z
  .object({
    total: z.number().int().nonnegative(),
    page: z.number().int().nonnegative(),
    limit: z.number().int().positive(),
    hasMore: z.boolean(),
    results: z.array(SearchTaskItem),
    truncated: z.boolean().optional(),
    guidance: z.string().optional()
  })
  .strict();

export const CommentTaskInput = z
  .object({
    taskId: z.string().min(1),
    commentMarkdown: z.string().min(1)
  })
  .strict();

export const CommentTaskOutput = z
  .object({
    task: TaskRef,
    commentId: z.string().optional(),
    truncated: z.boolean().optional(),
    guidance: z.string().optional()
  })
  .strict();

export const AttachFileToTaskInput = z
  .object({
    taskId: z.string().min(1),
    dataUri: z.string().min(1),
    name: z.string().min(1)
  })
  .strict();

export const AttachFileToTaskOutput = z
  .object({
    task: TaskRef,
    attachmentId: z.string().optional(),
    sizeBytes: z.number().int().nonnegative().optional(),
    truncated: z.boolean().optional(),
    guidance: z.string().optional()
  })
  .strict();

export const AddTagsToTaskInput = z
  .object({
    taskId: z.string().min(1),
    tags: z.array(z.string().min(1)).min(1).max(50)
  })
  .strict();

export const RemoveTagsFromTaskInput = z
  .object({
    taskId: z.string().min(1),
    tags: z.array(z.string().min(1)).min(1).max(50)
  })
  .strict();

export const TagsOutput = z
  .object({
    task: TaskRef,
    added: z.array(z.string()).default([]),
    removed: z.array(z.string()).default([]),
    truncated: z.boolean().optional(),
    guidance: z.string().optional()
  })
  .strict();
