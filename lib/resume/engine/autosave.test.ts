import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { createDebouncedSave } from "./autosave";

beforeEach(() => {
  vi.useFakeTimers();
});
afterEach(() => {
  vi.useRealTimers();
});

describe("createDebouncedSave", () => {
  it("runs only the latest version once it settles", async () => {
    const saved: string[] = [];
    const s = createDebouncedSave(600);
    s.schedule(async () => void saved.push("v1"));
    s.schedule(async () => void saved.push("v2"));
    await vi.advanceTimersByTimeAsync(600);
    expect(saved).toEqual(["v2"]);
  });

  it("flush runs a pending save right away (closing the panel within the delay keeps the edit)", async () => {
    const saved: string[] = [];
    const s = createDebouncedSave(600);
    s.schedule(async () => void saved.push("ticked"));
    await s.flush();
    expect(saved).toEqual(["ticked"]);
    await vi.advanceTimersByTimeAsync(600);
    expect(saved).toEqual(["ticked"]);
    await s.flush(); // nothing pending: no-op
    expect(saved).toEqual(["ticked"]);
  });

  it("never lets a slow older save finish after a newer one", async () => {
    const order: string[] = [];
    const s = createDebouncedSave(10);
    s.schedule(async () => {
      await new Promise((r) => setTimeout(r, 1000)); // e.g. a slow .docx render
      order.push("old");
    });
    await vi.advanceTimersByTimeAsync(10);
    s.schedule(async () => void order.push("new"));
    await vi.advanceTimersByTimeAsync(2000);
    expect(order).toEqual(["old", "new"]);
  });

  it("keeps saving after a failed save", async () => {
    const saved: string[] = [];
    const s = createDebouncedSave(10);
    s.schedule(async () => {
      throw new Error("disk full");
    });
    await vi.advanceTimersByTimeAsync(10);
    s.schedule(async () => void saved.push("next"));
    await vi.advanceTimersByTimeAsync(10);
    expect(saved).toEqual(["next"]);
  });

  it("cancel drops a pending save", async () => {
    const saved: string[] = [];
    const s = createDebouncedSave(10);
    s.schedule(async () => void saved.push("x"));
    s.cancel();
    await vi.advanceTimersByTimeAsync(20);
    await s.flush();
    expect(saved).toEqual([]);
  });
});
