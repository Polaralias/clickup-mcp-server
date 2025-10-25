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
    tags: z.array(z.string()).max(50).optional(),
    dryRun: z.boolean().optional()
  })
  .strict();

export const TaskRef = z
  .object({
    taskId: z.string(),
    url: z.string().optional()
  })
  .strict();

const CreateTaskExecutionOutput = z
  .object({
    task: TaskRef,
    truncated: z.boolean().optional(),
    guidance: z.string().optional()
  })
  .strict();

const CreateTaskDryRunOutput = z
  .object({
    dryRun: z.literal(true),
    preview: z
      .object({
        listId: z.string(),
        body: z.record(z.unknown())
      })
      .strict(),
    truncated: z.boolean().optional(),
    guidance: z.string().optional()
  })
  .strict();

export const CreateTaskOutput = z.union([CreateTaskExecutionOutput, CreateTaskDryRunOutput]);

export type CreateTaskSuccessOutput = z.infer<typeof CreateTaskExecutionOutput>;

export const MoveTaskInput = z
  .object({
    taskId: z.string().min(1),
    targetListId: z.string().min(1),
    dryRun: z.boolean().optional()
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
      .default({}),
    dryRun: z.boolean().optional()
  })
  .strict();

const MoveTaskExecutionOutput = CreateTaskExecutionOutput;

const MoveTaskDryRunOutput = z
  .object({
    dryRun: z.literal(true),
    preview: z
      .object({
        taskId: z.string(),
        targetListId: z.string()
      })
      .strict(),
    truncated: z.boolean().optional(),
    guidance: z.string().optional()
  })
  .strict();

export const MoveTaskOutput = z.union([MoveTaskExecutionOutput, MoveTaskDryRunOutput]);

const DuplicateTaskExecutionOutput = CreateTaskExecutionOutput;

const DuplicateTaskDryRunOutput = z
  .object({
    dryRun: z.literal(true),
    preview: z
      .object({
        taskId: z.string(),
        include: z
          .object({
            assignees: z.boolean(),
            attachments: z.boolean(),
            comments: z.boolean(),
            customFields: z.boolean(),
            tags: z.boolean(),
            checklists: z.boolean(),
            subtasks: z.boolean()
          })
          .strict()
      })
      .strict(),
    truncated: z.boolean().optional(),
    guidance: z.string().optional()
  })
  .strict();

export const DuplicateTaskOutput = z.union([DuplicateTaskExecutionOutput, DuplicateTaskDryRunOutput]);

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
    commentMarkdown: z.string().min(1),
    dryRun: z.boolean().optional()
  })
  .strict();

const CommentTaskExecutionOutput = z
  .object({
    task: TaskRef,
    commentId: z.string().optional(),
    truncated: z.boolean().optional(),
    guidance: z.string().optional()
  })
  .strict();

const CommentTaskDryRunOutput = z
  .object({
    dryRun: z.literal(true),
    preview: z
      .object({
        taskId: z.string(),
        markdown: z.string()
      })
      .strict(),
    truncated: z.boolean().optional(),
    guidance: z.string().optional()
  })
  .strict();

export const CommentTaskOutput = z.union([CommentTaskExecutionOutput, CommentTaskDryRunOutput]);

export const AttachFileToTaskInput = z
  .object({
    taskId: z.string().min(1),
    dataUri: z.string().min(1),
    name: z.string().min(1),
    confirm: z.literal("yes").optional(),
    dryRun: z.boolean().optional()
  })
  .strict();

const AttachFileToTaskExecutionOutput = z
  .object({
    task: TaskRef,
    attachmentId: z.string().optional(),
    sizeBytes: z.number().int().nonnegative().optional(),
    truncated: z.boolean().optional(),
    guidance: z.string().optional()
  })
  .strict();

const AttachFileToTaskDryRunOutput = z
  .object({
    dryRun: z.literal(true),
    preview: z
      .object({
        taskId: z.string(),
        name: z.string(),
        sizeBytes: z.number().int().nonnegative()
      })
      .strict(),
    truncated: z.boolean().optional(),
    guidance: z.string().optional()
  })
  .strict();

export const AttachFileToTaskOutput = z.union([AttachFileToTaskExecutionOutput, AttachFileToTaskDryRunOutput]);

export const AddTagsToTaskInput = z
  .object({
    taskId: z.string().min(1),
    tags: z.array(z.string().min(1)).min(1).max(50),
    dryRun: z.boolean().optional()
  })
  .strict();

export const RemoveTagsFromTaskInput = z
  .object({
    taskId: z.string().min(1),
    tags: z.array(z.string().min(1)).min(1).max(50),
    dryRun: z.boolean().optional()
  })
  .strict();

const TagsExecutionOutput = z
  .object({
    task: TaskRef,
    added: z.array(z.string()).default([]),
    removed: z.array(z.string()).default([]),
    truncated: z.boolean().optional(),
    guidance: z.string().optional()
  })
  .strict();

const TagsDryRunOutput = z
  .object({
    dryRun: z.literal(true),
    preview: z
      .object({
        taskId: z.string(),
        action: z.enum(["add", "remove"]),
        tags: z.array(z.string())
      })
      .strict(),
    truncated: z.boolean().optional(),
    guidance: z.string().optional()
  })
  .strict();

export const TagsOutput = z.union([TagsExecutionOutput, TagsDryRunOutput]);
