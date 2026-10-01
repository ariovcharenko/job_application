import type { JobSignals } from "../scoring/signals";
import type { ExperienceLevel } from "../types";

// "Matches my experience level": the posting's years and seniority against the level she chose
// in Preferences. One table drives both the checklist (criteria.ts) and the score cap (score.ts).

export type LevelStatus = "pass" | "fail" | "unknown";

export interface LevelCheck {
  status: LevelStatus;
  detail: string;
}

export const EXPERIENCE_LEVEL_OPTIONS: { value: ExperienceLevel; label: string }[] = [
  { value: "", label: "Choose your level" },
  { value: "internship", label: "Internship or co-op" },
  { value: "new-grad", label: "New grad (0 to 1 years)" },
  { value: "early", label: "Early career (1 to 3 years)" },
  { value: "mid", label: "Mid-level (3 to 6 years)" },
  { value: "senior", label: "Senior (6+ years)" },
];

interface LevelRule {
  /** Years asked for at or below this pass. */
  passMax: number;
  /** Above passMax and at or below this: unclear. Above: fail. */
  unknownMax: number;
  /** Titles above this level (fail). */
  titleFail: RegExp | null;
  /** Titles that might be above this level (unclear). */
  titleUnknown: RegExp | null;
  /** A "new grad / entry level" posting with no years stated. */
  entryLevel: LevelStatus;
}

export const LEVEL_RULES: Record<Exclude<ExperienceLevel, "" | "internship">, LevelRule> = {
  "new-grad": { passMax: 1, unknownMax: 2, titleFail: /\b(senior|sr|staff|principal|lead)\b/i, titleUnknown: null, entryLevel: "pass" },
  early: { passMax: 3, unknownMax: 4, titleFail: /\b(staff|principal)\b/i, titleUnknown: /\b(senior|sr|lead)\b/i, entryLevel: "pass" },
  mid: { passMax: 6, unknownMax: 7, titleFail: null, titleUnknown: /\b(principal|staff)\b/i, entryLevel: "unknown" },
  senior: { passMax: Infinity, unknownMax: Infinity, titleFail: null, titleUnknown: null, entryLevel: "pass" },
};

const INTERNSHIP = /\bintern(ship)?s?\b|\bco-?op\b/i;
const SENIOR_TITLE = /\b(senior|sr|staff|principal|lead)\b/i;
const ENTRY = /new grad|entry|junior|early career|university|graduate|\bassociate\b/i;

export const isInternship = (s: Pick<JobSignals, "role" | "seniority">) => INTERNSHIP.test(`${s.role} ${s.seniority}`);

const titleOf = (s: Pick<JobSignals, "role" | "seniority">) => s.seniority || s.role;
const yearsText = (y: number) => `${y} year${y === 1 ? "" : "s"}`;
const WORST: LevelStatus[] = ["fail", "unknown", "pass"];
const worst = (checks: LevelCheck[]) => WORST.map((st) => checks.find((c) => c.status === st)).find(Boolean)!;

export function evaluateExperience(s: Pick<JobSignals, "role" | "seniority" | "minYearsExperience">, level: ExperienceLevel): LevelCheck {
  const text = `${s.role} ${s.seniority}`;
  const years = s.minYearsExperience;
  if (!level) return { status: "unknown", detail: "Set your experience level in Preferences to check this." };

  if (level === "internship") {
    const senior = text.match(SENIOR_TITLE);
    if (senior) return { status: "fail", detail: `A ${senior[1].toLowerCase()} role (${titleOf(s)}), not an internship.` };
    if (isInternship(s)) return { status: "pass", detail: "An internship." };
    if (years >= 1) return { status: "fail", detail: `Asks for ${yearsText(years)}+ of experience.` };
    if (years === 0) return { status: "pass", detail: "Open to people with no experience." };
    return { status: "unknown", detail: "Not an internship, and years of experience not stated." };
  }

  if (isInternship(s)) return { status: "fail", detail: "It's an internship." };
  const rule = LEVEL_RULES[level];
  const checks: LevelCheck[] = [];

  const failTitle = rule.titleFail && text.match(rule.titleFail);
  if (failTitle) checks.push({ status: "fail", detail: `A ${failTitle[1].toLowerCase()} role (${titleOf(s)}), above your level.` });

  if (years >= 0) {
    if (years > rule.unknownMax) checks.push({ status: "fail", detail: `Asks for ${yearsText(years)}+ of experience.` });
    else if (years > rule.passMax) checks.push({ status: "unknown", detail: `Asks for ${yearsText(years)}, a stretch for your level.` });
    else checks.push({ status: "pass", detail: years === 0 ? "Open to new grads." : `Asks for ${yearsText(years)}.` });
  }

  const unsureTitle = rule.titleUnknown && text.match(rule.titleUnknown);
  if (unsureTitle) checks.push({ status: "unknown", detail: `A ${unsureTitle[1].toLowerCase()} role (${titleOf(s)}). Check that it suits your level.` });

  if (years < 0 && !failTitle && !unsureTitle) {
    if (level === "senior") checks.push({ status: "pass", detail: "Years of experience not stated." });
    else if (ENTRY.test(text)) {
      checks.push(
        rule.entryLevel === "pass"
          ? { status: "pass", detail: `${s.seniority || "Entry-level"} role.` }
          : { status: "unknown", detail: `${s.seniority || "An entry-level"} role, which may be below your level.` },
      );
    } else checks.push({ status: "unknown", detail: "Years of experience not stated." });
  }
  return worst(checks);
}
