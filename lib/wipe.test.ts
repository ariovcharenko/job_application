import Dexie from "dexie";
import { beforeEach, describe, expect, it, vi } from "vitest";
import { db, getSettings, saveProfile, saveSettings } from "./db";
import { DEFAULT_PROFILE } from "./defaults";
import { blankApplication } from "./tracker/blank";
import { browserWipeDeps, forgetApiKeys, hasApiKey, isDeleteConfirmed, wipeAllData, type WipeDeps } from "./wipe";

function fakeStorage() {
  return { clear: vi.fn() };
}

function deps(over: Partial<WipeDeps> = {}): WipeDeps & { reload: ReturnType<typeof vi.fn> } {
  const reload = vi.fn();
  return { deleteDatabase: vi.fn(async () => {}), storages: [], ...over, reload } as WipeDeps & { reload: ReturnType<typeof vi.fn> };
}

beforeEach(async () => {
  if (!db.isOpen()) await db.open();
  await Promise.all(db.tables.map((t) => t.clear()));
});

describe("isDeleteConfirmed", () => {
  it("needs exactly DELETE", () => {
    expect(isDeleteConfirmed("DELETE")).toBe(true);
    expect(isDeleteConfirmed("  DELETE ")).toBe(true);
    expect(isDeleteConfirmed("delete")).toBe(false);
    expect(isDeleteConfirmed("DELET")).toBe(false);
    expect(isDeleteConfirmed("")).toBe(false);
  });
});

describe("wipeAllData", () => {
  it("deletes the database, clears both storages, then reloads", async () => {
    const order: string[] = [];
    const local = { clear: vi.fn(() => order.push("local")) };
    const session = { clear: vi.fn(() => order.push("session")) };
    const d = deps({
      deleteDatabase: vi.fn(async () => void order.push("db")),
      storages: [() => local, () => session],
    });
    d.reload.mockImplementation(() => order.push("reload"));
    const r = await wipeAllData(d);
    expect(order).toEqual(["db", "local", "session", "reload"]);
    expect(r.storageErrors).toBe(0);
  });

  it("keeps going when a storage is blocked or missing", async () => {
    const session = fakeStorage();
    const d = deps({
      storages: [
        () => {
          throw new Error("SecurityError");
        },
        () => undefined,
        () => ({
          clear: () => {
            throw new Error("blocked");
          },
        }),
        () => session,
      ],
    });
    const r = await wipeAllData(d);
    expect(session.clear).toHaveBeenCalled();
    expect(r.storageErrors).toBe(2);
    expect(d.reload).toHaveBeenCalledTimes(1);
  });

  it("touches nothing else if the database can't be deleted", async () => {
    const local = fakeStorage();
    const d = deps({ deleteDatabase: vi.fn(async () => Promise.reject(new Error("blocked"))), storages: [() => local] });
    await expect(wipeAllData(d)).rejects.toThrow("blocked");
    expect(local.clear).not.toHaveBeenCalled();
    expect(d.reload).not.toHaveBeenCalled();
  });

  it("really deletes the app's IndexedDB database with the default deps", async () => {
    await saveProfile({ ...DEFAULT_PROFILE, fullName: "Sam Rivera" });
    await db.applications.add(blankApplication());
    expect(await Dexie.exists(db.name)).toBe(true);

    const real = browserWipeDeps();
    const reload = vi.fn();
    // Node has no localStorage/location: the getters return undefined, which is fine.
    await wipeAllData({ ...real, reload });
    expect(await Dexie.exists(db.name)).toBe(false);
    expect(reload).toHaveBeenCalled();

    // Reopening gives a fresh, empty database (what the reloaded page sees).
    await db.open();
    expect(await db.applications.count()).toBe(0);
    expect(await db.profile.count()).toBe(0);
  });
});

describe("forgetApiKeys", () => {
  it("clears both keys and keeps the other settings", async () => {
    await saveSettings({ anthropicKey: "sk-ant-x", jsearchApiKey: "rapid", workspaceId: "wrkspc_1", smartModel: "claude-opus-5" });
    expect(await hasApiKey()).toBe(true);
    await forgetApiKeys();
    const s = await getSettings();
    expect(s.anthropicKey).toBe("");
    expect(s.jsearchApiKey).toBe("");
    expect(s.workspaceId).toBe("wrkspc_1");
    expect(s.smartModel).toBe("claude-opus-5");
    expect(await hasApiKey()).toBe(false);
  });
});
