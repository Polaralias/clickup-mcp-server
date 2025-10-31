import type { Server as McpServer } from "@modelcontextprotocol/sdk/server/index.js";
import { z } from "zod";
import { CHARACTER_LIMIT, PROJECT_NAME } from "../../config/constants.js";
import type { RuntimeConfig } from "../../config/runtime.js";
import { err, ok, Result } from "../../shared/Result.js";
import {
  DocSearchInput,
  DocSearchOutput,
  BulkDocSearchInput,
  BulkDocSearchOutput
} from "./schemas/doc.js";
import {
  CreateDocInput,
  CreateDocOutput,
  ListDocPagesInput,
  ListDocPagesOutput,
  GetDocPageInput,
  GetDocPageOutput,
  UpdateDocPageInput,
  UpdateDocPageOutput
} from "./schemas/docCrud.js";
import {
  TaskFuzzySearchInput,
  TaskFuzzySearchOutput,
  BulkTaskFuzzySearchInput,
  BulkTaskFuzzySearchOutput
} from "./schemas/taskSearch.js";
import type { TaskScopeType } from "./schemas/taskSearch.js";
import {
  CreateTaskInput,
  CreateTaskOutput,
  MoveTaskInput,
  MoveTaskOutput,
  DuplicateTaskInput,
  DuplicateTaskOutput,
  DeleteTaskInput,
  SearchTasksInput,
  SearchTasksOutput,
  CommentTaskInput,
  CommentTaskOutput,
  AttachFileToTaskInput,
  AttachFileToTaskOutput,
  AddTagsToTaskInput,
  RemoveTagsFromTaskInput,
  TagsOutput
} from "./schemas/taskCrud.js";
import { CatalogueRequest, CatalogueOutput } from "./schemas/catalogue.js";
import { UpdateTaskInput, UpdateTaskOutput } from "./schemas/taskUpdate.js";
import {
  StartTimerInput,
  StopTimerInput,
  TimerOutput,
  CreateEntryInput,
  UpdateEntryInput,
  DeleteEntryInput,
  ListEntriesInput,
  ListEntriesOutput,
  ReportForTagInput,
  ReportOutput,
  ReportForContainerInput,
  ReportForSpaceTagInput
} from "./schemas/time.js";
import { DocSearch } from "../../application/usecases/DocSearch.js";
import { BulkDocSearch } from "../../application/usecases/BulkDocSearch.js";
import { CreateDoc } from "../../application/usecases/docs/CreateDoc.js";
import { ListDocPages } from "../../application/usecases/docs/ListDocPages.js";
import { GetDocPage } from "../../application/usecases/docs/GetDocPage.js";
import { UpdateDocPage } from "../../application/usecases/docs/UpdateDocPage.js";
import { TaskSearchIndex, type TaskIndexRecord } from "../../application/services/TaskSearchIndex.js";
import { TaskFuzzySearch } from "../../application/usecases/TaskFuzzySearch.js";
import { BulkTaskFuzzySearch } from "../../application/usecases/BulkTaskFuzzySearch.js";
import { UpdateTask } from "../../application/usecases/UpdateTask.js";
import { CreateTask } from "../../application/usecases/tasks/CreateTask.js";
import { MoveTask } from "../../application/usecases/tasks/MoveTask.js";
import { DuplicateTask } from "../../application/usecases/tasks/DuplicateTask.js";
import { DeleteTask } from "../../application/usecases/tasks/DeleteTask.js";
import { SearchTasks } from "../../application/usecases/tasks/SearchTasks.js";
import { CommentTask } from "../../application/usecases/tasks/CommentTask.js";
import { AttachFileToTask } from "../../application/usecases/tasks/AttachFileToTask.js";
import { AddTagsToTask, RemoveTagsFromTask } from "../../application/usecases/tasks/Tags.js";
import { StartTimer } from "../../application/usecases/time/StartTimer.js";
import { StopTimer } from "../../application/usecases/time/StopTimer.js";
import { CreateEntry } from "../../application/usecases/time/CreateEntry.js";
import { UpdateEntry } from "../../application/usecases/time/UpdateEntry.js";
import { DeleteEntry } from "../../application/usecases/time/DeleteEntry.js";
import { ListEntries } from "../../application/usecases/time/ListEntries.js";
import { ReportTimeForTag } from "../../application/usecases/time/ReportTimeForTag.js";
import { ReportTimeForContainer } from "../../application/usecases/time/ReportTimeForContainer.js";
import { ReportTimeForSpaceTag } from "../../application/usecases/time/ReportTimeForSpaceTag.js";
import { ApiCache } from "../../infrastructure/cache/ApiCache.js";
import { makeMemoryKV } from "../../shared/KV.js";
import { HttpClient } from "../../infrastructure/http/HttpClient.js";
import { ClickUpGateway } from "../../infrastructure/clickup/ClickUpGateway.js";
import type { ClickUpGatewayConfig, AuthScheme } from "../../infrastructure/clickup/ClickUpGateway.js";
import type { SessionConfig } from "../../shared/config/schema.js";
import {
  ListWorkspacesInput,
  ListSpacesInput,
  ListFoldersInput,
  ListListsInput,
  ListTagsForSpaceInput,
  ListMembersInput,
  ResolveMembersInput,
  ResolvePathInput,
  WorkspaceOverviewInput
} from "./schemas/hierarchy.js";
import { Workspaces } from "../../application/usecases/hierarchy/Workspaces.js";
import { Spaces } from "../../application/usecases/hierarchy/Spaces.js";
import { Folders } from "../../application/usecases/hierarchy/Folders.js";
import { Lists } from "../../application/usecases/hierarchy/Lists.js";
import { Tags } from "../../application/usecases/hierarchy/Tags.js";
import { Members } from "../../application/usecases/members/Members.js";
import { ResolveMembers } from "../../application/usecases/members/ResolveMembers.js";
import { ResolvePath } from "../../application/usecases/resolve/ResolvePath.js";
import { WorkspaceOverview } from "../../application/usecases/hierarchy/WorkspaceOverview.js";
import { buildCatalogue, type ToolDef } from "./catalogue.js";
import { withSafetyConfirmation } from "../middleware/Safety.js";
import { PACKAGE_VERSION } from "../../shared/version.js";

type ToolAnnotations = { readOnlyHint: boolean; idempotentHint: boolean; destructiveHint: boolean };

type ToolContext = { server: McpServer; runtime: RuntimeConfig };

type ToolExecutor<TOutput> = (input: unknown, context: ToolContext) => Promise<Result<TOutput>>;

type JsonSchema = Record<string, unknown>;

type ToolDependencies = { gateway?: ClickUpGateway; cache?: ApiCache };

type DocSearchOutputType = z.infer<typeof DocSearchOutput>;
type BulkDocSearchOutputType = z.infer<typeof BulkDocSearchOutput>;
type TaskFuzzySearchInputType = z.infer<typeof TaskFuzzySearchInput>;
type TaskFuzzySearchOutputType = z.infer<typeof TaskFuzzySearchOutput>;
type BulkTaskFuzzySearchInputType = z.infer<typeof BulkTaskFuzzySearchInput>;
type BulkTaskFuzzySearchOutputType = z.infer<typeof BulkTaskFuzzySearchOutput>;
type UpdateTaskOutputType = z.infer<typeof UpdateTaskOutput>;
type CreateTaskOutputType = z.infer<typeof CreateTaskOutput>;
type MoveTaskOutputType = z.infer<typeof MoveTaskOutput>;
type DuplicateTaskOutputType = z.infer<typeof DuplicateTaskOutput>;
type SearchTasksOutputType = z.infer<typeof SearchTasksOutput>;
type CommentTaskOutputType = z.infer<typeof CommentTaskOutput>;
type AttachFileToTaskOutputType = z.infer<typeof AttachFileToTaskOutput>;
type TagsOutputType = z.infer<typeof TagsOutput>;
type CatalogueOutputType = z.infer<typeof CatalogueOutput>;
type TimerOutputType = z.infer<typeof TimerOutput>;
type ListEntriesOutputType = z.infer<typeof ListEntriesOutput>;
type ReportOutputType = z.infer<typeof ReportOutput>;
type CreateDocOutputType = z.infer<typeof CreateDocOutput>;
type ListDocPagesOutputType = z.infer<typeof ListDocPagesOutput>;
type GetDocPageOutputType = z.infer<typeof GetDocPageOutput>;
type UpdateDocPageOutputType = z.infer<typeof UpdateDocPageOutput>;

export type RegisteredTool<TOutput = unknown> = {
  name: string;
  description: string;
  annotations: ToolAnnotations;
  inputSchema: z.ZodTypeAny;
  inputJsonSchema: JsonSchema;
  execute: ToolExecutor<TOutput>;
  requiresAuth?: boolean;
};

const healthInputSchema = z.object({}).strict();
const healthInputJsonSchema: JsonSchema = { type: "object", properties: {}, required: [], additionalProperties: false };

const catalogueInputJsonSchema: JsonSchema = { type: "object", properties: {}, required: [], additionalProperties: false };

const docSearchInputJsonSchema: JsonSchema = {
  type: "object",
  properties: {
    workspaceId: { type: "integer", minimum: 1 },
    query: { type: "string", minLength: 1 },
    limit: { type: "integer", minimum: 1, maximum: 50, default: 20 },
    page: { type: "integer", minimum: 0, default: 0 },
    contentFormat: { type: "string", enum: ["text/md", "text/html", "application/json"] },
    expandPages: { type: "boolean", default: false },
    pageBody: {
      type: "object",
      properties: {
        contentFormat: { type: "string", enum: ["text/md", "text/html", "application/json"] },
        limit: { type: "integer", minimum: 1, maximum: 10 }
      },
      required: [],
      additionalProperties: false
    }
  },
  required: ["workspaceId", "query"],
  additionalProperties: false
};

const createDocInputJsonSchema: JsonSchema = {
  type: "object",
  properties: {
    workspaceId: { type: "integer", minimum: 1 },
    title: { type: "string", minLength: 1 },
    visibility: { type: "string", enum: ["PUBLIC", "PRIVATE", "PERSONAL", "HIDDEN"], default: "PRIVATE" },
    confirm: { type: "string", enum: ["yes"] },
    dryRun: { type: "boolean" }
  },
  required: ["workspaceId", "title"],
  additionalProperties: false
};

const listDocPagesInputJsonSchema: JsonSchema = {
  type: "object",
  properties: {
    workspaceId: { type: "integer", minimum: 1 },
    docId: { type: "string", minLength: 1 },
    limit: { type: "integer", minimum: 1, maximum: 50, default: 20 },
    page: { type: "integer", minimum: 0, default: 0 }
  },
  required: ["workspaceId", "docId"],
  additionalProperties: false
};

const getDocPageInputJsonSchema: JsonSchema = {
  type: "object",
  properties: {
    workspaceId: { type: "integer", minimum: 1 },
    docId: { type: "string", minLength: 1 },
    pageId: { type: "string", minLength: 1 },
    contentFormat: { type: "string", enum: ["text/md", "text/html", "application/json"], default: "text/md" }
  },
  required: ["workspaceId", "docId", "pageId"],
  additionalProperties: false
};

const updateDocPageInputJsonSchema: JsonSchema = {
  type: "object",
  properties: {
    workspaceId: { type: "integer", minimum: 1 },
    docId: { type: "string", minLength: 1 },
    pageId: { type: "string", minLength: 1 },
    contentFormat: { type: "string", enum: ["text/md", "text/html", "application/json"], default: "text/md" },
    content: { type: "string", minLength: 1 },
    title: { type: "string" },
    dryRun: { type: "boolean" }
  },
  required: ["workspaceId", "docId", "pageId", "content"],
  additionalProperties: false
};

const updateTaskInputJsonSchema: JsonSchema = {
  type: "object",
  properties: {
    taskId: { type: "string", minLength: 1 },
    name: { type: "string", minLength: 1 },
    status: { type: "string", minLength: 1 },
    assigneeIds: { type: "array", items: { type: "integer" }, maxItems: 20 },
    priority: { anyOf: [{ type: "string" }, { type: "number" }] },
    dueDateMs: { type: "integer", minimum: 0 },
    timeEstimateMs: { type: "integer", minimum: 0 },
    tags: { type: "array", items: { type: "string" }, maxItems: 50 },
    customFields: {
      type: "array",
      maxItems: 25,
      items: {
        type: "object",
        properties: {
          fieldId: { type: "string", minLength: 1 },
          value: {},
          value_options: { type: "object" }
        },
        required: ["fieldId", "value"],
        additionalProperties: false
      }
    },
    appendMarkdownDescription: { type: "string", minLength: 1 },
    addCommentMarkdown: { type: "string", minLength: 1 },
    dryRun: { type: "boolean" }
  },
  required: ["taskId"],
  additionalProperties: false
};

const createTaskInputJsonSchema: JsonSchema = {
  type: "object",
  properties: {
    listId: { type: "string", minLength: 1 },
    name: { type: "string", minLength: 1 },
    description: { type: "string" },
    assigneeIds: { type: "array", items: { type: "integer" }, maxItems: 20 },
    status: { type: "string" },
    priority: { anyOf: [{ type: "string" }, { type: "number" }] },
    dueDateMs: { type: "integer", minimum: 0 },
    timeEstimateMs: { type: "integer", minimum: 0 },
    tags: { type: "array", items: { type: "string" }, maxItems: 50 },
    dryRun: { type: "boolean" }
  },
  required: ["listId", "name"],
  additionalProperties: false
};

const moveTaskInputJsonSchema: JsonSchema = {
  type: "object",
  properties: {
    taskId: { type: "string", minLength: 1 },
    targetListId: { type: "string", minLength: 1 },
    dryRun: { type: "boolean" }
  },
  required: ["taskId", "targetListId"],
  additionalProperties: false
};

const duplicateTaskInputJsonSchema: JsonSchema = {
  type: "object",
  properties: {
    taskId: { type: "string", minLength: 1 },
    include: {
      type: "object",
      properties: {
        assignees: { type: "boolean", default: true },
        attachments: { type: "boolean", default: false },
        comments: { type: "boolean", default: false },
        customFields: { type: "boolean", default: true },
        tags: { type: "boolean", default: true },
        checklists: { type: "boolean", default: true },
        subtasks: { type: "boolean", default: true }
      },
      required: [],
      additionalProperties: false,
      default: {}
    },
    dryRun: { type: "boolean" }
  },
  required: ["taskId"],
  additionalProperties: false
};

const deleteTaskInputJsonSchema: JsonSchema = {
  type: "object",
  properties: {
    taskId: { type: "string", minLength: 1 },
    confirm: { type: "string", enum: ["yes"], default: "yes" }
  },
  required: ["taskId"],
  additionalProperties: false
};

const startTimerInputJsonSchema: JsonSchema = {
  type: "object",
  properties: {
    taskId: { type: "string", minLength: 1 },
    description: { type: "string" },
    confirm: { type: "string", enum: ["yes"] },
    dryRun: { type: "boolean" }
  },
  required: ["taskId"],
  additionalProperties: false
};

const stopTimerInputJsonSchema: JsonSchema = {
  type: "object",
  properties: {
    taskId: { type: "string", minLength: 1 },
    confirm: { type: "string", enum: ["yes"] },
    dryRun: { type: "boolean" }
  },
  required: ["taskId"],
  additionalProperties: false
};

const createTimeEntryInputJsonSchema: JsonSchema = {
  type: "object",
  properties: {
    taskId: { type: "string", minLength: 1 },
    memberId: { type: "integer", minimum: 1 },
    start: { type: "string", format: "date-time" },
    end: { type: "string", format: "date-time" },
    description: { type: "string" },
    billable: { type: "boolean", default: false },
    dryRun: { type: "boolean" }
  },
  required: ["taskId", "start", "end"],
  additionalProperties: false
};

const updateTimeEntryInputJsonSchema: JsonSchema = {
  type: "object",
  properties: {
    entryId: { type: "string", minLength: 1 },
    start: { type: "string", format: "date-time" },
    end: { type: "string", format: "date-time" },
    description: { type: "string" },
    billable: { type: "boolean" },
    dryRun: { type: "boolean" }
  },
  required: ["entryId"],
  additionalProperties: false
};

const deleteTimeEntryInputJsonSchema: JsonSchema = {
  type: "object",
  properties: {
    entryId: { type: "string", minLength: 1 },
    confirm: { type: "string", enum: ["yes"], default: "yes" }
  },
  required: ["entryId"],
  additionalProperties: false
};

const listTimeEntriesInputJsonSchema: JsonSchema = {
  type: "object",
  properties: {
    teamId: { type: "integer", minimum: 1 },
    memberIds: { type: "array", items: { type: "integer", minimum: 1 }, maxItems: 50 },
    taskIds: { type: "array", items: { type: "string" }, maxItems: 50 },
    since: { type: "string", format: "date-time" },
    until: { type: "string", format: "date-time" },
    page: { type: "integer", minimum: 0, default: 0 },
    limit: { type: "integer", minimum: 1, maximum: 100, default: 50 },
    includeRunning: { type: "boolean", default: true },
    includeBillable: { type: "boolean", default: true }
  },
  required: ["teamId"],
  additionalProperties: false
};

const reportForTagInputJsonSchema: JsonSchema = {
  type: "object",
  properties: {
    teamId: { type: "integer", minimum: 1 },
    since: { type: "string", format: "date-time" },
    until: { type: "string", format: "date-time" },
    includeBillable: { type: "boolean", default: true },
    memberIds: { type: "array", items: { type: "integer", minimum: 1 }, maxItems: 50 },
    tag: { type: "string", minLength: 1 }
  },
  required: ["teamId", "tag"],
  additionalProperties: false
};

const reportForSpaceTagInputJsonSchema: JsonSchema = {
  type: "object",
  properties: {
    teamId: { type: "integer", minimum: 1 },
    spaceId: { type: "string", minLength: 1 },
    tag: { type: "string", minLength: 1 },
    since: { type: "string", format: "date-time" },
    until: { type: "string", format: "date-time" },
    includeBillable: { type: "boolean", default: true },
    memberIds: { type: "array", items: { type: "integer", minimum: 1 }, maxItems: 50 }
  },
  required: ["teamId", "spaceId", "tag"],
  additionalProperties: false
};

const containerRefJsonSchema: JsonSchema = {
  type: "object",
  properties: {
    containerType: { type: "string", enum: ["list", "view"] },
    containerId: { type: "string", minLength: 1 }
  },
  required: ["containerType", "containerId"],
  additionalProperties: false
};

const reportForContainerInputJsonSchema: JsonSchema = {
  type: "object",
  properties: {
    teamId: { type: "integer", minimum: 1 },
    since: { type: "string", format: "date-time" },
    until: { type: "string", format: "date-time" },
    includeBillable: { type: "boolean", default: true },
    memberIds: { type: "array", items: { type: "integer", minimum: 1 }, maxItems: 50 },
    ref: containerRefJsonSchema
  },
  required: ["teamId", "ref"],
  additionalProperties: false
};

const searchTasksInputJsonSchema: JsonSchema = {
  type: "object",
  properties: {
    teamId: { type: "integer", minimum: 1 },
    listIds: { type: "array", items: { type: "string" }, maxItems: 50 },
    spaceIds: { type: "array", items: { type: "string" }, maxItems: 50 },
    assigneeIds: { type: "array", items: { type: "integer" }, maxItems: 50 },
    statuses: { type: "array", items: { type: "string" }, maxItems: 50 },
    includeClosed: { type: "boolean", default: false },
    query: { type: "string", minLength: 0, maxLength: 200, default: "" },
    page: { type: "integer", minimum: 0, default: 0 },
    limit: { type: "integer", minimum: 1, maximum: 100, default: 50 }
  },
  required: [],
  additionalProperties: false
};

const commentTaskInputJsonSchema: JsonSchema = {
  type: "object",
  properties: {
    taskId: { type: "string", minLength: 1 },
    commentMarkdown: { type: "string", minLength: 1 },
    dryRun: { type: "boolean" }
  },
  required: ["taskId", "commentMarkdown"],
  additionalProperties: false
};

const attachFileToTaskInputJsonSchema: JsonSchema = {
  type: "object",
  properties: {
    taskId: { type: "string", minLength: 1 },
    dataUri: { type: "string", minLength: 1 },
    name: { type: "string", minLength: 1 },
    confirm: { type: "string", enum: ["yes"] },
    dryRun: { type: "boolean" }
  },
  required: ["taskId", "dataUri", "name"],
  additionalProperties: false
};

const addTagsToTaskInputJsonSchema: JsonSchema = {
  type: "object",
  properties: {
    taskId: { type: "string", minLength: 1 },
    tags: { type: "array", items: { type: "string", minLength: 1 }, minItems: 1, maxItems: 50 },
    dryRun: { type: "boolean" }
  },
  required: ["taskId", "tags"],
  additionalProperties: false
};

const removeTagsFromTaskInputJsonSchema: JsonSchema = {
  type: "object",
  properties: {
    taskId: { type: "string", minLength: 1 },
    tags: { type: "array", items: { type: "string", minLength: 1 }, minItems: 1, maxItems: 50 },
    dryRun: { type: "boolean" }
  },
  required: ["taskId", "tags"],
  additionalProperties: false
};

const bulkDocSearchInputJsonSchema: JsonSchema = {
  type: "object",
  properties: {
    workspaceId: { type: "integer", minimum: 1 },
    queries: { type: "array", items: { type: "string", minLength: 1 }, minItems: 1, maxItems: 25 },
    options: {
      type: "object",
      properties: {
        limit: { type: "integer", minimum: 1, maximum: 50 },
        page: { type: "integer", minimum: 0 },
        concurrency: { type: "integer", minimum: 1, maximum: 10 },
        retryCount: { type: "integer", minimum: 0, maximum: 6 },
        retryDelayMs: { type: "integer", minimum: 0 },
        exponentialBackoff: { type: "boolean" },
        continueOnError: { type: "boolean" }
      },
      required: [],
      additionalProperties: false,
      default: {}
    }
  },
  required: ["workspaceId", "queries"],
  additionalProperties: false
};

const taskScopeJsonSchema: JsonSchema = {
  type: "object",
  properties: {
    teamId: { type: "integer", minimum: 1 },
    spaceIds: { type: "array", items: { type: "string" }, maxItems: 50 },
    listIds: { type: "array", items: { type: "string" }, maxItems: 50 },
    assigneeIds: { type: "array", items: { type: "integer" }, maxItems: 50 },
    statuses: { type: "array", items: { type: "string" }, maxItems: 50 },
    includeClosed: { type: "boolean" },
    updatedSince: { type: "string", format: "date-time" }
  },
  required: [],
  additionalProperties: false
};

const taskFuzzySearchInputJsonSchema: JsonSchema = {
  type: "object",
  properties: {
    query: { type: "string", minLength: 1 },
    scope: taskScopeJsonSchema,
    limit: { type: "integer", minimum: 1, maximum: 50, default: 20 }
  },
  required: ["query"],
  additionalProperties: false
};

const bulkTaskFuzzySearchInputJsonSchema: JsonSchema = {
  type: "object",
  properties: {
    queries: { type: "array", items: { type: "string", minLength: 1 }, minItems: 1, maxItems: 25 },
    scope: taskScopeJsonSchema,
    options: {
      type: "object",
      properties: {
        limit: { type: "integer", minimum: 1, maximum: 50 },
        concurrency: { type: "integer", minimum: 1, maximum: 10 }
      },
      required: [],
      additionalProperties: false,
      default: {}
    }
  },
  required: ["queries"],
  additionalProperties: false
};

const listWorkspacesInputJsonSchema: JsonSchema = { type: "object", properties: {}, required: [], additionalProperties: false };

const listSpacesInputJsonSchema: JsonSchema = {
  type: "object",
  properties: {
    teamId: { type: "integer", minimum: 1 },
    includeArchived: { type: "boolean", default: false },
    limit: { type: "integer", minimum: 1, maximum: 100, default: 50 },
    page: { type: "integer", minimum: 0, default: 0 }
  },
  required: ["teamId"],
  additionalProperties: false
};

const listFoldersInputJsonSchema: JsonSchema = {
  type: "object",
  properties: {
    spaceId: { type: "string", minLength: 1 },
    includeArchived: { type: "boolean", default: false },
    limit: { type: "integer", minimum: 1, maximum: 100, default: 50 },
    page: { type: "integer", minimum: 0, default: 0 }
  },
  required: ["spaceId"],
  additionalProperties: false
};

const listListsInputJsonSchema: JsonSchema = {
  type: "object",
  properties: {
    parentType: { type: "string", enum: ["space", "folder"] },
    parentId: { type: "string", minLength: 1 },
    includeArchived: { type: "boolean", default: false },
    limit: { type: "integer", minimum: 1, maximum: 100, default: 50 },
    page: { type: "integer", minimum: 0, default: 0 }
  },
  required: ["parentType", "parentId"],
  additionalProperties: false
};

const listTagsInputJsonSchema: JsonSchema = {
  type: "object",
  properties: {
    spaceId: { type: "string", minLength: 1 }
  },
  required: ["spaceId"],
  additionalProperties: false
};

const listMembersInputJsonSchema: JsonSchema = {
  type: "object",
  properties: {
    teamId: { type: "integer", minimum: 1 },
    limit: { type: "integer", minimum: 1, maximum: 100, default: 50 },
    page: { type: "integer", minimum: 0, default: 0 }
  },
  required: ["teamId"],
  additionalProperties: false
};

const resolveMembersInputJsonSchema: JsonSchema = {
  type: "object",
  properties: {
    teamId: { type: "integer", minimum: 1 },
    queries: { type: "array", items: { type: "string", minLength: 1 }, minItems: 1, maxItems: 50 }
  },
  required: ["teamId", "queries"],
  additionalProperties: false
};

const resolvePathInputJsonSchema: JsonSchema = {
  type: "object",
  properties: {
    teamId: { type: "integer", minimum: 1 },
    path: { type: "string", minLength: 1 }
  },
  required: ["teamId", "path"],
  additionalProperties: false
};

const workspaceOverviewInputJsonSchema: JsonSchema = {
  type: "object",
  properties: {
    teamId: { type: "integer", minimum: 1 },
    includeArchived: { type: "boolean", default: false }
  },
  required: ["teamId"],
  additionalProperties: false
};

type HealthPayload = {
  service: string;
  version: string;
  pid: number;
  character_limit: number;
  features: { persistence: boolean };
  now: string;
};

function parseNumber(value: string | undefined, fallback: number): number {
  if (!value) {
    return fallback;
  }
  const parsed = Number.parseInt(value, 10);
  if (Number.isNaN(parsed)) {
    return fallback;
  }
  return parsed;
}

function parseOptionalNumber(value: string | undefined): number | undefined {
  if (!value) {
    return undefined;
  }
  const parsed = Number.parseInt(value, 10);
  if (Number.isNaN(parsed)) {
    return undefined;
  }
  return parsed;
}

function resolveAuthScheme(value: string | undefined): AuthScheme {
  if (value === "oauth" || value === "personal_token" || value === "auto") {
    return value;
  }
  return "auto";
}

function sanitiseBaseUrl(baseUrl: string): string {
  const trimmed = baseUrl.trim();
  if (trimmed.length === 0) {
    return "https://api.clickup.com";
  }
  try {
    const parsed = new URL(trimmed);
    if (/^\/api\/v\d+$/i.test(parsed.pathname)) {
      parsed.pathname = "";
    }
    return parsed.toString().replace(/\/+$/, "");
  } catch {
    return trimmed.replace(/\/+$/, "");
  }
}

function resolveGatewayConfig(session: SessionConfig): {
  config: ClickUpGatewayConfig;
  httpBaseUrl: string;
  defaultHeaders: Record<string, string>;
} {
  const envBaseUrl = process.env.CLICKUP_BASE_URL;
  const envToken = process.env.CLICKUP_TOKEN;
  const envTimeoutMs = process.env.CLICKUP_TIMEOUT_MS;
  const envTeamId = process.env.CLICKUP_DEFAULT_TEAM_ID;
  const authScheme = session.authScheme ?? resolveAuthScheme(process.env.CLICKUP_AUTH_SCHEME);
  const baseCandidate = session.baseUrl && session.baseUrl.trim().length > 0 ? session.baseUrl : envBaseUrl ?? "https://api.clickup.com";
  const baseUrl = sanitiseBaseUrl(baseCandidate);
  const tokenCandidate = session.apiToken && session.apiToken.trim().length > 0 ? session.apiToken : envToken ?? "";
  const timeoutMs = session.requestTimeout && Number.isFinite(session.requestTimeout) && session.requestTimeout > 0
    ? Math.trunc(session.requestTimeout * 1000)
    : parseNumber(envTimeoutMs, 10000);
  const defaultTeamId = session.defaultTeamId ?? parseOptionalNumber(envTeamId) ?? 0;
  const defaultHeaders = { ...session.defaultHeaders };
  return {
    config: { baseUrl, token: tokenCandidate, authScheme, timeoutMs, defaultTeamId },
    httpBaseUrl: baseUrl,
    defaultHeaders
  };
}

function toOptionalString(value: unknown): string | undefined {
  if (typeof value === "string") {
    return value;
  }
  if (typeof value === "number" || typeof value === "boolean" || typeof value === "bigint") {
    return String(value);
  }
  return undefined;
}

function toStringOrEmpty(value: unknown): string {
  const result = toOptionalString(value);
  return result ?? "";
}

function toOptionalId(value: unknown): string | undefined {
  const result = toOptionalString(value);
  if (!result || result.length === 0) {
    return undefined;
  }
  return result;
}

function extractComments(value: unknown): string | undefined {
  if (!Array.isArray(value)) {
    return undefined;
  }
  const parts: string[] = [];
  for (const entry of value) {
    const record = entry as Record<string, unknown> | null | undefined;
    const text = record?.text ?? record?.comment;
    if (typeof text === "string" && text.length > 0) {
      parts.push(text);
    }
  }
  if (parts.length === 0) {
    return undefined;
  }
  return parts.join("\n");
}

function extractCustom(value: unknown): string | undefined {
  if (typeof value === "undefined") {
    return undefined;
  }
  try {
    return JSON.stringify(value);
  } catch (error) {
    void error;
    return undefined;
  }
}

function extractAssignees(value: unknown): TaskIndexRecord["assignees"] {
  if (!Array.isArray(value)) {
    return [];
  }
  const result: TaskIndexRecord["assignees"] = [];
  for (const entry of value) {
    const record = entry as Record<string, unknown> | null | undefined;
    const idNumber = Number(record?.id);
    if (!Number.isFinite(idNumber)) {
      continue;
    }
    const username = typeof record?.username === "string" ? record.username : undefined;
    result.push({ id: Math.trunc(idNumber), username });
  }
  return result;
}

function extractUpdatedAt(value: unknown): string | undefined {
  if (typeof value === "string" || typeof value === "number" || typeof value === "bigint") {
    const numeric = Number(value);
    if (!Number.isNaN(numeric) && Number.isFinite(numeric)) {
      return new Date(numeric).toISOString();
    }
  }
  return undefined;
}

function mapTaskRecord(task: unknown): TaskIndexRecord {
  const record = task as Record<string, unknown> | null | undefined;
  const listRecord = record?.list as Record<string, unknown> | null | undefined;
  const spaceRecord = record?.space as Record<string, unknown> | null | undefined;
  const descriptionSource = record?.description ?? record?.text_content;
  const updatedSource = record?.date_updated ?? record?.dateUpdated ?? record?.updated_at ?? record?.updatedAt;
  const assignees = extractAssignees(record?.assignees);
  return {
    taskId: String(record?.id ?? record?.task_id ?? ""),
    name: toOptionalString(record?.name),
    description: toOptionalString(descriptionSource),
    comments: extractComments(record?.comments),
    custom: extractCustom(record?.custom_fields),
    listId: toOptionalId(listRecord?.id ?? record?.list_id),
    listName: toOptionalString(listRecord?.name),
    spaceId: toOptionalId(spaceRecord?.id ?? record?.space_id),
    spaceName: toOptionalString(spaceRecord?.name),
    status: toOptionalString(record?.status),
    priority: toOptionalString(record?.priority),
    assignees,
    url: toStringOrEmpty(record?.url ?? record?.permalink ?? record?.link),
    updatedAt: extractUpdatedAt(updatedSource)
  };
}

function resolveDependencies(
  session: SessionConfig,
  deps?: ToolDependencies
): { gateway: ClickUpGateway; cache: ApiCache } {
  if (deps?.gateway && deps?.cache) {
    return { gateway: deps.gateway, cache: deps.cache };
  }
  const cache = deps?.cache ?? new ApiCache(makeMemoryKV());
  if (deps?.gateway) {
    return { gateway: deps.gateway, cache };
  }
  const resolution = resolveGatewayConfig(session);
  const client = new HttpClient({ baseUrl: resolution.httpBaseUrl, defaultHeaders: resolution.defaultHeaders });
  const gateway = new ClickUpGateway(client, cache, resolution.config);
  return { gateway, cache };
}

async function executeHealth(input: unknown, context: ToolContext): Promise<Result<HealthPayload>> {
  const parsed = healthInputSchema.safeParse(input ?? {});
  if (!parsed.success) {
    return err("INVALID_PARAMETER", "Invalid parameters", parsed.error.flatten());
  }
  return ok({
    service: PROJECT_NAME,
    version: PACKAGE_VERSION,
    pid: process.pid,
    character_limit: CHARACTER_LIMIT,
    features: { persistence: context.runtime.featurePersistence },
    now: new Date().toISOString()
  });
}

export const healthTool: RegisteredTool<HealthPayload> = {
  name: "health",
  description: "Basic server status",
  annotations: { readOnlyHint: true, idempotentHint: true, destructiveHint: false },
  inputSchema: healthInputSchema,
  inputJsonSchema: healthInputJsonSchema,
  execute: executeHealth,
  requiresAuth: false
};

const pingInputSchema = z.object({
  text: z.string().min(1)
});

const pingInputJsonSchema = {
  type: "object",
  properties: {
    text: { type: "string", minLength: 1 }
  },
  required: ["text"],
  additionalProperties: false
};

type PingPayload = { content: { type: "text"; text: string }[] };

async function executePing(input: unknown): Promise<Result<PingPayload>> {
  const parsed = pingInputSchema.safeParse(input ?? {});
  if (!parsed.success) {
    return err("INVALID_PARAMETER", "Invalid parameters", parsed.error.flatten());
  }
  return ok({ content: [{ type: "text", text: parsed.data.text }] });
}

const pingTool: RegisteredTool<PingPayload> = {
  name: "ping",
  description: "Echo the provided text payload",
  annotations: { readOnlyHint: true, idempotentHint: true, destructiveHint: false },
  inputSchema: pingInputSchema,
  inputJsonSchema: pingInputJsonSchema,
  execute: executePing,
  requiresAuth: false
};

export async function registerTools(
  server: McpServer,
  runtime: RuntimeConfig,
  session: SessionConfig,
  deps?: ToolDependencies
): Promise<RegisteredTool[]> {
  void server;
  const { gateway, cache } = resolveDependencies(session, deps);
  const docSearch = new DocSearch(gateway, cache);
  const bulkDocSearch = new BulkDocSearch(gateway, cache);
  const createDocUsecase = new CreateDoc(gateway);
  const listDocPagesUsecase = new ListDocPages(gateway);
  const getDocPageUsecase = new GetDocPage(gateway);
  const updateDocPageUsecase = new UpdateDocPage(gateway);
  const updateTaskUsecase = new UpdateTask(gateway);
  const createTaskUsecase = new CreateTask(gateway);
  const moveTaskUsecase = new MoveTask(gateway);
  const duplicateTaskUsecase = new DuplicateTask(gateway);
  const deleteTaskUsecase = new DeleteTask(gateway);
  const searchTasksUsecase = new SearchTasks(gateway);
  const commentTaskUsecase = new CommentTask(gateway);
  const attachFileUsecase = new AttachFileToTask(gateway);
  const addTagsUsecase = new AddTagsToTask(gateway);
  const removeTagsUsecase = new RemoveTagsFromTask(gateway);
  const startTimerUsecase = new StartTimer(gateway);
  const stopTimerUsecase = new StopTimer(gateway);
  const createEntryUsecase = new CreateEntry(gateway);
  const updateEntryUsecase = new UpdateEntry(gateway);
  const deleteEntryUsecase = new DeleteEntry(gateway);
  const listEntriesUsecase = new ListEntries(gateway);
  const reportTagUsecase = new ReportTimeForTag(gateway);
  const reportContainerUsecase = new ReportTimeForContainer(gateway);
  const reportSpaceTagUsecase = new ReportTimeForSpaceTag(gateway);
  const taskLoader = async (scope?: unknown): Promise<TaskIndexRecord[]> => {
    const typedScope = scope as TaskScopeType | undefined;
    const rows = await gateway.fetch_tasks_for_index(typedScope);
    const tasks = Array.isArray(rows) ? rows : [];
    return tasks.map(mapTaskRecord);
  };
  const taskIndex = new TaskSearchIndex(taskLoader, 60);
  const taskSearch = new TaskFuzzySearch(taskIndex, gateway);
  const bulkTaskSearch = new BulkTaskFuzzySearch(taskSearch);
  const tools: RegisteredTool[] = [];
  const register = <TOutput>(tool: RegisteredTool<TOutput>): RegisteredTool<TOutput> => {
    const normalised: RegisteredTool<TOutput> = {
      ...tool,
      requiresAuth: tool.requiresAuth ?? true
    };
    tools.push(normalised);
    return normalised;
  };
  register(healthTool);
  register(pingTool);
  const docTool: RegisteredTool<DocSearchOutputType> = {
    name: "clickup_doc_search",
    description: "Search ClickUp Docs by query with pagination and optional inline page expansion",
    annotations: { readOnlyHint: true, idempotentHint: true, destructiveHint: false },
    inputSchema: DocSearchInput,
    inputJsonSchema: docSearchInputJsonSchema,
    execute: async (input, context) => docSearch.execute(context, input as z.infer<typeof DocSearchInput>)
  };
  register(docTool);
  const bulkTool: RegisteredTool<BulkDocSearchOutputType> = {
    name: "clickup_bulk_doc_search",
    description: "Run multiple doc searches concurrently and merge unique pages",
    annotations: { readOnlyHint: true, idempotentHint: true, destructiveHint: false },
    inputSchema: BulkDocSearchInput,
    inputJsonSchema: bulkDocSearchInputJsonSchema,
    execute: async (input, context) => bulkDocSearch.execute(context, input as z.infer<typeof BulkDocSearchInput>)
  };
  register(bulkTool);
  const createDocTool: RegisteredTool<CreateDocOutputType> = {
    name: "clickup_create_doc",
    description: "Create a doc in a workspace",
    annotations: { readOnlyHint: false, idempotentHint: false, destructiveHint: true },
    inputSchema: CreateDocInput,
    inputJsonSchema: createDocInputJsonSchema,
    execute: withSafetyConfirmation<CreateDocOutputType>(async (input, context) =>
      createDocUsecase.execute(context, input as z.infer<typeof CreateDocInput>)
    )
  };
  register(createDocTool);
  const listDocPagesTool: RegisteredTool<ListDocPagesOutputType> = {
    name: "clickup_list_doc_pages",
    description: "List pages within a doc with paging",
    annotations: { readOnlyHint: true, idempotentHint: true, destructiveHint: false },
    inputSchema: ListDocPagesInput,
    inputJsonSchema: listDocPagesInputJsonSchema,
    execute: async (input, context) => listDocPagesUsecase.execute(context, input as z.infer<typeof ListDocPagesInput>)
  };
  register(listDocPagesTool);
  const getDocPageTool: RegisteredTool<GetDocPageOutputType> = {
    name: "clickup_get_doc_page",
    description: "Get a page’s content in a specific format",
    annotations: { readOnlyHint: true, idempotentHint: true, destructiveHint: false },
    inputSchema: GetDocPageInput,
    inputJsonSchema: getDocPageInputJsonSchema,
    execute: async (input, context) => getDocPageUsecase.execute(context, input as z.infer<typeof GetDocPageInput>)
  };
  register(getDocPageTool);
  const updateDocPageTool: RegisteredTool<UpdateDocPageOutputType> = {
    name: "clickup_update_doc_page",
    description: "Update a page’s content and optionally title",
    annotations: { readOnlyHint: false, idempotentHint: false, destructiveHint: true },
    inputSchema: UpdateDocPageInput,
    inputJsonSchema: updateDocPageInputJsonSchema,
    execute: async (input, context) => updateDocPageUsecase.execute(context, input as z.infer<typeof UpdateDocPageInput>)
  };
  register(updateDocPageTool);
  const updateTool: RegisteredTool<UpdateTaskOutputType> = {
    name: "clickup_update_task",
    description: "Update a task and optionally set custom fields, append to description, and add a comment",
    annotations: { readOnlyHint: false, idempotentHint: false, destructiveHint: false },
    inputSchema: UpdateTaskInput,
    inputJsonSchema: updateTaskInputJsonSchema,
    execute: async (input, context) => updateTaskUsecase.execute(context, input as z.infer<typeof UpdateTaskInput>)
  };
  register(updateTool);
  const createTaskTool: RegisteredTool<CreateTaskOutputType> = {
    name: "clickup_create_task",
    description: "Create a task in a list with optional assignees, dates, and tags",
    annotations: { readOnlyHint: false, idempotentHint: false, destructiveHint: true },
    inputSchema: CreateTaskInput,
    inputJsonSchema: createTaskInputJsonSchema,
    execute: async (input, context) => createTaskUsecase.execute(context, input as z.infer<typeof CreateTaskInput>)
  };
  register(createTaskTool);
  const moveTaskTool: RegisteredTool<MoveTaskOutputType> = {
    name: "clickup_move_task",
    description: "Move a task to another list",
    annotations: { readOnlyHint: false, idempotentHint: false, destructiveHint: true },
    inputSchema: MoveTaskInput,
    inputJsonSchema: moveTaskInputJsonSchema,
    execute: async (input, context) => moveTaskUsecase.execute(context, input as z.infer<typeof MoveTaskInput>)
  };
  register(moveTaskTool);
  const duplicateTaskTool: RegisteredTool<DuplicateTaskOutputType> = {
    name: "clickup_duplicate_task",
    description: "Duplicate a task with control over included elements",
    annotations: { readOnlyHint: false, idempotentHint: false, destructiveHint: true },
    inputSchema: DuplicateTaskInput,
    inputJsonSchema: duplicateTaskInputJsonSchema,
    execute: async (input, context) => duplicateTaskUsecase.execute(context, input as z.infer<typeof DuplicateTaskInput>)
  };
  register(duplicateTaskTool);
  const deleteTaskTool: RegisteredTool<CreateTaskOutputType> = {
    name: "clickup_delete_task",
    description: "Delete a task permanently",
    annotations: { readOnlyHint: false, idempotentHint: false, destructiveHint: true },
    inputSchema: DeleteTaskInput,
    inputJsonSchema: deleteTaskInputJsonSchema,
    execute: withSafetyConfirmation<CreateTaskOutputType>(async (input, context) =>
      deleteTaskUsecase.execute(context, input as z.infer<typeof DeleteTaskInput>)
    )
  };
  register(deleteTaskTool);
  const searchTasksTool: RegisteredTool<SearchTasksOutputType> = {
    name: "clickup_search_tasks",
    description: "Search tasks using ClickUp filters and paging",
    annotations: { readOnlyHint: true, idempotentHint: true, destructiveHint: false },
    inputSchema: SearchTasksInput,
    inputJsonSchema: searchTasksInputJsonSchema,
    execute: async (input, context) => searchTasksUsecase.execute(context, input as z.infer<typeof SearchTasksInput>)
  };
  register(searchTasksTool);
  const commentTaskTool: RegisteredTool<CommentTaskOutputType> = {
    name: "clickup_comment_task",
    description: "Add a markdown comment to a task",
    annotations: { readOnlyHint: false, idempotentHint: false, destructiveHint: true },
    inputSchema: CommentTaskInput,
    inputJsonSchema: commentTaskInputJsonSchema,
    execute: async (input, context) => commentTaskUsecase.execute(context, input as z.infer<typeof CommentTaskInput>)
  };
  register(commentTaskTool);
  const attachFileTool: RegisteredTool<AttachFileToTaskOutputType> = {
    name: "clickup_attach_file_to_task",
    description: "Attach a small file to a task via data URI",
    annotations: { readOnlyHint: false, idempotentHint: false, destructiveHint: true },
    inputSchema: AttachFileToTaskInput,
    inputJsonSchema: attachFileToTaskInputJsonSchema,
    execute: withSafetyConfirmation<AttachFileToTaskOutputType>(async (input, context) =>
      attachFileUsecase.execute(context, input as z.infer<typeof AttachFileToTaskInput>)
    )
  };
  register(attachFileTool);
  const addTagsTool: RegisteredTool<TagsOutputType> = {
    name: "clickup_add_tags_to_task",
    description: "Add one or more tags without replacing others",
    annotations: { readOnlyHint: false, idempotentHint: false, destructiveHint: true },
    inputSchema: AddTagsToTaskInput,
    inputJsonSchema: addTagsToTaskInputJsonSchema,
    execute: async (input, context) => addTagsUsecase.execute(context, input as z.infer<typeof AddTagsToTaskInput>)
  };
  register(addTagsTool);
  const removeTagsTool: RegisteredTool<TagsOutputType> = {
    name: "clickup_remove_tags_from_task",
    description: "Remove one or more tags from a task",
    annotations: { readOnlyHint: false, idempotentHint: false, destructiveHint: true },
    inputSchema: RemoveTagsFromTaskInput,
    inputJsonSchema: removeTagsFromTaskInputJsonSchema,
    execute: async (input, context) => removeTagsUsecase.execute(context, input as z.infer<typeof RemoveTagsFromTaskInput>)
  };
  register(removeTagsTool);
  const startTimerTool: RegisteredTool<TimerOutputType> = {
    name: "clickup_start_timer",
    description: "Start a running timer on a task",
    annotations: { readOnlyHint: false, idempotentHint: false, destructiveHint: true },
    inputSchema: StartTimerInput,
    inputJsonSchema: startTimerInputJsonSchema,
    execute: withSafetyConfirmation<TimerOutputType>(async (input, context) =>
      startTimerUsecase.execute(context, input as z.infer<typeof StartTimerInput>)
    )
  };
  register(startTimerTool);
  const stopTimerTool: RegisteredTool<TimerOutputType> = {
    name: "clickup_stop_timer",
    description: "Stop a running timer on a task",
    annotations: { readOnlyHint: false, idempotentHint: false, destructiveHint: true },
    inputSchema: StopTimerInput,
    inputJsonSchema: stopTimerInputJsonSchema,
    execute: withSafetyConfirmation<TimerOutputType>(async (input, context) =>
      stopTimerUsecase.execute(context, input as z.infer<typeof StopTimerInput>)
    )
  };
  register(stopTimerTool);
  const createEntryTool: RegisteredTool<TimerOutputType> = {
    name: "clickup_create_time_entry",
    description: "Create a manual time entry",
    annotations: { readOnlyHint: false, idempotentHint: false, destructiveHint: true },
    inputSchema: CreateEntryInput,
    inputJsonSchema: createTimeEntryInputJsonSchema,
    execute: async (input, context) => createEntryUsecase.execute(context, input as z.infer<typeof CreateEntryInput>)
  };
  register(createEntryTool);
  const updateEntryTool: RegisteredTool<TimerOutputType> = {
    name: "clickup_update_time_entry",
    description: "Update a manual time entry",
    annotations: { readOnlyHint: false, idempotentHint: false, destructiveHint: true },
    inputSchema: UpdateEntryInput,
    inputJsonSchema: updateTimeEntryInputJsonSchema,
    execute: async (input, context) => updateEntryUsecase.execute(context, input as z.infer<typeof UpdateEntryInput>)
  };
  register(updateEntryTool);
  const deleteEntryTool: RegisteredTool<TimerOutputType> = {
    name: "clickup_delete_time_entry",
    description: "Delete a manual time entry",
    annotations: { readOnlyHint: false, idempotentHint: false, destructiveHint: true },
    inputSchema: DeleteEntryInput,
    inputJsonSchema: deleteTimeEntryInputJsonSchema,
    execute: withSafetyConfirmation<TimerOutputType>(async (input, context) =>
      deleteEntryUsecase.execute(context, input as z.infer<typeof DeleteEntryInput>)
    )
  };
  register(deleteEntryTool);
  const listEntriesTool: RegisteredTool<ListEntriesOutputType> = {
    name: "clickup_list_time_entries",
    description: "List time entries with filters and aggregates",
    annotations: { readOnlyHint: true, idempotentHint: true, destructiveHint: false },
    inputSchema: ListEntriesInput,
    inputJsonSchema: listTimeEntriesInputJsonSchema,
    execute: async (input, context) => listEntriesUsecase.execute(context, input as z.infer<typeof ListEntriesInput>)
  };
  register(listEntriesTool);
  const reportTagTool: RegisteredTool<ReportOutputType> = {
    name: "clickup_report_time_for_tag",
    description: "Total time spent on tasks carrying a specific tag within a date window",
    annotations: { readOnlyHint: true, idempotentHint: true, destructiveHint: false },
    inputSchema: ReportForTagInput,
    inputJsonSchema: reportForTagInputJsonSchema,
    execute: async (input, context) => reportTagUsecase.execute(context, input as z.infer<typeof ReportForTagInput>)
  };
  register(reportTagTool);
  const reportContainerTool: RegisteredTool<ReportOutputType> = {
    name: "clickup_report_time_for_container",
    description: "Total time spent on tasks inside a specific list or view within a date window",
    annotations: { readOnlyHint: true, idempotentHint: true, destructiveHint: false },
    inputSchema: ReportForContainerInput,
    inputJsonSchema: reportForContainerInputJsonSchema,
    execute: async (input, context) => reportContainerUsecase.execute(context, input as z.infer<typeof ReportForContainerInput>)
  };
  register(reportContainerTool);
  const reportSpaceTagTool: RegisteredTool<ReportOutputType> = {
    name: "clickup_report_time_for_space_tag",
    description: "Sum time tracked on tasks in a space with a specific tag",
    annotations: { readOnlyHint: true, idempotentHint: true, destructiveHint: false },
    inputSchema: ReportForSpaceTagInput,
    inputJsonSchema: reportForSpaceTagInputJsonSchema,
    execute: async (input, context) =>
      reportSpaceTagUsecase.execute(context, input as z.infer<typeof ReportForSpaceTagInput>)
  };
  register(reportSpaceTagTool);
  const taskTool: RegisteredTool<TaskFuzzySearchOutputType> = {
    name: "clickup_task_fuzzy_search",
    description: "Fuzzy search tasks by text across titles, descriptions, comments and fields",
    annotations: { readOnlyHint: true, idempotentHint: true, destructiveHint: false },
    inputSchema: TaskFuzzySearchInput,
    inputJsonSchema: taskFuzzySearchInputJsonSchema,
    execute: async (input, context) => taskSearch.execute(context, input as TaskFuzzySearchInputType)
  };
  register(taskTool);
  const bulkTaskTool: RegisteredTool<BulkTaskFuzzySearchOutputType> = {
    name: "clickup_bulk_task_fuzzy_search",
    description: "Run multiple fuzzy task searches concurrently and merge unique tasks",
    annotations: { readOnlyHint: true, idempotentHint: true, destructiveHint: false },
    inputSchema: BulkTaskFuzzySearchInput,
    inputJsonSchema: bulkTaskFuzzySearchInputJsonSchema,
    execute: async (input, context) => bulkTaskSearch.execute(context, input as z.infer<typeof BulkTaskFuzzySearchInput>)
  };
  register(bulkTaskTool);
  const workspaces = new Workspaces(gateway);
  const spacesUseCase = new Spaces(gateway);
  const foldersUseCase = new Folders(gateway);
  const listsUseCase = new Lists(gateway);
  const tagsUseCase = new Tags(gateway);
  const membersUseCase = new Members(gateway);
  const resolveMembersUseCase = new ResolveMembers(gateway);
  const resolvePathUseCase = new ResolvePath(gateway);
  const overviewUseCase = new WorkspaceOverview(gateway);
  register({
    name: "clickup_list_workspaces",
    description: "List workspaces",
    annotations: { readOnlyHint: true, idempotentHint: true, destructiveHint: false },
    inputSchema: ListWorkspacesInput,
    inputJsonSchema: listWorkspacesInputJsonSchema,
    execute: async (input, context) => workspaces.execute(context, input as z.infer<typeof ListWorkspacesInput>)
  });
  register({
    name: "clickup_list_spaces",
    description: "List spaces for a team",
    annotations: { readOnlyHint: true, idempotentHint: true, destructiveHint: false },
    inputSchema: ListSpacesInput,
    inputJsonSchema: listSpacesInputJsonSchema,
    execute: async (input, context) => spacesUseCase.execute(context, input as z.infer<typeof ListSpacesInput>)
  });
  register({
    name: "clickup_list_folders",
    description: "List folders in a space",
    annotations: { readOnlyHint: true, idempotentHint: true, destructiveHint: false },
    inputSchema: ListFoldersInput,
    inputJsonSchema: listFoldersInputJsonSchema,
    execute: async (input, context) => foldersUseCase.execute(context, input as z.infer<typeof ListFoldersInput>)
  });
  register({
    name: "clickup_list_lists",
    description: "List lists under a space or folder",
    annotations: { readOnlyHint: true, idempotentHint: true, destructiveHint: false },
    inputSchema: ListListsInput,
    inputJsonSchema: listListsInputJsonSchema,
    execute: async (input, context) => listsUseCase.execute(context, input as z.infer<typeof ListListsInput>)
  });
  register({
    name: "clickup_list_tags_for_space",
    description: "Tags configured at space level",
    annotations: { readOnlyHint: true, idempotentHint: true, destructiveHint: false },
    inputSchema: ListTagsForSpaceInput,
    inputJsonSchema: listTagsInputJsonSchema,
    execute: async (input, context) => tagsUseCase.execute(context, input as z.infer<typeof ListTagsForSpaceInput>)
  });
  register({
    name: "clickup_list_members",
    description: "Members in a team",
    annotations: { readOnlyHint: true, idempotentHint: true, destructiveHint: false },
    inputSchema: ListMembersInput,
    inputJsonSchema: listMembersInputJsonSchema,
    execute: async (input, context) => membersUseCase.execute(context, input as z.infer<typeof ListMembersInput>)
  });
  register({
    name: "clickup_resolve_members",
    description: "Resolve names/emails to member IDs",
    annotations: { readOnlyHint: true, idempotentHint: true, destructiveHint: false },
    inputSchema: ResolveMembersInput,
    inputJsonSchema: resolveMembersInputJsonSchema,
    execute: async (input, context) => resolveMembersUseCase.execute(context, input as z.infer<typeof ResolveMembersInput>)
  });
  register({
    name: "clickup_resolve_path_to_ids",
    description: "Resolve Workspace/Space/Folder/List to IDs",
    annotations: { readOnlyHint: true, idempotentHint: true, destructiveHint: false },
    inputSchema: ResolvePathInput,
    inputJsonSchema: resolvePathInputJsonSchema,
    execute: async (input, context) => resolvePathUseCase.execute(context, input as z.infer<typeof ResolvePathInput>)
  });
  register({
    name: "clickup_get_workspace_overview",
    description: "Compact hierarchy tree for planning",
    annotations: { readOnlyHint: true, idempotentHint: true, destructiveHint: false },
    inputSchema: WorkspaceOverviewInput,
    inputJsonSchema: workspaceOverviewInputJsonSchema,
    execute: async (input, context) => overviewUseCase.execute(context, input as z.infer<typeof WorkspaceOverviewInput>)
  });
  const catalogueTool: RegisteredTool<CatalogueOutputType> = {
    name: "tool_catalogue",
    description: "List all available tools with annotations and examples",
    annotations: { readOnlyHint: true, idempotentHint: true, destructiveHint: false },
    inputSchema: CatalogueRequest,
    inputJsonSchema: catalogueInputJsonSchema,
    execute: async input => {
      const parsed = CatalogueRequest.safeParse(input ?? {});
      if (!parsed.success) {
        return err("INVALID_PARAMETER", "Invalid parameters", parsed.error.flatten());
      }
      const toolDefs: ToolDef[] = tools.map(tool => ({
        name: tool.name,
        description: tool.description,
        annotations: tool.annotations
      }));
      const { payload } = buildCatalogue(PROJECT_NAME, PACKAGE_VERSION, CHARACTER_LIMIT, toolDefs);
      const output = CatalogueOutput.parse(payload);
      return ok(output, output.truncated === true, output.guidance);
    }
  };
  register(catalogueTool);
  void runtime;
  return tools;
}
