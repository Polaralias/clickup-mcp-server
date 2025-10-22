import { describe, expect, it, vi } from "vitest";
import "./setup.js";
import { HttpClient } from "../src/infrastructure/http/HttpClient.js";
import type { HttpRequest, HttpResponse } from "../src/infrastructure/http/HttpClient.js";

describe("HttpClient", () => {
  it("retries on 429 using header delay", async () => {
    const responses: HttpResponse[] = [
      { status: 429, headers: { "x-ratelimit-reset": "2" }, data: {} },
      { status: 200, headers: {}, data: { ok: true } }
    ];
    const calls: HttpRequest[] = [];
    const client = new HttpClient({
      transport: async request => {
        calls.push(request);
        const response = responses.shift();
        if (!response) {
          throw new Error("No more responses");
        }
        return response;
      }
    });
    const promise = client.requestChecked({
      method: "GET",
      url: "/retry",
      params: { "assignees[]": [1, 2] }
    });
    await vi.advanceTimersByTimeAsync(3000);
    const response = await promise;
    expect(response.status).toBe(200);
    expect(response.data).toEqual({ ok: true });
    expect(calls.length).toBe(2);
    expect(calls[0].url).toBe("https://api.clickup.com/retry?assignees[]=1&assignees[]=2");
  });

  it("applies exponential backoff on 503", async () => {
    const responses: HttpResponse[] = [
      { status: 503, headers: {}, data: {} },
      { status: 503, headers: {}, data: {} },
      { status: 200, headers: {}, data: { ok: true } }
    ];
    const calls: HttpRequest[] = [];
    const client = new HttpClient({
      transport: async request => {
        calls.push(request);
        const response = responses.shift();
        if (!response) {
          throw new Error("No more responses");
        }
        return response;
      }
    });
    const promise = client.requestChecked({ method: "GET", url: "/backoff" });
    await vi.advanceTimersByTimeAsync(250);
    await vi.advanceTimersByTimeAsync(500);
    const response = await promise;
    expect(response.status).toBe(200);
    expect(calls.length).toBe(3);
  });

  it("does not retry on 400", async () => {
    const failure: HttpResponse = { status: 400, headers: {}, data: {} };
    const responses: HttpResponse[] = [failure];
    const calls: HttpRequest[] = [];
    const client = new HttpClient({
      transport: async request => {
        calls.push(request);
        const response = responses.shift();
        if (!response) {
          throw new Error("No more responses");
        }
        return response;
      }
    });
    await expect(
      client.requestChecked({
        method: "GET",
        url: "/fail",
        params: { ids: ["a", "b"] }
      })
    ).rejects.toEqual(failure);
    expect(calls.length).toBe(1);
    expect(calls[0].url).toBe("https://api.clickup.com/fail?ids=a,b");
  });
});
