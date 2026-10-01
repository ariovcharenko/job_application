import { candidateFacts } from "../eligibility/candidate";
import { loadGeo, type GeoIndex } from "../geo/index";
import type { Application, MustHaves, Preferences, Profile } from "../types";
import { assessJob, looksLikeJobPosting, mentionedSkillsMatch, toStoredBreakdown, type StoredBreakdown } from "./analyze";
import { dropSoftSkills } from "../resume/master/skills";
import { decideApply, normalizeLegacyCriteria, skillsMatchPercent, verdictFor } from "./decision";

/** The saved analysis on a tracker row, or null for rows added by hand or before scoring existed. */
export function readBreakdown(app: Pick<Application, "fitBreakdown">): StoredBreakdown | null {
  if (!app.fitBreakdown) return null;
  try {
    return JSON.parse(app.fitBreakdown) as StoredBreakdown;
  } catch {
    return null;
  }
}

/** An analyzed job whose saved text isn't really the posting (a link reader got the page shell). */
export function hasIncompletePosting(app: Pick<Application, "jdText" | "fitBreakdown">): boolean {
  return !!app.fitBreakdown && !!app.jdText.trim() && !looksLikeJobPosting(app.jdText);
}

/**
 * Saved (not yet applied) jobs with an "Apply" verdict (every must-have passes, and not a weak
 * skills match), best skills match first: what to apply
 * to next. Jobs analyzed before the must-have filters existed are left out rather than guessed.
 */
export function readyToApply<T extends Application>(apps: T[]): { app: T; percent: number | null }[] {
  return apps
    .filter((a) => a.stage === "Saved" && a.triage !== "skipped" && !hasIncompletePosting(a))
    .map((app) => ({ app, b: readBreakdown(app) }))
    .filter((x) => x.b?.decision && verdictFor(x.b.decision, x.b.skills?.percent ?? null) === "apply")
    .map(({ app, b }) => ({ app, percent: b?.skills?.percent ?? null }))
    .sort((x, y) => (y.percent ?? -1) - (x.percent ?? -1));
}

/** A stored breakdown without signals: re-map her must-haves over the saved checklist and fix old skill data. */
function refreshChecklistOnly<T extends Application>(app: T, b: StoredBreakdown, mustHaves: MustHaves, masterProfile: string): StoredBreakdown {
  const criteria = normalizeLegacyCriteria(b.criteria ?? []);
  const next: StoredBreakdown = { ...b, criteria, decision: decideApply(criteria, mustHaves) };
  // Saved before soft skills were excluded: drop them and recompute the percentage.
  if (next.skills?.basis === "skills") {
    next.skills = skillsMatchPercent(dropSoftSkills(next.skills.required), dropSoftSkills(next.skills.preferred));
  }
  const needsFallback = next.skills && (next.skills.percent === null || next.skills.basis === "keywords");
  if (next.skills && needsFallback && app.jdText.trim() && masterProfile.trim()) {
    const listsNothing = next.skills.basis === "keywords" ? { ...next.skills, percent: null, basis: undefined } : next.skills;
    next.skills = mentionedSkillsMatch(app.jdText, masterProfile) ?? listsNothing;
  }
  return next;
}

/**
 * Brings saved analyses up to date without any AI call: re-applies her current must-haves to the
 * stored checklist, and fills in a match from the technologies a posting mentions for jobs
 * whose posting listed no skills. Returns only the rows whose stored analysis changed.
 * Kept for callers that only have the must-haves; refreshStoredAnalyses also re-runs the whole
 * assessment (level, degree, work authorization, locations) for rows saved with their signals.
 */
export function refreshBreakdowns<T extends Application>(apps: T[], mustHaves: MustHaves, masterProfile: string): { app: T; fitBreakdown: string }[] {
  const out: { app: T; fitBreakdown: string }[] = [];
  for (const app of apps) {
    const b = readBreakdown(app);
    if (!b?.decision || !b.criteria?.length) continue;
    const json = JSON.stringify(refreshChecklistOnly(app, b, mustHaves, masterProfile));
    if (json !== app.fitBreakdown) out.push({ app, fitBreakdown: json });
  }
  return out;
}

export interface RefreshedAnalysis<T> {
  app: T;
  fitBreakdown: string;
  /** Set when the whole assessment was re-run (the row had its signals). */
  fitScore?: number;
}

/**
 * Re-assesses every saved job for free after her Preferences or Profile change. Rows saved with
 * their signals are re-run through assessJob (the same code as a new check); older rows keep their
 * checklist and only have their must-haves re-mapped. Returns the rows whose analysis changed.
 * Loads the place index first, so location results are never computed without it.
 */
export async function refreshStoredAnalyses<T extends Application>(
  apps: T[],
  prefs: Preferences,
  profile: Pick<Profile, "requiresSponsorship" | "visaStatus" | "degreeType">,
  masterProfile: string,
  geo?: GeoIndex,
): Promise<RefreshedAnalysis<T>[]> {
  const index = geo ?? (await loadGeo());
  const candidate = candidateFacts(profile);
  const out: RefreshedAnalysis<T>[] = [];
  for (const app of apps) {
    const b = readBreakdown(app);
    if (!b) continue;
    if (b.signals) {
      const a = assessJob(b.signals, prefs, masterProfile, app.jdText, { candidate, geo: index });
      const json = JSON.stringify(toStoredBreakdown({ ...a, signals: b.signals }));
      if (json !== app.fitBreakdown || a.score.score !== app.fitScore) out.push({ app, fitBreakdown: json, fitScore: a.score.score });
      continue;
    }
    if (!b.decision || !b.criteria?.length) continue;
    const json = JSON.stringify(refreshChecklistOnly(app, b, prefs.mustHaves, masterProfile));
    if (json !== app.fitBreakdown) out.push({ app, fitBreakdown: json });
  }
  return out;
}
