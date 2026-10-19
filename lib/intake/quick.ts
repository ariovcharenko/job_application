import type { CandidateFacts } from "../eligibility/candidate";
import type { ExperienceLevel, MustHaves, Preferences } from "../types";
import { CHOICE_CONFIDENCE_MIN, SKIP_NOUL_MIN, degreeWarning, levelFail, type EarlyRead } from "./earlyRead";
import { mentionedSkillsMatch } from "./analyze";
import { headlineFor, MUST_HAVE_FILTERS, joinAnd, type FilterResult, type Headline } from "./decision";

// The "quick result": a provisional answer shown while Claude's full check runs. Pure code, no AI.
//  - The percentage is the code-only skills overlap of the technologies the posting mentions
//    against her master profile (decision #7: numbers come from code).
//  - A must-have can only FAIL here, and only when Jev is confident (same bars as earlyRead.ts).
//    Anything Jev didn't flag is "not checked yet", never a pass (decision #5 spirit).
//  - Her own status (sponsorship, visa) comes only from Profile facts (decision #4); Jev only
//    reads what the posting says.
// The stored verdict always comes from the full check; this is replaced when it arrives.

export interface QuickFail {
  key: keyof MustHaves;
  /** Short plain reason, e.g. "won't sponsor". */
  reason: string;
}

export interface QuickResult {
  /** "not-a-fit": a confident early fail. "quick-match": the code skills estimate. */
  kind: "not-a-fit" | "quick-match";
  headline: Headline;
  /** The skills overlap from code, when the posting mentions enough technologies. */
  percent: number | null;
  /** One line, plain words. */
  reason: string;
  /** Short names of the must-haves she has on that this quick pass did not flag as failing. */
  notChecked: string[];
  /** Heads-ups that are not fails (e.g. a degree Jev can't tell is required). */
  warnings: string[];
}

export interface QuickInput {
  jdText: string;
  /** The Jev early read, or null (no key, not back yet, or an error). */
  early: EarlyRead | null;
  mustHaves: MustHaves;
  candidate: CandidateFacts;
  /** The master profile text. */
  master: string;
  prefs: QuickPrefs;
}

export type QuickPrefs = Pick<Preferences, "workModes"> & { experienceLevel?: ExperienceLevel };

const STYLE_LABEL = { remote: "Remote", hybrid: "Hybrid", onsite: "On-site" } as const;

/** Confident fails from the early read, for must-haves she has on and that apply to her. */
export function quickFails(early: EarlyRead, mustHaves: MustHaves, candidate: CandidateFacts, prefs: QuickPrefs): QuickFail[] {
  const fails: QuickFail[] = [];
  if (mustHaves.workAuth) {
    if (early.noSponsor >= SKIP_NOUL_MIN && candidate.needsSponsorship) fails.push({ key: "workAuth", reason: "won't sponsor" });
    if (early.noOpt >= SKIP_NOUL_MIN && candidate.onStudentVisa) fails.push({ key: "workAuth", reason: "excludes OPT or future sponsorship" });
  }
  if (early.citizenOrClearance >= SKIP_NOUL_MIN) {
    if (mustHaves.clearance) fails.push({ key: "clearance", reason: "needs citizenship or a security clearance" });
    else if (mustHaves.workAuth && candidate.visaStatusSet && !candidate.isCitizen) fails.push({ key: "workAuth", reason: "needs U.S. citizenship" });
  }
  const lf = levelFail(early, mustHaves, prefs.experienceLevel);
  if (lf) fails.push({ key: "experience", reason: lf.reason });
  const ws = early.workStyle;
  if (mustHaves.location && ws && ws.confidence >= CHOICE_CONFIDENCE_MIN && prefs.workModes.length > 0 && !prefs.workModes.includes(STYLE_LABEL[ws.value])) {
    fails.push({ key: "location", reason: `is ${ws.value === "onsite" ? "on-site" : ws.value}, a work style you haven't selected` });
  }
  return fails;
}

/** The provisional result, or null when there is nothing useful to say yet. */
export function quickResult(input: QuickInput): QuickResult | null {
  const { jdText, early, mustHaves, candidate, master, prefs } = input;
  const skills = master.trim() && jdText.trim() ? mentionedSkillsMatch(jdText, master) : null;
  const percent = skills?.percent ?? null;
  const fails = early ? quickFails(early, mustHaves, candidate, prefs) : [];
  const dw = early ? degreeWarning(early, mustHaves, candidate) : null;
  const warnings = dw ? [dw] : [];
  const on = MUST_HAVE_FILTERS.filter((f) => mustHaves[f.key]);

  if (fails.length) {
    const failKeys = new Set(fails.map((f) => f.key));
    const filters: FilterResult[] = on.map((f) => ({
      key: f.key,
      label: f.label,
      short: f.short,
      status: failKeys.has(f.key) ? "fail" : "unknown",
      details: [],
    }));
    const headline = headlineFor({ filters, canApply: false, failed: filters.filter((f) => f.status === "fail"), unclear: [] }, skills);
    const reasons = [...new Set(fails.map((f) => f.reason))];
    // "The posting won't sponsor and excludes OPT." / "The posting is on-site, a work style you haven't selected."
    const reason = `The posting ${joinAnd(reasons)}.`.replace(/^The posting won't/, "The posting says it won't");
    return { kind: "not-a-fit", headline, percent, reason, notChecked: on.filter((f) => !failKeys.has(f.key)).map((f) => f.short), warnings };
  }

  if (percent === null) return null;
  const notChecked = on.map((f) => f.short);
  const headline: Headline = {
    kind: "unknown",
    percent,
    label: "Quick estimate",
    summary: notChecked.length ? `Not checked yet: ${joinAnd(notChecked)}.` : "",
    pill: `~${percent}% skills`,
    strong: false,
  };
  return { kind: "quick-match", headline, percent, reason: `${percent}% of the technologies it mentions are in your experience.`, notChecked, warnings };
}
