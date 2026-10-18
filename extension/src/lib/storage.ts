import { BLANK_SYNCED_DATA, type SyncedData } from "../types";
import type { KV } from "./bridgeCore";

const DATA_KEY = "syncedData";

/** chrome.storage.local as the bridge's key-value store. */
export const chromeKV: KV = {
  async get<T>(key: string) {
    const stored = await chrome.storage.local.get(key);
    return stored[key] as T | undefined;
  },
  async set(key, value) {
    await chrome.storage.local.set({ [key]: value });
  },
  async remove(key) {
    await chrome.storage.local.remove(key);
  },
};

export function withDefaults(stored: Partial<SyncedData> | undefined): SyncedData {
  const data = { ...BLANK_SYNCED_DATA, ...(stored ?? {}) };
  return { ...data, profile: { ...BLANK_SYNCED_DATA.profile, ...(stored?.profile ?? {}) } };
}

export async function getSyncedData(): Promise<SyncedData> {
  const stored = await chrome.storage.local.get(DATA_KEY);
  return withDefaults(stored[DATA_KEY] as Partial<SyncedData> | undefined);
}

/**
 * Drops anything older versions stored that this one must not keep: the Anthropic key the old
 * postMessage bridge mirrored, and its pending-capture handoff. Pure, for tests.
 */
export function scrubLegacy(stored: Record<string, unknown>): { set: Record<string, unknown>; remove: string[] } {
  const set: Record<string, unknown> = {};
  const remove: string[] = [];
  const data = stored[DATA_KEY] as Record<string, unknown> | undefined;
  if (data && typeof data === "object" && ("anthropicKey" in data || "resume" in data)) {
    const rest = { ...data };
    delete rest.anthropicKey;
    delete rest.resume;
    set[DATA_KEY] = rest;
  }
  if ("pendingCapture" in stored) remove.push("pendingCapture");
  return { set, remove };
}
