import { mentionedSkills } from "../intake/analyze";
import { readBreakdown } from "../intake/stored";
import type { Application } from "../types";
import { buildJobFocus, type JobFocus } from "./engine/focus";
import type { ResumeDoc } from "./engine/schema";
import { hasSkill, isSoftSkill, parseSkillInventory } from "./master/skills";

// "How much of what this job asks for is on the page": the job's skills (as analyzed), and the
// share of them a piece of text shows. Replaces raw word overlap, which counted every word in the
// posting ("team", "experience") and gave low, meaningless numbers.

/** The job's technical skills: its required + preferred lists, or the technologies its text mentions. */
export function jobSkills(app: Pick<Application, "fitBreakdown" | "jdText">, masterProfile: string): string[] {
  const s = readBreakdown(app)?.skills;
  const listed = s ? [...s.required.have, ...s.required.gap, ...s.preferred.have, ...s.preferred.gap] : [];
  const skills = listed.length ? listed : (() => {
    const m = app.jdText.trim() ? mentionedSkills(app.jdText, masterProfile) : null;
    return m ? [...m.have, ...m.gap] : [];
  })();
  return [...new Set(skills.filter((x) => !isSoftSkill(x)))];
}

/**
 * What this job is about (engine/focus.ts), from the saved analysis: required skills are the
 * must-haves and preferred ones the nice-to-haves. A job analyzed without skills lists uses the
 * technologies its text mentions as must-haves.
 */
export function jobFocusFor(app: Pick<Application, "fitBreakdown" | "jdText" | "role">, masterProfile: string): JobFocus {
  const s = readBreakdown(app)?.skills;
  const soft = (xs: string[]) => xs.filter((x) => !isSoftSkill(x));
  const must = s ? soft([...s.required.have, ...s.required.gap]) : [];
  const nice = s ? soft([...s.preferred.have, ...s.preferred.gap]) : [];
  return buildJobFocus({ role: app.role, jdText: app.jdText, must: must.length || nice.length ? must : jobSkills(app, masterProfile), nice });
}

/** How many of `skills` a piece of text (one bullet) shows; the fit step's relevance signal. */
export function skillHits(skills: string[], text: string): number {
  return skills.filter((s) => hasSkill(s, [], text)).length;
}

/** 0-100 share of `skills` that `text` shows (whole word, synonyms, short names case-sensitive); null if none. */
export function skillCoverage(skills: string[], text: string): { percent: number; found: string[]; missing: string[] } | null {
  if (skills.length === 0) return null;
  const found = skills.filter((s) => hasSkill(s, [], text));
  const missing = skills.filter((s) => !found.includes(s));
  return { percent: Math.round((found.length / skills.length) * 100), found, missing };
}

/** How ready the page is for the job's key skills, counted by code (never by the model, decision #7). */
export interface SkillReadiness {
  /** The skills counted: the job's required ones, or every job skill when it lists none as required. */
  skills: string[];
  /** On the page anywhere (a bullet or the Skills section). */
  shown: string[];
  /** Named in an experience or project bullet, where a recruiter sees it was used. */
  proven: string[];
  /** In her experience at all (so they could be shown truthfully). */
  inProfile: string[];
}

const bulletText = (doc: ResumeDoc) =>
  [...doc.experience, ...(doc.projects ?? [])].flatMap((e) => e.bullets).map((b) => b.replace(/\*\*/g, "")).join("\n");

export function skillReadiness(doc: ResumeDoc, skills: string[], master: string, pageText: string): SkillReadiness {
  const inventory = parseSkillInventory(master);
  const bullets = bulletText(doc);
  return {
    skills,
    shown: skills.filter((s) => hasSkill(s, [], pageText)),
    proven: skills.filter((s) => hasSkill(s, [], bullets)),
    inProfile: skills.filter((s) => hasSkill(s, inventory, master)),
  };
}
