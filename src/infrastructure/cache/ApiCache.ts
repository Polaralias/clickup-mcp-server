import type { KV } from "../../shared/KV.js";

export class ApiCache {
  constructor(private readonly kv: KV) {}

  async get<T>(key: string): Promise<T | null> {
    return this.kv.get<T>(key);
  }

  async put<T>(key: string, value: T, ttlSec: number): Promise<void> {
    await this.kv.set<T>(key, value, ttlSec);
  }

  makeKey(parts: Record<string, string | number | boolean>): string {
    return Object.keys(parts)
      .sort((a, b) => (a < b ? -1 : a > b ? 1 : 0))
      .map(key => `${key}=${String(parts[key])}`)
      .join("|");
  }
}
