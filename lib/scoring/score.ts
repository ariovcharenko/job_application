import { UNKNOWN_CANDIDATE, type CandidateFacts } from "../eligibility/candidate";
import { evaluateDegree } from "../eligibility/degree";
import { evaluateExperience } from "../eligibility/experience";
import { normalizeRoleType } from "../eligibility/roles";
import { getGeo, type GeoIndex } from "../geo/index";
import { matchLocation } from "../geo/match";
import type { SkillMatch } from "../resume/master/skills";
import type { Preferences, ScoreWeights } from "../types";
import type { JobSignals } from "./signals";

export type Verdict = "Apply" | "Maybe" | "Skip";

export interface ScoreFactor {
  key: keyof ScoreWeights;
  label: string;
  points: number;
  max: number;
  note: string;
}

export interface ScoreResult {
  /** 0-100, after any deal-breaker cap is applied. This is what gets saved and shown. */
  score: number;
  /** 0-100 before capping, for transparency in the breakdown. */
  rawScore: number;
  verdict: Verdict;
  factors: ScoreFactor[];
  /** Reasons a deal-breaker lowered the score, empty if none applied. */
  cappedBy: string[];
}

const clamp01 = (x: number) => Math.max(0, Math.min(1, x));
const points = (weight: number, frac: number) => Math.round(weight * clamp01(frac));

function sponsorshipFactor(signals: JobSignals, weight: number, candidate: CandidateFacts): ScoreFactor {
  const label = "Work authorization fit";
  if (candidate.sponsorship === "no") return { key: "sponsorship", label, points: weight, max: weight, note: "You don't need sponsorship." };
  const table: Record<JobSignals["visaSignal"], [number, string]> = {
    sponsors: [1, "Posting says it sponsors work visas."],
    "opt-friendly": [0.85, "Posting welcomes OPT/CPT or is E-Verify friendly for students."],
    "no-sponsorship": [0, "Posting rules out sponsorship."],
    unknown: [0.5, "Posting does not say (treated as neutral, not a yes)."],
  };
  const [frac, note] = table[signals.visaSignal];
  return { key: "sponsorship", label, points: points(weight, frac), max: weight, note };
}

function locationFactor(signals: JobSignals, prefs: Preferences, weight: number, geo: GeoIndex | null): ScoreFactor {
  const label = "Location / remote";
  const f = (frac: number, note: string): ScoreFactor => ({ key: "location", label, points: points(weight, frac), max: weight, note });
  if (!prefs.locations.length || !geo) return f(0.5, "No locations chosen yet (treated as neutral).");
  if (signals.workMode === "Unknown") return f(0.5, "Work mode not stated (treated as neutral).");
  if (signals.workMode === "Remote") {
    const m = matchLocation(signals.location, prefs.locations, geo, { remoteJob: true });
    return f(m.status === "pass" ? 1 : m.status === "unknown" ? 0.5 : 0.15, m.detail);
  }
  const m = matchLocation(signals.location, prefs.locations, geo);
  if (m.status === "pass") return f(prefs.workModes.includes(signals.workMode) ? 1 : 0.8, `${signals.workMode}. ${m.detail}`);
  if (m.status === "unknown") return f(0.5, `${signals.workMode}. ${m.detail}`);
  return f(0.15, `${signals.workMode}. ${m.detail}`);
}

function matchFactor(signals: JobSignals, prefs: Preferences, weight: number, required: SkillMatch | null): ScoreFactor {
  const label = "Role and skills match";
  const family = normalizeRoleType(signals.role);
  const roleHit = prefs.targetRoles.some((r) => normalizeRoleType(r) === family || signals.role.toLowerCase().includes(r.toLowerCase()));

  // With a master profile, compare the posting's required skills to the skills she actually has.
  const total = required ? required.have.length + required.gap.length : 0;
  if (required && total > 0) {
    const frac = clamp01(required.have.length / total + (roleHit ? 0.1 : 0));
    const gapNote = required.gap.length ? ` Missing: ${required.gap.join(", ")}.` : "";
    return {
      key: "match",
      label,
      points: points(weight, frac),
      max: weight,
      note: `You have ${required.have.length}/${total} of the required skills.${gapNote}`,
    };
  }

  const skills = [...signals.mustHaveSkills, ...signals.niceToHaveSkills].map((s) => s.toLowerCase());
  const keywords = prefs.keywords.map((k) => k.toLowerCase()).filter(Boolean);

  let frac = 0.5;
  let note = "No keywords set in Preferences to compare against (treated as neutral).";
  if (keywords.length && skills.length) {
    const hits = keywords.filter((k) => skills.some((s) => s.includes(k) || k.includes(s)));
    frac = clamp01(hits.length / keywords.length);
    note = `${hits.length}/${keywords.length} of your keywords appear in the posting's skills.`;
  } else if (keywords.length) {
    note = "The posting listed no specific skills to compare against your keywords.";
  }

  if (roleHit) frac = clamp01(frac + 0.15);

  return { key: "match", label, points: points(weight, frac), max: weight, note };
}

function otherFactor(signals: JobSignals, weight: number): ScoreFactor {
  const hasSalary = signals.salary.trim() !== "";
  return {
    key: "other",
    label: "Company, pay, other",
    points: points(weight, hasSalary ? 1 : 0.5),
    max: weight,
    note: hasSalary ? `Salary listed: ${signals.salary}` : "No salary listed (treated as neutral).",
  };
}

const FRESHNESS_TABLE: Record<JobSignals["freshness"], [number, string]> = {
  within_24h: [1, "Posted within the last 24 hours."],
  within_week: [0.8, "Posted within the last week."],
  older: [0.2, "Posted more than a week ago."],
  unknown: [0.5, "Posting date not stated (treated as neutral)."],
};

function freshnessFactor(signals: JobSignals, weight: number): ScoreFactor {
  const [frac, note] = FRESHNESS_TABLE[signals.freshness];
  return { key: "freshness", label: "Freshness", points: points(weight, frac), max: weight, note };
}

/**
 * Hard caps that only ever lower the score, only when they apply to this candidate (her Profile
 * and Preferences, the same tables as the checklist in criteria.ts) and, where there is one, only
 * when the matching deal-breaker is on.
 */
function dealBreakerCap(signals: JobSignals, prefs: Preferences, candidate: CandidateFacts, geo: GeoIndex | null): { cap: number; reasons: string[] } {
  const reasons: string[] = [];
  let cap = 100;
  const lower = (to: number, reason: string) => {
    cap = Math.min(cap, to);
    reasons.push(reason);
  };
  const { dealBreakers } = prefs;
  const mayNeedSponsorship = candidate.sponsorship !== "no";

  if (dealBreakers.noSponsorship && mayNeedSponsorship && signals.visaSignal === "no-sponsorship") lower(40, "Posting rules out sponsorship.");
  if (dealBreakers.noSponsorship && mayNeedSponsorship && signals.optSignal === "excludes-opt") lower(40, "Rules out OPT or future sponsorship.");

  const level = evaluateExperience(signals, prefs.experienceLevel);
  if (level.status === "fail") lower(50, level.detail);
  const degree = evaluateDegree(signals.degreeRequired, candidate.degreeLevel);
  if (degree.status === "fail") lower(50, degree.detail);

  if (dealBreakers.citizenshipRequired && signals.citizenshipRequired && !candidate.isCitizen) lower(40, "Requires US citizenship.");
  if (dealBreakers.clearanceRequired && signals.clearanceRequired) lower(40, "Requires a security clearance.");
  if (dealBreakers.locationOutsideTargets && (signals.workMode === "Hybrid" || signals.workMode === "On-site") && prefs.locations.length && geo) {
    if (matchLocation(signals.location, prefs.locations, geo).status === "fail") lower(50, "On-site or hybrid outside your locations.");
  }
  return { cap, reasons };
}

/**
 * Turns extracted signals + her preferences and Profile facts into a 0-100 score. Deterministic:
 * the AI never picks the number. `requiredSkills` (the posting's required skills split into have/gap against her
 * master profile) replaces the Preferences-keyword comparison when given.
 */
export function scoreJob(
  signals: JobSignals,
  prefs: Preferences,
  requiredSkills: SkillMatch | null = null,
  candidate: CandidateFacts = UNKNOWN_CANDIDATE,
  geo: GeoIndex | null = getGeo(),
): ScoreResult {
  const factors = [
    sponsorshipFactor(signals, prefs.weights.sponsorship, candidate),
    locationFactor(signals, prefs, prefs.weights.location, geo),
    matchFactor(signals, prefs, prefs.weights.match, requiredSkills),
    otherFactor(signals, prefs.weights.other),
    freshnessFactor(signals, prefs.weights.freshness),
  ];

  // Normalize against however the weights actually sum, so a total other than 100 still yields 0-100.
  const maxTotal = factors.reduce((s, f) => s + f.max, 0) || 1;
  const rawPoints = factors.reduce((s, f) => s + f.points, 0);
  const rawScore = Math.round((rawPoints / maxTotal) * 100);

  const { cap, reasons } = dealBreakerCap(signals, prefs, candidate, geo);
  const score = Math.min(rawScore, cap);

  const maybeFloor = Math.max(0, prefs.applyThreshold - 15);
  const verdict: Verdict = score >= prefs.applyThreshold ? "Apply" : score >= maybeFloor ? "Maybe" : "Skip";

  return { score, rawScore, verdict, factors, cappedBy: reasons };
}
