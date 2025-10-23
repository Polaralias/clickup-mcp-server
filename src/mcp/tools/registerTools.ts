import type { Server as McpServer } from "@modelcontextprotocol/sdk/server/index.js";
import { createRequire } from "module";
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
  TaskFuzzySearchInput,
  TaskFuzzySearchOutput,
  BulkTaskFuzzySearchInput,
  BulkTaskFuzzySearchOutput
} from "./schemas/taskSearch.js";
import type { TaskScopeType } from "./schemas/taskSearch.js";
import { UpdateTaskInput, UpdateTaskOutput } from "./schemas/taskUpdate.js";
import { DocSearch } from "../../application/usecases/DocSearch.js";
import { BulkDocSearch } from "../../application/usecases/BulkDocSearch.js";
import { TaskSearchIndex, type TaskIndexRecord } from "../../application/services/TaskSearchIndex.js";
import { TaskFuzzySearch } from "../../application/usecases/TaskFuzzySearch.js";
import { BulkTaskFuzzySearch } from "../../application/usecases/BulkTaskFuzzySearch.js";
import { UpdateTask } from "../../application/usecases/UpdateTask.js";
import { ApiCache } from "../../infrastructure/cache/ApiCache.js";
import { makeMemoryKV } from "../../shared/KV.js";
import { HttpClient } from "../../infrastructure/http/HttpClient.js";
import { ClickUpGateway } from "../../infrastructure/clickup/ClickUpGateway.js";
import type { ClickUpGatewayConfig, AuthScheme } from "../../infrastructure/clickup/ClickUpGateway.js";
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

type PackageMetadata = { version: string };

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

const require = createRequire(import.meta.url);
const packageMetadata = require("../../../package.json") as PackageMetadata;

export type RegisteredTool<TOutput = unknown> = {
  name: string;
  description: string;
  annotations: ToolAnnotations;
  inputSchema: z.ZodTypeAny;
  inputJsonSchema: JsonSchema;
  execute: ToolExecutor<TOutput>;
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
    addCommentMarkdown: { type: "string", minLength: 1 }
  },
  required: ["taskId"],
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

function resolveAuthScheme(value: string | undefined): AuthScheme {
  if (value === "oauth" || value === "personal_token" || value === "auto") {
    return value;
  }
  return "auto";
}

function resolveGatewayConfig(): ClickUpGatewayConfig {
  const baseUrl = process.env.CLICKUP_BASE_URL ?? "https://api.clickup.com";
  const token = process.env.CLICKUP_TOKEN ?? "";
  const authScheme = resolveAuthScheme(process.env.CLICKUP_AUTH_SCHEME);
  const timeoutMs = parseNumber(process.env.CLICKUP_TIMEOUT_MS, 10000);
  const defaultTeamId = parseNumber(process.env.CLICKUP_DEFAULT_TEAM_ID, 0);
  return { baseUrl, token, authScheme, timeoutMs, defaultTeamId };
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

function resolveDependencies(deps?: ToolDependencies): { gateway: ClickUpGateway; cache: ApiCache } {
  if (deps?.gateway && deps?.cache) {
    return { gateway: deps.gateway, cache: deps.cache };
  }
  const cache = deps?.cache ?? new ApiCache(makeMemoryKV());
  if (deps?.gateway) {
    return { gateway: deps.gateway, cache };
  }
  const config = resolveGatewayConfig();
  const client = new HttpClient({ baseUrl: config.baseUrl });
  const gateway = new ClickUpGateway(client, cache, config);
  return { gateway, cache };
}

async function executeHealth(input: unknown, context: ToolContext): Promise<Result<HealthPayload>> {
  const parsed = healthInputSchema.safeParse(input ?? {});
  if (!parsed.success) {
    return err("INVALID_PARAMETER", "Invalid parameters", parsed.error.flatten());
  }
  return ok({
    service: PROJECT_NAME,
    version: packageMetadata.version,
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
  execute: executeHealth
};

export async function registerTools(server: McpServer, runtime: RuntimeConfig, deps?: ToolDependencies): Promise<RegisteredTool[]> {
  void server;
  const { gateway, cache } = resolveDependencies(deps);
  const docSearch = new DocSearch(gateway, cache);
  const bulkDocSearch = new BulkDocSearch(gateway, cache);
  const updateTaskUsecase = new UpdateTask(gateway);
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
    tools.push(tool as RegisteredTool);
    return tool;
  };
  register(healthTool);
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
  const updateTool: RegisteredTool<UpdateTaskOutputType> = {
    name: "clickup_update_task",
    description: "Update a task and optionally set custom fields, append to description, and add a comment",
    annotations: { readOnlyHint: false, idempotentHint: true, destructiveHint: false },
    inputSchema: UpdateTaskInput,
    inputJsonSchema: updateTaskInputJsonSchema,
    execute: async (input, context) => updateTaskUsecase.execute(context, input as z.infer<typeof UpdateTaskInput>)
  };
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
    execute: async (input, context) => bulkTaskSearch.execute(context, input as BulkTaskFuzzySearchInputType)
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
      const { payload } = buildCatalogue(PROJECT_NAME, packageMetadata.version, CHARACTER_LIMIT, toolDefs);
      const output = CatalogueOutput.parse(payload);
      return ok(output, output.truncated === true, output.guidance);
    }
  };
  register(catalogueTool);
  void runtime;
  return [healthTool, docTool, bulkTool, updateTool, taskTool, bulkTaskTool];
}
