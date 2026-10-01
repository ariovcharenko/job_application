import type { SyncedProfile } from "../types";

export interface TextFieldRule {
  pattern: RegExp;
  get: (profile: SyncedProfile) => string;
}

// Order matters: more specific patterns first, since the first match wins.
export const TEXT_FIELD_RULES: TextFieldRule[] = [
  { pattern: /first\s*name/i, get: (p) => p.fullName.split(" ")[0] ?? "" },
  { pattern: /last\s*name|surname/i, get: (p) => p.fullName.split(" ").slice(1).join(" ") },
  { pattern: /^(your\s*)?(full\s*)?name$/i, get: (p) => p.fullName },
  { pattern: /e-?mail/i, get: (p) => p.email },
  { pattern: /phone/i, get: (p) => p.phone },
  { pattern: /linkedin/i, get: (p) => p.linkedin },
  { pattern: /github/i, get: (p) => p.github },
  { pattern: /portfolio|personal\s*website|^website$/i, get: (p) => p.portfolio },
  { pattern: /school|university|college/i, get: (p) => p.school },
  { pattern: /minor/i, get: (p) => p.minor },
  { pattern: /degree\s*type|level\s*of\s*education/i, get: (p) => p.degreeType },
  { pattern: /major|field\s*of\s*study/i, get: (p) => p.major },
  { pattern: /gpa/i, get: (p) => p.gpa },
  { pattern: /graduation/i, get: (p) => p.graduation },
  { pattern: /salary|compensation\s*expectation|desired\s*pay/i, get: (p) => p.salaryExpectation },
  { pattern: /start\s*date|available\s*to\s*start|earliest\s*start|notice\s*period/i, get: (p) => p.earliestStart },
  { pattern: /location|city|current\s*address/i, get: (p) => p.location },
];

/**
 * Legal/identity yes-no questions. Deliberately strict and narrow: these are the only patterns
 * the fill engine will ever answer automatically, and only from the exact stored Profile field —
 * never guessed, never inferred from a different field. Anything not matching one of these exact
 * patterns is left blank and flagged for her, per the app's non-negotiable rule that the AI/engine
 * never guesses legal answers.
 */
export interface LegalFieldRule {
  pattern: RegExp;
  field: "authorizedToWorkUS" | "requiresSponsorship" | "willingToRelocate";
}

export const LEGAL_FIELD_RULES: LegalFieldRule[] = [
  { pattern: /authoriz(e|ation).{0,40}work.{0,20}(u\.?s\.?a?\.?|united states)/i, field: "authorizedToWorkUS" },
  { pattern: /(u\.?s\.?a?\.?|united states).{0,40}authoriz(e|ation).{0,20}work/i, field: "authorizedToWorkUS" },
  { pattern: /require.{0,20}(visa\s*)?sponsorship/i, field: "requiresSponsorship" },
  { pattern: /sponsorship.{0,20}(now|future|employment)/i, field: "requiresSponsorship" },
  { pattern: /willing.{0,10}(to\s*)?relocat/i, field: "willingToRelocate" },
];

export interface EeoFieldRule {
  pattern: RegExp;
  field: "gender" | "race" | "veteran" | "disability";
}

export const EEO_FIELD_RULES: EeoFieldRule[] = [
  { pattern: /^gender$|^sex$/i, field: "gender" },
  { pattern: /race|ethnicity/i, field: "race" },
  { pattern: /veteran/i, field: "veteran" },
  { pattern: /disability/i, field: "disability" },
];

export function matchTextRule(label: string): TextFieldRule | null {
  return TEXT_FIELD_RULES.find((r) => r.pattern.test(label)) ?? null;
}

export function matchLegalRule(label: string): LegalFieldRule | null {
  return LEGAL_FIELD_RULES.find((r) => r.pattern.test(label)) ?? null;
}

export function matchEeoRule(label: string): EeoFieldRule | null {
  return EEO_FIELD_RULES.find((r) => r.pattern.test(label)) ?? null;
}
