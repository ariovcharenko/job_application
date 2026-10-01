import type { Target } from "../engine/edit";
import type { ResumeComment } from "../engine/revise";
import type { QualityIssue } from "./types";

// Turns lint issues into a number for the UI and into revision comments for the model.

/** Points taken off per issue, and the most "consider" issues can take off in total. */
export const SCORE_WEIGHTS = { fix: 8, consider: 2, considerCap: 20 };

export interface QualityScore {
  /** 0 to 100. 100 = no issues. */
  score: number;
  fix: number;
  consider: number;
  total: number;
}

/**
 * 100 minus 8 per "fix" and 2 per "consider" (the "consider" deduction is capped at 20, since
 * those are judgment calls a strong resume may keep), floored at 0. So a page with no "fix"
 * issues always scores 80 or more, and five "fix" issues bring any page to 60 or less.
 */
export function qualityScore(issues: QualityIssue[]): QualityScore {
  const fix = issues.filter((i) => i.severity === "fix").length;
  const consider = issues.length - fix;
  const penalty = fix * SCORE_WEIGHTS.fix + Math.min(SCORE_WEIGHTS.considerCap, consider * SCORE_WEIGHTS.consider);
  return { score: Math.max(0, 100 - penalty), fix, consider, total: issues.length };
}

const targetKey = (t?: Target) => (t ? `${t.section}.${t.entry}.${t.bullet ?? ""}` : "page");

/**
 * "fix" issues as revision comments (lib/resume/engine/revise.ts), one per spot on the page: several
 * issues on the same bullet become one comment whose note lists each fix. The quote is the
 * offending text when there's a single issue; "" when several are merged (the target still says
 * where). Comment ids are "quality:" plus the first issue's id, so they're stable for a document.
 */
export function issuesToComments(issues: QualityIssue[]): ResumeComment[] {
  const groups = new Map<string, QualityIssue[]>();
  for (const issue of issues) {
    if (issue.severity !== "fix") continue;
    const key = targetKey(issue.target);
    groups.set(key, [...(groups.get(key) ?? []), issue]);
  }
  return [...groups.values()].map((group) => {
    const [first] = group;
    const hints = [...new Set(group.map((i) => i.fixHint))];
    return {
      id: `quality:${first.id}`,
      quote: group.length === 1 ? first.quote ?? "" : "",
      note: hints.join(" "),
      ...(first.target ? { target: first.target } : {}),
    };
  });
}
