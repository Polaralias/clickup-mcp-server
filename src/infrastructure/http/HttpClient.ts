import axios from "axios";

export type HttpMethod = "GET" | "POST" | "PUT" | "PATCH" | "DELETE";

export type HttpRequest = {
  method: HttpMethod;
  url: string;
  headers?: Record<string, string>;
  params?: Record<string, unknown>;
  json?: unknown;
  timeoutMs?: number;
};

export type HttpResponse = {
  status: number;
  headers: Record<string, string>;
  data: unknown;
};

export type HttpTransport = (config: HttpRequest) => Promise<HttpResponse>;

const defaultTransport: HttpTransport = async request => {
  const response = await axios.request({
    method: request.method,
    url: request.url,
    headers: request.headers,
    data: request.json,
    timeout: request.timeoutMs,
    validateStatus: () => true
  });
  const headers: Record<string, string> = {};
  for (const [key, value] of Object.entries(response.headers ?? {})) {
    if (typeof value === "undefined") {
      continue;
    }
    const lowerKey = key.toLowerCase();
    if (Array.isArray(value)) {
      headers[lowerKey] = value.join(", ");
    } else {
      headers[lowerKey] = String(value);
    }
  }
  return { status: response.status, headers, data: response.data };
};

function normaliseBaseUrl(baseUrl: string): string {
  if (baseUrl.endsWith("/")) {
    return baseUrl.slice(0, -1);
  }
  return baseUrl;
}

function buildQuery(params?: Record<string, unknown>): string {
  if (!params) {
    return "";
  }
  const entries = Object.keys(params).sort((a, b) => (a < b ? -1 : a > b ? 1 : 0));
  const parts: string[] = [];
  for (const key of entries) {
    const value = params[key];
    if (typeof value === "undefined" || value === null) {
      continue;
    }
    if (Array.isArray(value)) {
      if (key.endsWith("[]")) {
        for (const element of value) {
          parts.push(`${key}=${encodeURIComponent(String(element))}`);
        }
      } else {
        const joined = value.map(item => encodeURIComponent(String(item))).join(",");
        parts.push(`${key}=${joined}`);
      }
    } else {
      parts.push(`${key}=${encodeURIComponent(String(value))}`);
    }
  }
  if (parts.length === 0) {
    return "";
  }
  return `?${parts.join("&")}`;
}

function findHeader(headers: Record<string, string>, name: string): string | undefined {
  const lower = name.toLowerCase();
  for (const [key, value] of Object.entries(headers)) {
    if (key.toLowerCase() === lower) {
      return value;
    }
  }
  return undefined;
}

export class HttpClient {
  private readonly baseUrl: string;
  private readonly defaultHeaders: Record<string, string>;
  private readonly maxRetries: number;
  private readonly transport: HttpTransport;

  constructor(opts?: {
    baseUrl?: string;
    defaultHeaders?: Record<string, string>;
    maxRetries?: number;
    transport?: HttpTransport;
  }) {
    this.baseUrl = normaliseBaseUrl(opts?.baseUrl ?? "https://api.clickup.com");
    this.defaultHeaders = { "Content-Type": "application/json", ...(opts?.defaultHeaders ?? {}) };
    this.maxRetries = typeof opts?.maxRetries === "number" ? opts.maxRetries : 2;
    this.transport = opts?.transport ?? defaultTransport;
  }

  private async wait(ms: number): Promise<void> {
    await new Promise(resolve => {
      setTimeout(resolve, ms);
    });
  }

  private buildUrl(url: string, params?: Record<string, unknown>): string {
    const prefix = url.startsWith("/") ? `${this.baseUrl}${url}` : url;
    return `${prefix}${buildQuery(params)}`;
  }

  private computeDelay(response: HttpResponse, retryIndex: number): number | null {
    if (response.status === 429) {
      const headerValue = findHeader(response.headers, "x-ratelimit-reset");
      const parsed = headerValue ? Number.parseInt(headerValue, 10) : Number.NaN;
      if (Number.isNaN(parsed)) {
        return 1000;
      }
      return (parsed + 1) * 1000;
    }
    if (response.status === 502 || response.status === 503 || response.status === 504) {
      return 250 * 2 ** retryIndex;
    }
    return null;
  }

  async request(req: HttpRequest): Promise<HttpResponse> {
    const mergedHeaders = { ...this.defaultHeaders, ...(req.headers ?? {}) };
    const finalRequest: HttpRequest = {
      method: req.method,
      url: this.buildUrl(req.url, req.params),
      headers: mergedHeaders,
      json: req.json,
      timeoutMs: req.timeoutMs
    };
    let retries = 0;
    while (true) {
      const response = await this.transport(finalRequest);
      if (retries >= this.maxRetries) {
        return response;
      }
      const delay = this.computeDelay(response, retries);
      if (delay === null) {
        return response;
      }
      await this.wait(delay);
      retries += 1;
    }
  }

  async requestChecked(req: HttpRequest): Promise<HttpResponse> {
    const response = await this.request(req);
    if (response.status >= 200 && response.status <= 299) {
      return response;
    }
    throw response;
  }
}
