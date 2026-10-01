import type { SkillMatch } from "../resume/master/skills";
import type { Criterion } from "../scoring/criteria";
import type { MustHaves } from "../types";

// The answer to "should I apply?": the candidate's must-have filters checked against the
// eligibility checklist, then (if nothing rules it out) how much of the job's skill list she has.
// Pure code, re-run for free whenever she changes a filter; the AI only extracted the facts.

export const MUST_HAVE_FILTERS: { key: keyof MustHaves; label: string; short: string; criteria: Criterion["key"][] }[] = [
  { key: "experience", label: "Matches my experience level", short: "Level", criteria: ["experience"] },
  { key: "degree", label: "My degree meets the requirement", short: "Degree", criteria: ["degree"] },
  { key: "location", label: "In my locations, with a work style I accept", short: "Location", criteria: ["location"] },
  { key: "workAuth", label: "Works with my work authorization", short: "Work auth", criteria: ["sponsorship", "opt", "citizenship"] },
  { key: "clearance", label: "No security clearance required", short: "Clearance", criteria: ["clearance"] },
];

/**
 * Checklists saved before the clearance row existed had one "citizenship" row covering both;
 * a clearance failure there becomes a "clearance" row, so it maps to the right must-have.
 */
export function normalizeLegacyCriteria(criteria: Criterion[]): Criterion[] {
  return criteria.map((c) =>
    c.key === "citizenship" && c.status === "fail" && /clearance/i.test(c.detail) && !/citizenship/i.test(c.detail) ? { ...c, key: "clearance", label: "Security clearance" } : c,
  );
}

export interface FilterResult {
  /** A MustHaves key. Results saved before database v4 may carry an old key ("newGrad"...). */
  key: keyof MustHaves;
  label: string;
  /** One or two words, for the pills. Optional: older stored results don't have it. */
  short?: string;
  /** "fail" if any of its checks failed, "unknown" if any is unclear, otherwise "pass". */
  status: Criterion["status"];
  details: string[];
}

export interface ApplyDecision {
  /** Only the filters she has turned on. */
  filters: FilterResult[];
  /** On and failed: the reasons not to apply. */
  failed: FilterResult[];
  /** On but the posting doesn't say. Not a no, but not a yes either: check before applying. */
  unclear: FilterResult[];
  canApply: boolean;
}

export function decideApply(rawCriteria: Criterion[], mustHaves: MustHaves): ApplyDecision {
  const criteria = normalizeLegacyCriteria(rawCriteria);
  const filters: FilterResult[] = MUST_HAVE_FILTERS.filter((f) => mustHaves[f.key]).map((f) => {
    const checks = criteria.filter((c) => f.criteria.includes(c.key));
    const status: Criterion["status"] = checks.some((c) => c.status === "fail")
      ? "fail"
      : checks.some((c) => c.status === "unknown")
        ? "unknown"
        : "pass";
    // Show why it failed first; for a pass or unclear filter show every check's detail.
    const shown = status === "fail" ? checks.filter((c) => c.status === "fail") : checks;
    return { key: f.key, label: f.label, short: f.short, status, details: shown.map((c) => c.detail) };
  });
  const failed = filters.filter((f) => f.status === "fail");
  return { filters, failed, unclear: filters.filter((f) => f.status === "unknown"), canApply: failed.length === 0 };
}

export interface SkillsMatch {
  /** 0-100, or null when there's nothing to compare. */
  percent: number | null;
  /** "skills": the posting's required/preferred skills lists. "mentioned": no lists were
   * extracted, so this is every technology the text mentions ("keywords": an older, word-based
   * version of that, replaced on the next tracker load). */
  basis?: "skills" | "mentioned" | "keywords";
  required: SkillMatch;
  preferred: SkillMatch;
}

/** Share of preferred ("nice to have") skills in the percentage when the job lists both kinds. */
export const PREFERRED_WEIGHT = 0.25;

const share = (m: SkillMatch) => {
  const total = m.have.length + m.gap.length;
  return total ? m.have.length / total : null;
};

/** How much of the job's skill list is in her master profile, weighting required skills 3:1. */
export function skillsMatchPercent(required: SkillMatch, preferred: SkillMatch): SkillsMatch {
  const r = share(required);
  const p = share(preferred);
  const frac = r !== null && p !== null ? (1 - PREFERRED_WEIGHT) * r + PREFERRED_WEIGHT * p : (r ?? p);
  return { percent: frac === null ? null : Math.round(frac * 100), basis: "skills", required, preferred };
}

/** Below this match she's told the fit is weak, even when every must-have passes. */
export const LOW_MATCH_BELOW = 50;

export type Verdict = "apply" | "low-match" | "dont-apply";

export const VERDICT_TEXT: Record<Verdict, { label: string; detail: string }> = {
  apply: { label: "Apply", detail: "Nothing rules you out, and your skills fit." },
  "low-match": { label: "Weak match", detail: "Nothing rules you out, but you have few of the skills it asks for." },
  "dont-apply": { label: "Don't apply", detail: "It fails one of your must-haves." },
};

/** One answer to "should I apply?": must-haves first, then the match percentage. */
export function verdictFor(decision: Pick<ApplyDecision, "canApply">, percent: number | null): Verdict {
  if (!decision.canApply) return "dont-apply";
  return percent !== null && percent < LOW_MATCH_BELOW ? "low-match" : "apply";
}
