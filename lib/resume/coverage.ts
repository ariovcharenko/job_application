import { mentionedSkills } from "../intake/analyze";
import { readBreakdown } from "../intake/stored";
import type { Application } from "../types";
import { buildJobFocus, type JobFocus } from "./engine/focus";
import { hasSkill, isSoftSkill } from "./master/skills";

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
