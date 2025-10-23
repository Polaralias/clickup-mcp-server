import { ApiCache } from "../cache/ApiCache.js";
import { HttpClient } from "../http/HttpClient.js";
import { createLogger } from "../../shared/Logger.js";

export type AuthScheme = "auto" | "oauth" | "personal_token";

export type ClickUpGatewayConfig = {
  baseUrl: string;
  token: string;
  authScheme: AuthScheme;
  timeoutMs: number;
  defaultTeamId: number;
};

const logger = createLogger("info");

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

  async update_task(taskId: string, body: Record<string, unknown>): Promise<unknown> {
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
    value_options?: Record<string, unknown>
  ): Promise<unknown> {
    const payload: Record<string, unknown> = { value };
    if (typeof value_options !== "undefined") {
      payload.value_options = value_options;
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
    const response = await this.client.requestChecked({
      method: "POST",
      url: this.buildUrl(`/api/v2/task/${taskId}/comment`),
      headers: this.authHeader(),
      json: { comment_text: markdown },
      timeoutMs: this.cfg.timeoutMs
    });
    return response.data;
  }

  async get_doc_page(workspaceId: number, docId: string, pageId: string, format: string): Promise<unknown> {
    const response = await this.client.requestChecked({
      method: "GET",
      url: this.buildUrl(`/api/v3/workspaces/${workspaceId}/docs/${docId}/pages/${pageId}`),
      headers: this.authHeader(),
      params: { content_format: format },
      timeoutMs: this.cfg.timeoutMs
    });
    return response.data;
  }
}
