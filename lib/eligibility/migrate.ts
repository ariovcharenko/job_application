import { DEFAULT_PREFERENCES } from "../defaults";
import { REMOTE_US, cityChoice, metroChoice } from "../geo/choices";
import { citySlug } from "../geo/index";
import type { LegacyMustHaves, MustHaves, Preferences } from "../types";
import { LEGACY_ROLE_TYPES } from "./roles";

// Brings stored preferences from any version up to the current shape. Used by the Dexie v4
// upgrade (lib/db.ts), by getPreferences (so a record written by an older tab still reads right)
// and by backup restore. Idempotent: current-shape preferences come back unchanged.

/** The fixed regions from before v4 -> their metro. */
export const LEGACY_REGIONS: Record<string, string> = {
  "Orange County, CA": "oc",
  "Los Angeles, CA": "la",
  "San Francisco Bay Area, CA": "sf-bay-area",
  "San Diego, CA": "san-diego",
  "Sacramento, CA": "sacramento",
  "Seattle, WA": "seattle",
  "New York, NY": "nyc",
  "Austin, TX": "austin",
  "Chicago, IL": "chicago",
  "Boston, MA": "boston",
};

/** An old region name (or a custom "City, ST" she typed) as a location choice id, or null. */
export function legacyRegionToChoice(region: string): string | null {
  const name = region.trim();
  if (LEGACY_REGIONS[name]) return metroChoice(LEGACY_REGIONS[name]);
  const m = name.match(/^([^,]+),\s*([A-Za-z]{2})$/);
  return m ? cityChoice(citySlug(m[1], m[2].toUpperCase())) : null;
}

const NEW_KEYS: (keyof MustHaves)[] = ["experience", "degree", "location", "workAuth", "clearance"];

export function migrateMustHaves(raw: unknown): MustHaves {
  const m = (raw && typeof raw === "object" ? raw : {}) as Partial<MustHaves> & LegacyMustHaves;
  // "location" exists in both shapes, so it can't tell them apart.
  if (NEW_KEYS.some((k) => k !== "location" && typeof m[k] === "boolean")) return { ...DEFAULT_PREFERENCES.mustHaves, ...pickBooleans(m as Record<string, unknown>, NEW_KEYS) };
  const on = (v: boolean | undefined) => v ?? true;
  return {
    experience: on(m.newGrad),
    degree: on(m.bachelorsEnough),
    location: on(m.location),
    workAuth: on(m.internationalOk) || on(m.opt),
    clearance: on(m.internationalOk),
  };
}

function pickBooleans<K extends string>(o: Record<string, unknown>, keys: K[]): Partial<Record<K, boolean>> {
  const out: Partial<Record<K, boolean>> = {};
  for (const k of keys) if (typeof o[k] === "boolean") out[k] = o[k] as boolean;
  return out;
}

const isLegacy = (raw: Record<string, unknown>) => !Array.isArray(raw.locations);

/** Any stored preferences record (or undefined) -> current Preferences, defaults filled in. */
export function migratePreferences(stored: unknown): Preferences {
  const raw = (stored && typeof stored === "object" ? stored : {}) as Record<string, unknown> & Partial<Preferences>;
  const legacy = isLegacy(raw);
  const legacyMust = (raw.mustHaves ?? {}) as LegacyMustHaves;
  const workModes = Array.isArray(raw.workModes) ? raw.workModes : DEFAULT_PREFERENCES.workModes;

  let locations: string[];
  if (!legacy) locations = raw.locations as string[];
  else {
    const fromRegions = (Array.isArray(raw.regions) ? raw.regions : []).map(legacyRegionToChoice).filter((x): x is string => !!x);
    // Remote used to be allowed through work styles alone; now it's a location too.
    locations = Array.from(new Set([...fromRegions, ...(raw.workModes && workModes.includes("Remote") ? [REMOTE_US] : [])]));
  }

  let experienceLevel = typeof raw.experienceLevel === "string" ? raw.experienceLevel : "";
  if (legacy && typeof raw.experienceLevel !== "string" && (legacyMust.newGrad === true || (raw.seniority ?? []).some((s) => /new grad|entry/i.test(s)))) {
    experienceLevel = "new-grad";
  }

  const out: Preferences = {
    ...DEFAULT_PREFERENCES,
    ...(raw as Partial<Preferences>),
    id: "me",
    workModes,
    locations,
    experienceLevel: experienceLevel as Preferences["experienceLevel"],
    targetRoles: (Array.isArray(raw.targetRoles) ? raw.targetRoles : []).map((r) => LEGACY_ROLE_TYPES[r] ?? r),
    mustHaves: migrateMustHaves(raw.mustHaves),
    dealBreakers: { ...DEFAULT_PREFERENCES.dealBreakers, ...(raw.dealBreakers ?? {}) },
    weights: { ...DEFAULT_PREFERENCES.weights, ...(raw.weights ?? {}) },
  };
  delete out.regions;
  return out;
}
