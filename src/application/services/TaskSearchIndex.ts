import Fuse from "fuse.js";
import type { IFuseOptions } from "fuse.js";

export type TaskIndexRecord = {
  taskId: string;
  name?: string;
  description?: string;
  comments?: string;
  custom?: string;
  listId?: string;
  listName?: string;
  spaceId?: string;
  spaceName?: string;
  status?: string;
  priority?: string;
  assignees?: { id: number; username?: string }[];
  url: string;
  updatedAt?: string;
};

export class TaskSearchIndex {
  private fuse?: Fuse<TaskIndexRecord>;

  private snapshotKey?: string;

  private expiresAt = 0;

  private size = 0;

  constructor(private readonly loader: (scope?: unknown) => Promise<TaskIndexRecord[]>, private readonly ttlSeconds: number) {}

  private makeKey(scope?: unknown): string {
    return JSON.stringify(scope ?? {});
  }

  private fuseOptions(): IFuseOptions<TaskIndexRecord> {
    return {
      includeScore: true,
      ignoreLocation: true,
      threshold: 0.35,
      keys: [
        { name: "name", weight: 2 },
        { name: "description", weight: 1.5 },
        { name: "comments", weight: 1.25 },
        { name: "custom", weight: 1.25 },
        { name: "status", weight: 0.5 },
        { name: "priority", weight: 0.4 },
        { name: "listName", weight: 0.6 },
        { name: "spaceName", weight: 0.6 }
      ]
    };
  }

  async ensure(scope?: unknown): Promise<void> {
    const key = this.makeKey(scope);
    const now = Date.now();
    if (this.fuse && this.snapshotKey === key && now < this.expiresAt) {
      return;
    }
    const records = await this.loader(scope);
    this.fuse = new Fuse(records, this.fuseOptions());
    this.snapshotKey = key;
    this.expiresAt = now + this.ttlSeconds * 1000;
    this.size = records.length;
  }

  get count(): number {
    return this.size;
  }

  search(q: string, limit: number): { item: TaskIndexRecord; score: number | null; matches?: { key: string }[] }[] {
    if (!this.fuse) {
      return [];
    }
    const results = this.fuse.search(q, { limit });
    return results.map(entry => {
      const matches = entry.matches
        ?.map(match => {
          if (typeof match.key === "string") {
            return { key: match.key };
          }
          return null;
        })
        .filter((value): value is { key: string } => value !== null);
      return {
        item: entry.item,
        score: typeof entry.score === "number" ? entry.score : null,
        matches
      };
    });
  }
}
