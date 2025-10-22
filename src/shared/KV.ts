export interface KV {
  get<T = unknown>(k: string): Promise<T | null>;
  set<T = unknown>(k: string, v: T, ttlSec?: number): Promise<void>;
  del(k: string): Promise<void>;
}

type Entry = { value: unknown; expiresAt?: number };

export class MemoryKV implements KV {
  private store = new Map<string, Entry>();

  async get<T = unknown>(k: string): Promise<T | null> {
    const entry = this.store.get(k);
    if (!entry) {
      return null;
    }
    if (typeof entry.expiresAt === "number" && entry.expiresAt <= Date.now()) {
      this.store.delete(k);
      return null;
    }
    return entry.value as T;
  }

  async set<T = unknown>(k: string, v: T, ttlSec?: number): Promise<void> {
    const expiresAt = typeof ttlSec === "number" ? Date.now() + ttlSec * 1000 : undefined;
    this.store.set(k, { value: v, expiresAt });
  }

  async del(k: string): Promise<void> {
    this.store.delete(k);
  }
}

export function makeMemoryKV(): KV {
  return new MemoryKV();
}
