import type { Application } from "../types";

/** Bookkeeping fields that change on every save and never count as an edit. */
const IGNORED: ReadonlySet<string> = new Set(["updatedAt"]);

/**
 * Whether the job being edited differs from what was last loaded or saved, so closing the form
 * would lose something. A field that is missing and one set to undefined count as the same.
 */
export function hasUnsavedChanges(current: Application, saved: Application): boolean {
  const a = current as unknown as Record<string, unknown>;
  const b = saved as unknown as Record<string, unknown>;
  const keys = new Set([...Object.keys(a), ...Object.keys(b)]);
  for (const key of keys) {
    if (IGNORED.has(key)) continue;
    if (a[key] !== b[key]) return true;
  }
  return false;
}
