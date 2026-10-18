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
  /** One plain line for a failed or unclear filter, without the posting's quotes. Missing on
   * results saved before it existed: filterExplanation derives it from details then. */
  summary?: string;
  /** The posting's own words behind it, each shown once (sponsorship and OPT often quote the same sentence). */
  quotes?: string[];
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
    const result: FilterResult = { key: f.key, label: f.label, short: f.short, status, details: shown.map((c) => c.detail) };
    if (status === "pass") return result;
    // The reasons line covers only the checks that make it fail or unclear.
    const why = checks.filter((c) => c.status === status);
    return { ...result, summary: summarizeChecks(why), quotes: uniqueQuotes(why.flatMap((c) => (c.quote ? [c.quote] : quotesIn(c.detail)))) };
  });
  const failed = filters.filter((f) => f.status === "fail");
  return { filters, failed, unclear: filters.filter((f) => f.status === "unknown"), canApply: failed.length === 0 };
}

// ---- Reasons: one plain line per failed or unclear must-have, the posting's quote once ----

/** Plain words for a failed work-authorization row: "Won't sponsor visas and excludes OPT." */
const FAIL_PHRASE: Partial<Record<Criterion["key"], string>> = {
  sponsorship: "won't sponsor visas",
  opt: "excludes OPT",
  citizenship: "requires US citizenship",
};

/** "a", "a and b", "a, b and c". */
export function joinAnd(items: string[]): string {
  if (items.length <= 1) return items[0] ?? "";
  return `${items.slice(0, -1).join(", ")} and ${items[items.length - 1]}`;
}

const capitalize = (t: string) => (t ? t[0].toUpperCase() + t.slice(1) : t);

/** Quoted passages ("...") in a detail line. Older saved rows carry the posting's words only there. */
export function quotesIn(text: string): string[] {
  return [...text.matchAll(/"([^"]{3,})"/g)].map((m) => m[1].trim());
}

/** A detail line without its quoted passages. */
export function withoutQuotes(text: string): string {
  return text
    .replace(/\s*"[^"]{3,}"/g, "")
    .replace(/\s+/g, " ")
    .replace(/\s+([.,])/g, "$1")
    .trim();
}

const quoteKey = (q: string) => q.toLowerCase().replace(/[^a-z0-9]+/g, " ").trim();

/** Distinct quotes in order. Identical or near-identical ones (one inside the other) collapse to the longer. */
export function uniqueQuotes(quotes: string[]): string[] {
  const out: string[] = [];
  for (const raw of quotes) {
    const q = raw.trim();
    const k = quoteKey(q);
    if (!k) continue;
    const i = out.findIndex((o) => {
      const ok = quoteKey(o);
      return ok === k || ok.includes(k) || k.includes(ok);
    });
    if (i === -1) out.push(q);
    else if (k.length > quoteKey(out[i]).length) out[i] = q;
  }
  return out;
}

/** Distinct sentences, in order. */
function uniqueSentences(lines: string[]): string[] {
  const seen = new Set<string>();
  const out: string[] = [];
  for (const line of lines) {
    for (const s of line.match(/[^.!?]+[.!?]*/g) ?? []) {
      const t = s.trim();
      const k = t.toLowerCase();
      if (t && !seen.has(k)) {
        seen.add(k);
        out.push(t);
      }
    }
  }
  return out;
}

/** One line for the checks behind a failed or unclear must-have. */
function summarizeChecks(checks: Criterion[]): string {
  if (checks.length && checks.every((c) => c.status === "fail" && FAIL_PHRASE[c.key])) {
    return `${capitalize(joinAnd([...new Set(checks.map((c) => FAIL_PHRASE[c.key]!))]))}.`;
  }
  return uniqueSentences(checks.map((c) => withoutQuotes(c.detail))).join(" ");
}

/** What to show for a failed or unclear must-have: a plain line, then the posting's words once. */
export function filterExplanation(f: FilterResult): { summary: string; quotes: string[] } {
  if (f.summary !== undefined) return { summary: f.summary, quotes: f.quotes ?? [] };
  return { summary: uniqueSentences(f.details.map(withoutQuotes)).join(" "), quotes: uniqueQuotes(f.details.flatMap(quotesIn)) };
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

export type Verdict = "apply" | "unknown-match" | "low-match" | "dont-apply";

export const VERDICT_TEXT: Record<Verdict, { label: string; detail: string }> = {
  apply: { label: "Apply", detail: "Nothing rules you out, and your skills fit." },
  "unknown-match": { label: "Eligible, match unknown", detail: "Nothing rules you out, but there's no skills match to go on yet." },
  "low-match": { label: "Weak match", detail: "Nothing rules you out, but you have few of the skills it asks for." },
  "dont-apply": { label: "Don't apply", detail: "It fails one of your must-haves." },
};

/**
 * One answer to "should I apply?": must-haves first, then the match percentage. With no match
 * number (no experience saved yet, or a posting too short to compare) the job is eligible but not
 * a recommendation: "Apply" needs both.
 */
export function verdictFor(decision: Pick<ApplyDecision, "canApply">, percent: number | null): Verdict {
  if (!decision.canApply) return "dont-apply";
  if (percent === null) return "unknown-match";
  return percent < LOW_MATCH_BELOW ? "low-match" : "apply";
}

// ---- The headline number: "how good a fit is this for me", not only skills ----

/**
 * "match": every must-have passes and the match isn't weak (the only purple state).
 * "check-first": nothing fails, but a must-have isn't stated. "weak": nothing fails, few skills.
 * "not-a-fit": a must-have fails, so no big percentage. "unknown": no skills number yet.
 */
export type HeadlineKind = "match" | "check-first" | "weak" | "not-a-fit" | "unknown";

export interface Headline {
  kind: HeadlineKind;
  /** The skills percentage, when there is one. For "not-a-fit" it's only a small aside. */
  percent: number | null;
  /** "Match" or "Not a fit". */
  label: string;
  /** One line under the number ("Work auth and Location rule this out.", "Check first: Work auth."). Empty when none. */
  summary: string;
  /** A small muted aside: the skills overlap of a job that fails a must-have. */
  aside?: string;
  /** Short text for a pill in lists ("95% · Apply", "Not a fit"). */
  pill: string;
  /** Purple only for "match": good and confirmed. */
  strong: boolean;
}

const filterShort = (f: Pick<FilterResult, "key" | "short" | "label">) => f.short ?? MUST_HAVE_FILTERS.find((m) => m.key === f.key)?.short ?? f.label;

/**
 * The one rule for showing a job's number, used by every screen and list. Pure code over the
 * stored decision and skills match (decision #7), so it follows the must-haves for free.
 */
export function headlineFor(
  decision: Pick<ApplyDecision, "filters" | "canApply"> & Partial<Pick<ApplyDecision, "failed" | "unclear">>,
  skills: Pick<SkillsMatch, "percent"> | null | undefined,
): Headline {
  const percent = skills?.percent ?? null;
  const failed = decision.failed ?? (decision.filters ?? []).filter((f) => f.status === "fail");
  if (!decision.canApply || failed.length > 0) {
    const names = joinAnd(failed.map(filterShort));
    return {
      kind: "not-a-fit",
      percent,
      label: "Not a fit",
      summary: names ? `${names} ${failed.length === 1 ? "rules" : "rule"} this out.` : VERDICT_TEXT["dont-apply"].detail,
      aside: percent === null ? undefined : `Skills overlap ${percent}%. Doesn't count while a must-have fails.`,
      pill: "Not a fit",
      strong: false,
    };
  }
  const unclear = decision.unclear ?? (decision.filters ?? []).filter((f) => f.status === "unknown");
  const check = unclear.length ? `Check first: ${joinAnd(unclear.map(filterShort))}.` : "";
  if (percent === null) return { kind: "unknown", percent, label: "Match", summary: check, pill: VERDICT_TEXT["unknown-match"].label, strong: false };
  if (percent < LOW_MATCH_BELOW) return { kind: "weak", percent, label: "Match", summary: check, pill: `${percent}% · ${VERDICT_TEXT["low-match"].label}`, strong: false };
  if (unclear.length) return { kind: "check-first", percent, label: "Match", summary: check, pill: `${percent}% · Check first`, strong: false };
  return { kind: "match", percent, label: "Match", summary: "", pill: `${percent}% · ${VERDICT_TEXT.apply.label}`, strong: true };
}

/** Order by headline: jobs that fail a must-have last, then best match first, no number after numbers. */
export function compareHeadlines(a: Headline, b: Headline): number {
  const failA = a.kind === "not-a-fit" ? 1 : 0;
  const failB = b.kind === "not-a-fit" ? 1 : 0;
  if (failA !== failB) return failA - failB;
  return (b.percent ?? -1) - (a.percent ?? -1);
}
