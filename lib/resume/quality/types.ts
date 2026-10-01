import type { Target } from "../engine/edit";

/**
 * "fix": breaks her rules or reads as AI/template filler; worth sending back to the model.
 * "consider": a judgment call a strong resume may reasonably keep; shown, never auto-sent.
 */
export type Severity = "fix" | "consider";

export type QualityRule =
  | "buzzword"
  | "first-person"
  | "cross-functional-overuse"
  | "trailing-ing-overuse"
  | "verb-tense"
  | "verb-weak"
  | "verb-soft"
  | "verb-repeat"
  | "too-long"
  | "too-thin"
  | "widow"
  | "no-substance"
  | "bold-too-many"
  | "bold-phrase"
  | "bold-verb"
  | "bold-outside-bullets"
  | "role-unquantified"
  | "tech-repeat"
  | "near-duplicate"
  | "phrase-repeat"
  | "trailing-period"
  | "keywords-missing"
  | "keywords-not-top"
  | "skills-line-count"
  | "skills-duplicate"
  | "skills-soft"
  | "skills-filler";

export interface QualityIssue {
  /** Deterministic for the same document: rule plus position plus a short key. */
  id: string;
  severity: Severity;
  rule: QualityRule;
  /** Plain, user-facing sentence. */
  message: string;
  /** Where on the page, in the same shape the preview and edit.ts use. Absent = the whole page. */
  target?: Target;
  /** The offending text as it appears (plain, no ** markers), for quoting in a revision comment. */
  quote?: string;
  /** A short instruction that can be sent to the model as a revision comment. */
  fixHint: string;
}

export interface LintContext {
  /** Job skills she has (have + have_synonym), in the job's spelling. */
  jobSkills?: string[];
  /** The job's required skills, most important first. */
  requiredSkills?: string[];
}
