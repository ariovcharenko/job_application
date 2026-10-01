import type { AIProvider } from "../ai/provider";
import { AIError } from "../ai/provider";
import { dropSoftSkills, matchSkills, normalizeSkill, parseSkillInventory, type SkillMatch } from "../resume/master/skills";
import { mentionsTerm, TECH_TERMS } from "../resume/master/techTerms";
import { evaluateCriteria, type Criterion } from "../scoring/criteria";
import { scoreJob, type ScoreResult } from "../scoring/score";
import { extractJobSignals, type JobSignals } from "../scoring/signals";
import { candidateFacts, UNKNOWN_CANDIDATE, type CandidateFacts } from "../eligibility/candidate";
import { getGeo, loadGeo, type GeoIndex } from "../geo/index";
import type { Preferences, Profile } from "../types";
import { decideApply, skillsMatchPercent, type ApplyDecision, type SkillsMatch } from "./decision";

// Job intake: a link (read server-side by the AI provider's web fetch) or pasted text, turned
// into signals, a deterministic score, the eligibility checklist, her must-have decision and a
// skills-match percentage.

export interface JobAssessment {
  score: ScoreResult;
  criteria: Criterion[];
  requiredSkills: SkillMatch | null;
  /** Null until she adds a master profile. */
  skills: SkillsMatch | null;
  decision: ApplyDecision;
}

export interface JobAnalysis extends JobAssessment {
  url: string;
  jdText: string;
  signals: JobSignals;
}

/**
 * What's stored in Application.fitBreakdown: shown again when the row is reopened. `signals`
 * (saved since v4) lets refreshStoredAnalyses re-assess the job for free when her Profile or
 * Preferences change; older rows only have the checklist.
 */
export type StoredBreakdown = ScoreResult & { criteria?: Criterion[]; skills?: SkillsMatch | null; decision?: ApplyDecision; signals?: JobSignals };

/** Who the job is being assessed for: her Profile (or facts already derived from it) and the place index. */
export interface AssessContext {
  profile?: Pick<Profile, "requiresSponsorship" | "visaStatus" | "degreeType"> | null;
  candidate?: CandidateFacts;
  /** Defaults to the loaded index (lib/geo loadGeo). */
  geo?: GeoIndex | null;
}

export function looksLikeUrl(text: string): boolean {
  return /^https?:\/\/\S+$/i.test(text.trim());
}

/** Phrases nearly every real job description has at least a couple of. */
const POSTING_CUES = [
  /responsibilit/i,
  /qualification/i,
  /requirement/i,
  /what you('|’)ll (do|bring)|you will\b/i,
  /about (the|this) (role|team|job|position)/i,
  /\bexperience (with|in)\b|years of experience/i,
  /\bdegree\b|bachelor/i,
  /\bskills?\b/i,
  /benefits|compensation|salary|pay range/i,
];

/**
 * Whether text reads like a job description rather than a page's shell (navigation, cookie
 * banner, "enable JavaScript"). Sites that load the posting with JavaScript return only the
 * shell to a link reader, and scoring that would give a confident answer about nothing.
 */
export function looksLikeJobPosting(text: string): boolean {
  const words = text.split(/\s+/).filter(Boolean).length;
  const cues = POSTING_CUES.filter((re) => re.test(text)).length;
  return words >= 120 && cues >= 3;
}

export const NOT_A_POSTING_MESSAGE =
  "That page didn't include the job description (the site probably loads it with JavaScript). Open the posting, copy the description, and paste it here.";

export async function readJobPosting(provider: AIProvider, url: string): Promise<string> {
  if (!provider.fetchUrl) throw new AIError("fetch_failed", "This AI provider can't read links. Paste the job description instead.");
  const page = await provider.fetchUrl(url.trim());
  const text = page.title && !page.text.startsWith(page.title) ? `${page.title}\n\n${page.text}` : page.text;
  if (!looksLikeJobPosting(text)) throw new AIError("fetch_failed", NOT_A_POSTING_MESSAGE);
  return text;
}

/** Fewer technologies than this in a posting and a percentage would mean little. */
const MIN_MENTIONED = 3;

/**
 * For a posting with no extracted skills list: the technologies its text mentions (common tech
 * names plus everything in her skills inventory), split into ones she has and doesn't.
 * Null when it mentions too few to judge.
 */
export function mentionedSkills(jdText: string, masterProfile: string): SkillMatch | null {
  const inventory = parseSkillInventory(masterProfile);
  const seen = new Set<string>();
  const found: string[] = [];
  for (const term of [...TECH_TERMS, ...inventory]) {
    const key = normalizeSkill(term);
    if (seen.has(key) || !mentionsTerm(jdText, term)) continue;
    seen.add(key);
    found.push(term);
  }
  if (found.length < MIN_MENTIONED) return null;
  return matchSkills(found, inventory, masterProfile);
}

/** Percentage version of mentionedSkills, or null. */
export function keywordMatch(jdText: string, masterProfile: string): number | null {
  const m = mentionedSkills(jdText, masterProfile);
  return m ? Math.round((m.have.length / (m.have.length + m.gap.length)) * 100) : null;
}

/** A SkillsMatch from the posting's mentioned technologies, or null. */
export function mentionedSkillsMatch(jdText: string, masterProfile: string): SkillsMatch | null {
  const m = mentionedSkills(jdText, masterProfile);
  if (!m) return null;
  return { percent: Math.round((m.have.length / (m.have.length + m.gap.length)) * 100), basis: "mentioned", required: m, preferred: { have: [], gap: [] } };
}

/** Scores already-extracted signals. Pure, so it re-runs for free when she changes a filter. */
export function assessJob(signals: JobSignals, prefs: Preferences, masterProfile: string, jdText = "", ctx: AssessContext = {}): JobAssessment {
  const candidate = ctx.candidate ?? (ctx.profile ? candidateFacts(ctx.profile) : UNKNOWN_CANDIDATE);
  const geo = ctx.geo === undefined ? getGeo() : ctx.geo;
  let requiredSkills: SkillMatch | null = null;
  let skills: SkillsMatch | null = null;
  if (masterProfile.trim()) {
    const inventory = parseSkillInventory(masterProfile);
    // Soft skills ("communication", "attention to detail") are dropped: they aren't skills a
    // resume can show or lack, and would move the percentage either way.
    requiredSkills = dropSoftSkills(matchSkills(signals.mustHaveSkills, inventory, masterProfile));
    skills = skillsMatchPercent(requiredSkills, dropSoftSkills(matchSkills(signals.niceToHaveSkills, inventory, masterProfile)));
    if (skills.percent === null && jdText.trim()) skills = mentionedSkillsMatch(jdText, masterProfile) ?? skills;
  }
  const score = scoreJob(signals, prefs, requiredSkills, candidate, geo);
  const criteria = evaluateCriteria(signals, prefs, requiredSkills, candidate, geo);
  return { score, criteria, requiredSkills, skills, decision: decideApply(criteria, prefs.mustHaves) };
}

export async function analyzeJob(
  provider: AIProvider,
  input: { url: string; jdText: string },
  prefs: Preferences,
  masterProfile: string,
  today: string,
  profile: AssessContext["profile"] = null,
): Promise<JobAnalysis> {
  const jdText = input.jdText.trim() || (await readJobPosting(provider, input.url));
  const [signals, geo] = await Promise.all([extractJobSignals(provider, jdText, today), loadGeo()]);
  return { url: input.url.trim(), jdText, signals, ...assessJob(signals, prefs, masterProfile, jdText, { profile, geo }) };
}

/** What to save in fitBreakdown. Pass the signals (a JobAnalysis has them) so the job can be re-assessed later. */
export function toStoredBreakdown(a: JobAssessment & { signals?: JobSignals }): StoredBreakdown {
  return { ...a.score, criteria: a.criteria, skills: a.skills, decision: a.decision, ...(a.signals ? { signals: a.signals } : {}) };
}
