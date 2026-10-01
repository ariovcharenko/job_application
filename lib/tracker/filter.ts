import { ROLE_TYPES, STAGES, type Application, type RoleType, type Stage } from "../types";

export interface TrackerFilters {
  query: string;
  /** "" = every stage. */
  stage: Stage | "";
  /** "" = every role type. */
  roleType: RoleType | "";
}

export const NO_FILTERS: TrackerFilters = { query: "", stage: "", roleType: "" };

type Searchable = Pick<Application, "company" | "role" | "location" | "notes" | "contactName" | "referral" | "stage" | "roleType">;

/** Words she types must each appear somewhere in company, position, location, notes or contact (any order, any case). */
export function matchesQuery(a: Searchable, query: string): boolean {
  const words = query.toLowerCase().split(/\s+/).filter(Boolean);
  if (words.length === 0) return true;
  const haystack = [a.company, a.role, a.location, a.notes, a.contactName, a.referral].map((f) => (f ?? "").toLowerCase()).join("\n");
  return words.every((w) => haystack.includes(w));
}

/** Applies the search box, stage and role-type filters. Order is kept (sort separately). */
export function filterApplications<T extends Searchable>(apps: readonly T[], f: TrackerFilters): T[] {
  return apps.filter((a) => (!f.stage || a.stage === f.stage) && (!f.roleType || a.roleType === f.roleType) && matchesQuery(a, f.query));
}

/** How many jobs sit in each stage, for the stage filter chips. Counts ignore the stage filter itself. */
export function stageCounts(apps: readonly Pick<Application, "stage">[]): Record<Stage, number> {
  const counts = Object.fromEntries(STAGES.map((s) => [s, 0])) as Record<Stage, number>;
  for (const a of apps) if (a.stage in counts) counts[a.stage]++;
  return counts;
}

export const hasActiveFilters = (f: TrackerFilters) => !!(f.query.trim() || f.stage || f.roleType);

// ---- Remembered per viewer (this browser only) ----

export type TrackerView = "table" | "board";

export interface TrackerViewPrefs {
  view: TrackerView;
  stage: Stage | "";
  roleType: RoleType | "";
}

export const DEFAULT_VIEW_PREFS: TrackerViewPrefs = { view: "table", stage: "", roleType: "" };
export const VIEW_PREFS_KEY = "job-copilot:tracker-view";

/** Reads stored prefs, dropping anything unknown (a renamed stage, a hand-edited value) back to the default. */
export function parseViewPrefs(raw: string | null | undefined): TrackerViewPrefs {
  if (!raw) return DEFAULT_VIEW_PREFS;
  let v: unknown;
  try {
    v = JSON.parse(raw);
  } catch {
    return DEFAULT_VIEW_PREFS;
  }
  if (!v || typeof v !== "object") return DEFAULT_VIEW_PREFS;
  const o = v as Record<string, unknown>;
  return {
    view: o.view === "board" ? "board" : "table",
    stage: (STAGES as readonly unknown[]).includes(o.stage) ? (o.stage as Stage) : "",
    roleType: (ROLE_TYPES as readonly unknown[]).includes(o.roleType) ? (o.roleType as RoleType) : "",
  };
}

export function loadViewPrefs(): TrackerViewPrefs {
  try {
    return parseViewPrefs(window.localStorage.getItem(VIEW_PREFS_KEY));
  } catch {
    return DEFAULT_VIEW_PREFS;
  }
}

export function saveViewPrefs(p: TrackerViewPrefs): void {
  try {
    window.localStorage.setItem(VIEW_PREFS_KEY, JSON.stringify(p));
  } catch {
    // Storage blocked (private window, site data off): the choice just isn't remembered.
  }
}
