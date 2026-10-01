import { db, getSettings, saveSettings } from "./db";

// Data controls for Settings > Backup and restore: forget the API keys, or delete everything this
// app keeps in this browser (the IndexedDB database plus local/session storage) and start over.
// The browser APIs are passed in (with real defaults) so the logic can be tested in Node.

/** The parts of the browser that "Delete all my data" touches. */
export interface WipeDeps {
  /** Closes and deletes the whole Dexie database. */
  deleteDatabase: () => Promise<void>;
  /** Each storage getter may throw (blocked site data, private windows) or return undefined. */
  storages: (() => Pick<Storage, "clear"> | undefined)[];
  reload: () => void;
}

/** The text she must type to confirm "Delete all my data". */
export const DELETE_CONFIRM_WORD = "DELETE";

/** True only for exactly the confirm word (surrounding spaces ignored, case must match). */
export function isDeleteConfirmed(typed: string): boolean {
  return typed.trim() === DELETE_CONFIRM_WORD;
}

export function browserWipeDeps(): WipeDeps {
  return {
    deleteDatabase: async () => {
      db.close();
      await db.delete();
    },
    storages: [() => globalThis.localStorage, () => globalThis.sessionStorage],
    reload: () => globalThis.location?.reload(),
  };
}

export interface WipeResult {
  /** Storages that couldn't be cleared (blocked or unavailable). The database is always attempted first. */
  storageErrors: number;
}

/**
 * Deletes everything this app stores in this browser, then reloads so the app starts fresh (the
 * first-run setup card). The database is deleted first: if that fails the error is thrown and
 * nothing else is touched, so she never ends up with half her data gone and no message.
 */
export async function wipeAllData(deps: WipeDeps = browserWipeDeps()): Promise<WipeResult> {
  await deps.deleteDatabase();
  let storageErrors = 0;
  for (const get of deps.storages) {
    try {
      get()?.clear();
    } catch {
      storageErrors++;
    }
  }
  deps.reload();
  return { storageErrors };
}

/** Fired on window after the keys are forgotten, so an open API key card can clear its field. */
export const API_KEYS_FORGOTTEN_EVENT = "job-copilot:api-keys-forgotten";

/** Removes the Anthropic (and JSearch) API keys from this browser. Everything else stays. */
export async function forgetApiKeys(): Promise<void> {
  await saveSettings({ anthropicKey: "", jsearchApiKey: "" });
  if (typeof window !== "undefined") window.dispatchEvent(new Event(API_KEYS_FORGOTTEN_EVENT));
}

/** Whether an Anthropic key is saved in this browser. */
export async function hasApiKey(): Promise<boolean> {
  return (await getSettings()).anthropicKey.trim() !== "";
}
