import type { Application } from "../types";

/** What a re-check (Paste and re-check) replaces: these follow the stored row even if she edited them. */
export const ANALYSIS_FIELDS: ReadonlySet<keyof Application> = new Set<keyof Application>(["jdText", "fitBreakdown", "fitScore"]);

/**
 * The open job form after the stored row changed underneath it (a re-check). Three-way merge:
 * `base` is what the form loaded, `mine` is the form now (maybe with unsaved Details edits),
 * `stored` is the row as it is now. Her unsaved edits are kept, every other field takes the
 * stored value, and the analysis fields always take the stored value (that's what the re-check is for).
 */
export function mergeReloaded(mine: Application, base: Application, stored: Application): Application {
  const m = mine as unknown as Record<string, unknown>;
  const b = base as unknown as Record<string, unknown>;
  const out: Record<string, unknown> = { ...(stored as unknown as Record<string, unknown>) };
  for (const key of new Set([...Object.keys(m), ...Object.keys(b)])) {
    if (ANALYSIS_FIELDS.has(key as keyof Application)) continue;
    if (m[key] !== b[key]) {
      if (m[key] === undefined) delete out[key];
      else out[key] = m[key];
    }
  }
  return out as unknown as Application;
}
