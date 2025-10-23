import { vi } from "vitest";

vi.useFakeTimers();
vi.setSystemTime(new Date("2025-01-01T12:00:00.000Z"));

vi.mock("fuse.js", () => {
  class Fuse<T> {
    private readonly list: T[];

    constructor(list: T[]) {
      this.list = list;
    }

    search() {
      return this.list.map(item => ({ item, score: 0 }));
    }
  }
  return { default: Fuse };
});
