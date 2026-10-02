import { readBreakdown } from "../intake/stored";
import type { Application } from "../types";
import { jobSkills } from "./coverage";
import { cleanTitle, parseMasterExperiences } from "./master/experiences";
import { appendSkillToMaster, appendUsageNote, hasSkill, isSoftSkill, normalizeSkill, parseSkillInventory, type RoleKey } from "./master/skills";

// The question asked BEFORE tailoring: which of the job's skills that aren't in her experience she
// actually has, and where she used them. Her answers go into the one tailoring call (and into her
// experience, so she's never asked again), instead of a "missing skills" list after the fact.

export interface PreTailorGap {
  skill: string;
  /** From the job's required list (shown first); false = nice to have, or only mentioned. */
  required: boolean;
}

/**
 * The job's skills her experience doesn't show (checked against the experience as it is now, so a
 * skill she confirmed earlier is never asked again): required ones first, then nice-to-have, each
 * once, no soft skills. Uses the saved analysis when there is one, else the skills the posting
 * mentions.
 */
export function preTailorGaps(app: Pick<Application, "fitBreakdown" | "jdText">, master: string): PreTailorGap[] {
  const inventory = parseSkillInventory(master);
  const s = readBreakdown(app)?.skills;
  const required = s ? [...s.required.gap, ...s.required.have] : [];
  const preferred = s ? [...s.preferred.gap, ...s.preferred.have] : [];
  const listed = required.length || preferred.length ? [...required.map((x) => ({ skill: x, required: true })), ...preferred.map((x) => ({ skill: x, required: false }))] : jobSkills(app, master).map((x) => ({ skill: x, required: false }));
  const seen = new Set<string>();
  return listed.filter(({ skill }) => {
    const key = normalizeSkill(skill);
    if (!key || seen.has(key) || isSoftSkill(skill)) return false;
    seen.add(key);
    return !hasSkill(skill, inventory, master);
  });
}

/** A role or project from her experience she can say she used a skill in. */
export interface PlaceChoice {
  key: string;
  label: string;
  role: RoleKey;
}

/** Every role and project in her experience, as places to put a confirmed skill. */
export function placeChoices(master: string): PlaceChoice[] {
  return parseMasterExperiences(master).map((m) => {
    const title = cleanTitle(m.title);
    const project = /project/i.test(m.section);
    return {
      key: `${m.company}|${title}`.toLowerCase(),
      label: project || !title ? m.company : `${m.company} (${title})`,
      role: { company: m.company, title },
    };
  });
}

/** A skill she said she has, and where (null = the skills section only). */
export interface ConfirmedSkill {
  skill: string;
  place: PlaceChoice | null;
  /** Her optional one-line note on how she used it. */
  how: string;
}

/**
 * Her experience with her confirmations saved: each skill on the skills list's "Additional" line
 * (unless already there), and, when she named a role, a usage note tied to that exact role, which
 * lets the validator accept the skill in that role's bullets.
 */
export function applyConfirmations(master: string, confirmed: ConfirmedSkill[]): string {
  let m = master;
  for (const c of confirmed) {
    if (!hasSkill(c.skill, parseSkillInventory(m), m)) m = appendSkillToMaster(m, c.skill);
    if (c.place) m = appendUsageNote(m, c.skill, c.how, c.place.role);
  }
  return m;
}

/** Her confirmations for the tailoring call's user message (prompt.ts buildUserPrompt). */
export function confirmedForPrompt(confirmed: ConfirmedSkill[]): { skill: string; where: string | null; how: string }[] {
  return confirmed.map((c) => ({ skill: c.skill, where: c.place?.label ?? null, how: c.how.trim() }));
}
