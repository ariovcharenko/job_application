import { describe, expect, it } from "vitest";
import { canUseIndexedDB, STORAGE_PROBE_DB } from "./storageCheck";

describe("canUseIndexedDB", () => {
  it("is true when a database opens, and leaves no probe database behind", async () => {
    expect(await canUseIndexedDB(indexedDB)).toBe(true);
    // deleteDatabase is fire-and-forget; give it a tick.
    await new Promise((r) => setTimeout(r, 20));
    const names = (await indexedDB.databases()).map((d) => d.name);
    expect(names).not.toContain(STORAGE_PROBE_DB);
  });

  it("is false when IndexedDB doesn't exist", async () => {
    expect(await canUseIndexedDB(undefined)).toBe(false);
  });

  it("is false when open throws (Safari private mode)", async () => {
    const throwing = {
      open: () => {
        throw new DOMException("denied", "SecurityError");
      },
    } as unknown as IDBFactory;
    expect(await canUseIndexedDB(throwing)).toBe(false);
  });

  it("is false when the open request fails (Firefox private mode)", async () => {
    const failing = {
      open: () => {
        const req = {} as IDBOpenDBRequest;
        setTimeout(() => (req.onerror as unknown as () => void)?.(), 0);
        return req;
      },
    } as unknown as IDBFactory;
    expect(await canUseIndexedDB(failing)).toBe(false);
  });

  it("gives a browser that never answers the benefit of the doubt", async () => {
    const silent = { open: () => ({}) as IDBOpenDBRequest } as unknown as IDBFactory;
    expect(await canUseIndexedDB(silent, 10)).toBe(true);
  });
});
