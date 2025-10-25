import { ApiCache } from "../cache/ApiCache.js";
import { HttpClient } from "../http/HttpClient.js";
import { createLogger } from "../../shared/logging.js";

export type AuthScheme = "auto" | "oauth" | "personal_token";

export type ClickUpGatewayConfig = {
  baseUrl: string;
  token: string;
  authScheme: AuthScheme;
  timeoutMs: number;
  defaultTeamId: number;
};

const logger = createLogger("infra.clickup.gateway");

function normaliseBaseUrl(baseUrl: string): string {
  if (baseUrl.endsWith("/")) {
    return baseUrl.slice(0, -1);
  }
  return baseUrl;
}

export class ClickUpGateway {
  private readonly baseUrl: string;

  constructor(
    private readonly client: HttpClient,
    private readonly cache: ApiCache,
    private readonly cfg: ClickUpGatewayConfig
  ) {
    this.baseUrl = normaliseBaseUrl(cfg.baseUrl);
    logger.info("clickup_gateway_init", { baseUrl: this.baseUrl, authScheme: cfg.authScheme });
  }

  private authHeader(): Record<string, string> {
    if (this.cfg.authScheme === "oauth") {
      return { Authorization: `Bearer ${this.cfg.token}` };
    }
    if (this.cfg.authScheme === "personal_token") {
      return { Authorization: this.cfg.token };
    }
    const token = this.cfg.token;
    if (token.includes(".") || token.length > 40) {
      return { Authorization: `Bearer ${token}` };
    }
    return { Authorization: token };
  }

  private buildUrl(path: string): string {
    return `${this.baseUrl}${path}`;
  }

  async search_docs(workspaceId: number, query: string, limit: number, page: number): Promise<unknown> {
    const cacheKey = this.cache.makeKey({ s: "docs", ws: workspaceId, q: query, limit, page });
    const cached = await this.cache.get<unknown>(cacheKey);
    if (cached !== null) {
      return cached;
    }
    const response = await this.client.requestChecked({
      method: "GET",
      url: this.buildUrl(`/api/v3/workspaces/${workspaceId}/docs/search`),
      headers: this.authHeader(),
      params: { query, limit, page },
      timeoutMs: this.cfg.timeoutMs
    });
    await this.cache.put(cacheKey, response.data, 30);
    return response.data;
  }

  async create_doc(workspaceId: number, body: { title: string; visibility: string }): Promise<unknown> {
    const response = await this.client.requestChecked({
      method: "POST",
      url: this.buildUrl(`/api/v3/workspaces/${workspaceId}/docs`),
      headers: this.authHeader(),
      json: body,
      timeoutMs: this.cfg.timeoutMs
    });
    return response.data;
  }

  async list_doc_pages(
    workspaceId: number,
    docId: string,
    params: { limit: number; page: number }
  ): Promise<unknown> {
    const query = { limit: params.limit, page: params.page };
    let cacheKey: string | null = null;
    if (params.page === 0) {
      cacheKey = this.cache.makeKey({ s: "doc_pages", ws: workspaceId, docId, limit: params.limit, page: params.page });
      const cached = await this.cache.get<unknown>(cacheKey);
      if (cached !== null) {
        return cached;
      }
    }
    const response = await this.client.requestChecked({
      method: "GET",
      url: this.buildUrl(`/api/v3/workspaces/${workspaceId}/docs/${docId}/pages`),
      headers: this.authHeader(),
      params: query,
      timeoutMs: this.cfg.timeoutMs
    });
    if (cacheKey) {
      await this.cache.put(cacheKey, response.data, 30);
    }
    return response.data;
  }

  async get_doc_page(
    workspaceId: number,
    docId: string,
    pageId: string,
    contentFormat: string
  ): Promise<unknown> {
    const cacheKey = this.cache.makeKey({ s: "doc_page", ws: workspaceId, docId, pageId, format: contentFormat });
    const cached = await this.cache.get<unknown>(cacheKey);
    if (cached !== null) {
      return cached;
    }
    const response = await this.client.requestChecked({
      method: "GET",
      url: this.buildUrl(`/api/v3/workspaces/${workspaceId}/docs/${docId}/pages/${pageId}`),
      headers: this.authHeader(),
      params: { content_format: contentFormat },
      timeoutMs: this.cfg.timeoutMs
    });
    await this.cache.put(cacheKey, response.data, 30);
    return response.data;
  }

  async update_doc_page(
    workspaceId: number,
    docId: string,
    pageId: string,
    body: { content_format: string; content: string; title?: string }
  ): Promise<unknown> {
    const response = await this.client.requestChecked({
      method: "PUT",
      url: this.buildUrl(`/api/v3/workspaces/${workspaceId}/docs/${docId}/pages/${pageId}`),
      headers: this.authHeader(),
      json: body,
      timeoutMs: this.cfg.timeoutMs
    });
    return response.data;
  }

  async fetch_tasks_for_index(scope?: {
    teamId?: number;
    listIds?: string[];
    spaceIds?: string[];
    assigneeIds?: number[];
    statuses?: string[];
    includeClosed?: boolean;
    updatedSince?: string;
  }): Promise<any[]> {
    const teamId = scope?.teamId ?? this.cfg.defaultTeamId;
    const params: Record<string, unknown> = {
      include_closed: scope?.includeClosed ? "true" : "false"
    };
    if (scope?.listIds && scope.listIds.length > 0) {
      params["list_ids[]"] = scope.listIds;
    }
    if (scope?.spaceIds && scope.spaceIds.length > 0) {
      params["space_ids[]"] = scope.spaceIds;
    }
    if (scope?.assigneeIds && scope.assigneeIds.length > 0) {
      params["assignees[]"] = scope.assigneeIds;
    }
    if (scope?.statuses && scope.statuses.length > 0) {
      params["statuses[]"] = scope.statuses;
    }
    if (scope?.updatedSince) {
      const parsed = Date.parse(scope.updatedSince);
      if (!Number.isNaN(parsed)) {
        params.date_updated_gt = parsed;
      }
    }
    const tasks: any[] = [];
    const cacheKey = this.cache.makeKey({ s: "tasks", teamId, h: JSON.stringify(scope ?? {}) });
    let cachedFirstPage = false;
    for (let page = 0; page < 30; page += 1) {
      const response = await this.client.requestChecked({
        method: "GET",
        url: this.buildUrl(`/api/v2/team/${teamId}/task`),
        headers: this.authHeader(),
        params: { ...params, page },
        timeoutMs: this.cfg.timeoutMs
      });
      if (!cachedFirstPage) {
        await this.cache.put(cacheKey, response.data, 60);
        cachedFirstPage = true;
      }
      const payload = response.data as { tasks?: unknown; data?: unknown } | null | undefined;
      let pageTasks: any[] = [];
      if (payload && Array.isArray(payload.tasks)) {
        pageTasks = payload.tasks as any[];
      } else if (payload && Array.isArray(payload.data)) {
        pageTasks = payload.data as any[];
      }
      tasks.push(...pageTasks);
      if (pageTasks.length === 0 || pageTasks.length < 100) {
        break;
      }
    }
    return tasks;
  }

  async get_task_by_id(taskId: string): Promise<unknown> {
    const response = await this.client.requestChecked({
      method: "GET",
      url: this.buildUrl(`/api/v2/task/${taskId}`),
      headers: this.authHeader(),
      timeoutMs: this.cfg.timeoutMs
    });
    return response.data;
  }

  async list_workspaces(page: number, limit: number): Promise<unknown> {
    const response = await this.client.requestChecked({
      method: "GET",
      url: this.buildUrl("/api/v2/team"),
      headers: this.authHeader(),
      params: { page, limit },
      timeoutMs: this.cfg.timeoutMs
    });
    return response.data;
  }

  async list_spaces(teamId: number, page: number, limit: number, includeArchived: boolean): Promise<unknown> {
    const cacheKey = this.cache.makeKey({ s: "spaces", teamId, page, limit, archived: includeArchived ? 1 : 0 });
    const cached = await this.cache.get<unknown>(cacheKey);
    if (cached !== null) {
      return cached;
    }
    const response = await this.client.requestChecked({
      method: "GET",
      url: this.buildUrl(`/api/v2/team/${teamId}/space`),
      headers: this.authHeader(),
      params: { page, limit, archived: includeArchived ? "true" : "false" },
      timeoutMs: this.cfg.timeoutMs
    });
    await this.cache.put(cacheKey, response.data, 60);
    return response.data;
  }

  async list_folders(spaceId: string, page: number, limit: number, includeArchived: boolean): Promise<unknown> {
    const response = await this.client.requestChecked({
      method: "GET",
      url: this.buildUrl(`/api/v2/space/${spaceId}/folder`),
      headers: this.authHeader(),
      params: { page, limit, archived: includeArchived ? "true" : "false" },
      timeoutMs: this.cfg.timeoutMs
    });
    return response.data;
  }

  async list_lists_under(
    parentType: "space" | "folder",
    parentId: string,
    page: number,
    limit: number,
    includeArchived: boolean
  ): Promise<unknown> {
    const path = parentType === "space" ? `/api/v2/space/${parentId}/list` : `/api/v2/folder/${parentId}/list`;
    const response = await this.client.requestChecked({
      method: "GET",
      url: this.buildUrl(path),
      headers: this.authHeader(),
      params: { page, limit, archived: includeArchived ? "true" : "false" },
      timeoutMs: this.cfg.timeoutMs
    });
    return response.data;
  }

  async list_tags_for_space(spaceId: string): Promise<unknown> {
    const response = await this.client.requestChecked({
      method: "GET",
      url: this.buildUrl(`/api/v2/space/${spaceId}/tag`),
      headers: this.authHeader(),
      timeoutMs: this.cfg.timeoutMs
    });
    return response.data;
  }

  async list_members(teamId: number, page: number, limit: number): Promise<unknown> {
    const cacheKey = this.cache.makeKey({ s: "members", teamId, page, limit });
    const cached = await this.cache.get<unknown>(cacheKey);
    if (cached !== null) {
      return cached;
    }
    const response = await this.client.requestChecked({
      method: "GET",
      url: this.buildUrl(`/api/v2/team/${teamId}/member`),
      headers: this.authHeader(),
      params: { page, limit },
      timeoutMs: this.cfg.timeoutMs
    });
    await this.cache.put(cacheKey, response.data, 60);
    return response.data;
  }

  async create_task(listId: string, body: Record<string, unknown>): Promise<unknown> {
    const response = await this.client.requestChecked({
      method: "POST",
      url: this.buildUrl(`/api/v2/list/${listId}/task`),
      headers: this.authHeader(),
      json: body,
      timeoutMs: this.cfg.timeoutMs
    });
    return response.data;
  }

  async update_task(
    taskId: string,
    body: {
      name?: string;
      status?: string;
      assignees?: number[];
      priority?: string | number;
      due_date?: string;
      time_estimate?: string;
      tags?: string[];
      description?: string;
    }
  ): Promise<unknown> {
    const response = await this.client.requestChecked({
      method: "PUT",
      url: this.buildUrl(`/api/v2/task/${taskId}`),
      headers: this.authHeader(),
      json: body,
      timeoutMs: this.cfg.timeoutMs
    });
    return response.data;
  }

  async set_task_custom_field(
    taskId: string,
    fieldId: string,
    value: unknown,
    valueOptions?: Record<string, unknown>
  ): Promise<unknown> {
    const payload: Record<string, unknown> = { value };
    if (valueOptions && Object.keys(valueOptions).length > 0) {
      payload.value_options = valueOptions;
    }
    const response = await this.client.requestChecked({
      method: "POST",
      url: this.buildUrl(`/api/v2/task/${taskId}/field/${fieldId}`),
      headers: this.authHeader(),
      json: payload,
      timeoutMs: this.cfg.timeoutMs
    });
    return response.data;
  }

  async add_task_comment(taskId: string, markdown: string): Promise<unknown> {
    return this.comment_task(taskId, markdown);
  }

  async move_task(taskId: string, targetListId: string): Promise<unknown> {
    const response = await this.client.requestChecked({
      method: "POST",
      url: this.buildUrl(`/api/v2/task/${taskId}/move`),
      headers: this.authHeader(),
      json: { list_id: targetListId },
      timeoutMs: this.cfg.timeoutMs
    });
    return response.data;
  }

  async duplicate_task(taskId: string, include: Record<string, boolean>): Promise<unknown> {
    const response = await this.client.requestChecked({
      method: "POST",
      url: this.buildUrl(`/api/v2/task/${taskId}/duplicate`),
      headers: this.authHeader(),
      json: include,
      timeoutMs: this.cfg.timeoutMs
    });
    return response.data;
  }

  async delete_task(taskId: string): Promise<unknown> {
    const response = await this.client.requestChecked({
      method: "DELETE",
      url: this.buildUrl(`/api/v2/task/${taskId}`),
      headers: this.authHeader(),
      timeoutMs: this.cfg.timeoutMs
    });
    return response.data;
  }

  async search_tasks(params: Record<string, unknown>): Promise<unknown> {
    const query = { ...params };
    const teamIdValue = query.teamId;
    delete query.teamId;
    let teamId = this.cfg.defaultTeamId;
    if (typeof teamIdValue === "number" && Number.isFinite(teamIdValue)) {
      teamId = Math.trunc(teamIdValue);
    } else if (typeof teamIdValue === "string") {
      const parsed = Number.parseInt(teamIdValue, 10);
      if (!Number.isNaN(parsed)) {
        teamId = parsed;
      }
    }
    const response = await this.client.requestChecked({
      method: "GET",
      url: this.buildUrl(`/api/v2/team/${teamId}/task`),
      headers: this.authHeader(),
      params: query,
      timeoutMs: this.cfg.timeoutMs
    });
    return response.data;
  }

  async search_tasks_by_space_and_tag(
    teamId: number,
    spaceId: string,
    tag: string,
    page: number,
    limit: number
  ): Promise<unknown> {
    const query = {
      page: Math.max(0, Math.trunc(page)),
      limit: Math.max(1, Math.trunc(limit)),
      include_closed: "true",
      "space_ids[]": [spaceId],
      "tags[]": [tag]
    };
    let cacheKey: string | null = null;
    if (query.page === 0) {
      cacheKey = this.cache.makeKey({ s: "space_tag", teamId, spaceId, tag, limit: query.limit });
      const cached = await this.cache.get<unknown>(cacheKey);
      if (cached !== null) {
        return cached;
      }
    }
    const response = await this.client.requestChecked({
      method: "GET",
      url: this.buildUrl(`/api/v2/team/${teamId}/task`),
      headers: this.authHeader(),
      params: query,
      timeoutMs: this.cfg.timeoutMs
    });
    if (cacheKey) {
      await this.cache.put(cacheKey, response.data, 60);
    }
    return response.data;
  }

  async start_timer(taskId: string, body: { description?: string }): Promise<unknown> {
    const response = await this.client.requestChecked({
      method: "POST",
      url: this.buildUrl(`/api/v2/task/${taskId}/time/start`),
      headers: this.authHeader(),
      json: body,
      timeoutMs: this.cfg.timeoutMs
    });
    return response.data;
  }

  async stop_timer(taskId: string): Promise<unknown> {
    const response = await this.client.requestChecked({
      method: "POST",
      url: this.buildUrl(`/api/v2/task/${taskId}/time/stop`),
      headers: this.authHeader(),
      timeoutMs: this.cfg.timeoutMs
    });
    return response.data;
  }

  async create_time_entry(taskId: string, body: { start: string; end: string; description?: string; billable?: boolean; assignee?: number }): Promise<unknown> {
    const response = await this.client.requestChecked({
      method: "POST",
      url: this.buildUrl(`/api/v2/task/${taskId}/time`),
      headers: this.authHeader(),
      json: body,
      timeoutMs: this.cfg.timeoutMs
    });
    return response.data;
  }

  async update_time_entry(entryId: string, body: { start?: string; end?: string; description?: string; billable?: boolean }): Promise<unknown> {
    const response = await this.client.requestChecked({
      method: "PUT",
      url: this.buildUrl(`/api/v2/time/${entryId}`),
      headers: this.authHeader(),
      json: body,
      timeoutMs: this.cfg.timeoutMs
    });
    return response.data;
  }

  async delete_time_entry(entryId: string): Promise<unknown> {
    const response = await this.client.requestChecked({
      method: "DELETE",
      url: this.buildUrl(`/api/v2/time/${entryId}`),
      headers: this.authHeader(),
      timeoutMs: this.cfg.timeoutMs
    });
    return response.data;
  }

  async list_time_entries(teamId: number, params: Record<string, unknown>): Promise<unknown> {
    const query: Record<string, unknown> = {};
    const memberIds = params.memberIds;
    if (Array.isArray(memberIds) && memberIds.length > 0) {
      query["assignee[]"] = memberIds;
    }
    const taskIds = params.taskIds;
    if (Array.isArray(taskIds) && taskIds.length > 0) {
      query["task[]"] = taskIds;
    }
    const sinceValue = params.since;
    let sinceMs: number | null = null;
    if (typeof sinceValue === "number" && Number.isFinite(sinceValue)) {
      sinceMs = Math.trunc(sinceValue);
    } else if (typeof sinceValue === "string") {
      const parsed = Date.parse(sinceValue);
      if (!Number.isNaN(parsed)) {
        sinceMs = Math.trunc(parsed);
      }
    }
    if (sinceMs !== null) {
      query.start_date = String(sinceMs);
    }
    const untilValue = params.until;
    let untilMs: number | null = null;
    if (typeof untilValue === "number" && Number.isFinite(untilValue)) {
      untilMs = Math.trunc(untilValue);
    } else if (typeof untilValue === "string") {
      const parsed = Date.parse(untilValue);
      if (!Number.isNaN(parsed)) {
        untilMs = Math.trunc(parsed);
      }
    }
    if (untilMs !== null) {
      query.end_date = String(untilMs);
    }
    const pageValue = params.page;
    if (typeof pageValue === "number" && Number.isFinite(pageValue)) {
      query.page = Math.max(0, Math.trunc(pageValue));
    }
    const limitValue = params.limit;
    if (typeof limitValue === "number" && Number.isFinite(limitValue)) {
      const limit = Math.max(1, Math.trunc(limitValue));
      query.limit = limit;
    }
    if (typeof params.includeRunning === "boolean") {
      query.include_running = params.includeRunning ? "true" : "false";
    }
    if (typeof params.includeBillable === "boolean") {
      query.include_billable = params.includeBillable ? "true" : "false";
    }
    const cacheKey = this.cache.makeKey({ s: "time_entries", teamId, h: JSON.stringify(query) });
    const cached = await this.cache.get<unknown>(cacheKey);
    if (cached !== null) {
      return cached;
    }
    const response = await this.client.requestChecked({
      method: "GET",
      url: this.buildUrl(`/api/v2/team/${teamId}/time_entries`),
      headers: this.authHeader(),
      params: query,
      timeoutMs: this.cfg.timeoutMs
    });
    await this.cache.put(cacheKey, response.data, 30);
    return response.data;
  }

  async list_view_tasks(
    parentType: "team" | "space" | "folder" | "list",
    parentId: string | number,
    viewId: string,
    params?: Record<string, unknown>
  ): Promise<unknown> {
    const response = await this.client.requestChecked({
      method: "GET",
      url: this.buildUrl(`/api/v2/${parentType}/${parentId}/view/${viewId}/task`),
      headers: this.authHeader(),
      params,
      timeoutMs: this.cfg.timeoutMs
    });
    return response.data;
  }

  async comment_task(taskId: string, markdown: string): Promise<unknown> {
    const response = await this.client.requestChecked({
      method: "POST",
      url: this.buildUrl(`/api/v2/task/${taskId}/comment`),
      headers: this.authHeader(),
      json: { markdown },
      timeoutMs: this.cfg.timeoutMs
    });
    return response.data;
  }

  async attach_file_to_task(taskId: string, dataUri: string, name: string): Promise<unknown> {
    const response = await this.client.requestChecked({
      method: "POST",
      url: this.buildUrl(`/api/v2/task/${taskId}/attachment`),
      headers: this.authHeader(),
      json: { attachment: dataUri, filename: name },
      timeoutMs: this.cfg.timeoutMs
    });
    return response.data;
  }

  async add_task_tags(taskId: string, tags: string[]): Promise<unknown> {
    const response = await this.client.requestChecked({
      method: "POST",
      url: this.buildUrl(`/api/v2/task/${taskId}/tag`),
      headers: this.authHeader(),
      json: { tags },
      timeoutMs: this.cfg.timeoutMs
    });
    return response.data;
  }

  async remove_task_tags(taskId: string, tags: string[]): Promise<unknown> {
    const response = await this.client.requestChecked({
      method: "POST",
      url: this.buildUrl(`/api/v2/task/${taskId}/tag/remove`),
      headers: this.authHeader(),
      json: { tags },
      timeoutMs: this.cfg.timeoutMs
    });
    return response.data;
  }
}
