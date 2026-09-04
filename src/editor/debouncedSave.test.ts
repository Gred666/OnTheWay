import { afterEach, describe, expect, it, vi } from "vitest";
import { createDebouncedSaver } from "./debouncedSave";

afterEach(() => vi.useRealTimers());

describe("debounced save", () => {
  it("persists only the latest version after 400ms", async () => {
    vi.useFakeTimers();
    const writes: string[] = [];
    const saver = createDebouncedSaver(async (value) => {
      writes.push(value);
    });
    saver.schedule("a");
    saver.schedule("ab");
    saver.schedule("abc");
    await vi.advanceTimersByTimeAsync(400);
    expect(writes).toEqual(["abc"]);
  });

  it("flushes immediately when switching document or closing", async () => {
    vi.useFakeTimers();
    const writes: string[] = [];
    const saver = createDebouncedSaver(async (value) => {
      writes.push(value);
    });
    saver.schedule("最后一版");
    await saver.flush();
    expect(writes).toEqual(["最后一版"]);
    expect(saver.pending()).toBe(false);
  });

  it("can retry after a failed write", async () => {
    let attempts = 0;
    const writes: string[] = [];
    const saver = createDebouncedSaver(async (value) => {
      attempts += 1;
      if (attempts === 1) throw new Error("temporary failure");
      writes.push(value);
    });

    saver.schedule("first");
    await expect(saver.flush()).rejects.toThrow("temporary failure");
    expect(saver.pending()).toBe(true);
    await expect(saver.flush()).resolves.toBeUndefined();
    expect(writes).toEqual(["first"]);
  });

  it("prefers newer text when a write fails during continued typing", async () => {
    let rejectFirst!: (error: Error) => void;
    const writes: string[] = [];
    const saver = createDebouncedSaver((value) => {
      if (value === "old") {
        return new Promise<void>((_resolve, reject) => {
          rejectFirst = reject;
        });
      }
      writes.push(value);
      return Promise.resolve();
    }, 10_000);

    saver.schedule("old");
    const failed = saver.flush();
    await Promise.resolve();
    await Promise.resolve();
    saver.schedule("new");
    rejectFirst(new Error("offline"));
    await expect(failed).rejects.toThrow("offline");
    await saver.flush();

    expect(writes).toEqual(["new"]);
  });
});
