import { z } from "zod";
import type { AIProvider, JsonSchema } from "../ai/provider";
import { allBullets, allSkillGroups, type ResumeStructure } from "../docx/types";

export interface TailorResult {
  /** One entry per bullet that changed. Bullets not listed are left exactly as they were. */
  bulletEdits: { id: string; newText: string }[];
  /** One entry per skill group whose item order changed — same items, reordered only. */
  skillReorders: { id: string; items: string[] }[];
  /** JD keywords not present anywhere in the resume. Never applied automatically — the review
   * screen shows these unchecked and only ticked ones get written in. */
  suggestedSkills: { skill: string; evidence: string }[];
}

const RawTailorSchema = z.object({
  bulletEdits: z.array(z.object({ id: z.string(), newText: z.string() })),
  skillReorders: z.array(z.object({ id: z.string(), items: z.array(z.string()) })),
  suggestedSkills: z.array(z.object({ skill: z.string(), evidence: z.string() })),
});
type RawTailorResult = z.infer<typeof RawTailorSchema>;

const TAILOR_JSON_SCHEMA: JsonSchema = {
  type: "object",
  additionalProperties: false,
  required: ["bulletEdits", "skillReorders", "suggestedSkills"],
  properties: {
    bulletEdits: {
      type: "array",
      description:
        "Only bullets whose wording you changed to align with the job posting's language and keywords. Omit bullets you left as-is. Never change a bullet's facts, metrics, employer, dates, or add/remove/merge bullets — only rephrase or reorder the wording within the same bullet.",
      items: {
        type: "object",
        additionalProperties: false,
        required: ["id", "newText"],
        properties: { id: { type: "string" }, newText: { type: "string" } },
      },
    },
    skillReorders: {
      type: "array",
      description:
        "Only skill groups whose item order you changed to put JD-relevant items first. The items array must contain exactly the same items as given (same set, only reordered) — never add, remove, or reword an item here.",
      items: {
        type: "object",
        additionalProperties: false,
        required: ["id", "items"],
        properties: { id: { type: "string" }, items: { type: "array", items: { type: "string" } } },
      },
    },
    suggestedSkills: {
      type: "array",
      description:
        "Up to 8 skills or technologies the job posting asks for that are not anywhere in this resume. Only from the job posting's own text. Each needs the exact phrase from the posting as evidence.",
      items: {
        type: "object",
        additionalProperties: false,
        required: ["skill", "evidence"],
        properties: { skill: { type: "string" }, evidence: { type: "string" } },
      },
    },
  },
};

/** Limits shared with the cost estimate in batch.ts, so the estimate tracks the real call. */
export const TAILOR_MAX_TOKENS = 4000;
export const TAILOR_JD_CHAR_LIMIT = 20000;

const SYSTEM_PROMPT = `You tailor a resume's wording to a specific job posting, to help it read as a stronger match. You are given the resume's bullets and skill lines by id, plus read-only context (titles, companies, dates, education) for background only — you cannot see or touch that context.

Strict rules:
- Rephrase, reorder emphasis within, or tighten a bullet's wording to use the job posting's own terms where truthfully applicable. Never invent or alter a fact: no new employers, titles, dates, metrics, numbers, or claims not already in the bullet. If a bullet already fits well, leave it out of bulletEdits entirely.
- skillReorders may only reorder each group's existing items, never add, remove, or reword one.
- New skills the resume doesn't have go only in suggestedSkills, quoting the job posting's own phrase as evidence. Never insert them into a bullet or skill group yourself.
- Keep each bullet to roughly its original length — this resume needs to still fit on one page.`;

/** Fixed prompt text sent on every tailoring call (system prompt + output schema), in characters. */
export const TAILOR_FIXED_PROMPT_CHARS = SYSTEM_PROMPT.length + JSON.stringify(TAILOR_JSON_SCHEMA).length;

/** Tailors a resume's bullets and skill emphasis to a job description with the "smart" model.
 * Structurally cannot touch anything outside `bulletEdits`/`skillReorders`/`suggestedSkills` —
 * company names, titles, dates and education are never part of the writable schema. */
export async function tailorResume(provider: AIProvider, jdText: string, structure: ResumeStructure): Promise<TailorResult> {
  const bullets = allBullets(structure);
  const skillGroups = allSkillGroups(structure);

  const bulletsBlock = bullets.map((b) => `[${b.id}] ${b.text}`).join("\n");
  const skillsBlock = skillGroups.map((g) => `[${g.id}] ${g.label ? `${g.label}: ` : ""}${g.items.join(", ")}`).join("\n");

  const raw = await provider.completeJson<RawTailorResult>({
    tier: "smart",
    maxTokens: TAILOR_MAX_TOKENS,
    system: SYSTEM_PROMPT,
    cacheSystem: true,
    prompt: `Job posting:\n"""\n${jdText.trim().slice(0, TAILOR_JD_CHAR_LIMIT)}\n"""\n\nResume bullets (by id):\n${bulletsBlock}\n\nResume skill groups (by id):\n${skillsBlock}\n\nResume context (read-only, do not edit):\n${structure.sections.map((s) => s.context).filter(Boolean).join("\n")}`,
    schema: TAILOR_JSON_SCHEMA,
    parse: (r) => RawTailorSchema.parse(r),
  });

  return validateTailorResult(structure, raw);
}

/** Drops anything the model returned that doesn't correspond to a real, unmodified bullet/skill
 * id, or that isn't a same-set reorder of a skill group's items — the actual enforcement of "no
 * invented facts" happens here, not by trusting the model's schema compliance. Exported so this
 * can be unit-tested without an AI call. */
export function validateTailorResult(structure: ResumeStructure, raw: RawTailorResult): TailorResult {
  const bulletsById = new Map(allBullets(structure).map((b) => [b.id, b]));
  const skillGroupsById = new Map(allSkillGroups(structure).map((g) => [g.id, g]));

  const bulletEdits = raw.bulletEdits.filter((e) => bulletsById.has(e.id) && e.newText.trim().length > 0);

  const skillReorders = raw.skillReorders.filter((r) => {
    const original = skillGroupsById.get(r.id);
    if (!original) return false;
    return sameMultiset(original.items, r.items);
  });

  const existingSkillTexts = new Set([...skillGroupsById.values()].flatMap((g) => g.items.map((i) => i.toLowerCase())));
  const suggestedSkills = raw.suggestedSkills
    .filter((s) => s.skill.trim().length > 0 && !existingSkillTexts.has(s.skill.trim().toLowerCase()))
    .slice(0, 8);

  return { bulletEdits, skillReorders, suggestedSkills };
}

function sameMultiset(a: string[], b: string[]): boolean {
  if (a.length !== b.length) return false;
  const norm = (arr: string[]) => [...arr].map((s) => s.trim().toLowerCase()).sort();
  const na = norm(a);
  const nb = norm(b);
  return na.every((v, i) => v === nb[i]);
}
