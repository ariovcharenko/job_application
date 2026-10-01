import type { AIProvider } from "../ai/provider";
import { applyDocxEdits, type ResumeEdits } from "../docx/apply";
import { parseDocx } from "../docx/parse";
import type { ResumeStructure, SkillGroup } from "../docx/types";
import { saveBaseResume } from "../db";
import type { BaseResume } from "../types";
import { buildDocxTemplate } from "./buildDocxTemplate";
import { parsePdfResume } from "./pdfParse";
import type { TailorResult } from "./tailor";

export function bufferToBase64(bytes: ArrayBuffer): string {
  let binary = "";
  const arr = new Uint8Array(bytes);
  for (let i = 0; i < arr.length; i++) binary += String.fromCharCode(arr[i]);
  return btoa(binary);
}

/** Parses a base resume's structure, free and on demand for .docx, cached after one AI call for
 * .pdf (never re-paid for the same file). */
export async function getResumeStructure(provider: AIProvider, resume: BaseResume): Promise<ResumeStructure> {
  if (resume.format === "docx") return parseDocx(resume.bytes);

  if (resume.structure) return JSON.parse(resume.structure) as ResumeStructure;
  const structure = await parsePdfResume(provider, bufferToBase64(resume.bytes));
  if (resume.id !== undefined) await saveBaseResume({ ...resume, structure: JSON.stringify(structure) });
  return structure;
}

export interface AcceptedTailoring {
  acceptedBulletIds: Set<string>;
  /** Reorders are low-risk (same items, no new claims) and applied whenever present. */
  appliedSkills: { skill: string; evidence: string }[];
}

/** Merges only the accepted edits into the base resume: for .docx, rewrites the original file's
 * own XML in place (see docx/apply.ts) so all other formatting survives untouched. For .pdf,
 * rebuilds a new template docx from the resolved structure (a PDF can't be edited in place). */
export async function applyAcceptedTailoring(
  resume: BaseResume,
  structure: ResumeStructure,
  result: TailorResult,
  accepted: AcceptedTailoring,
): Promise<ArrayBuffer> {
  const acceptedBulletEdits = result.bulletEdits.filter((e) => accepted.acceptedBulletIds.has(e.id));
  const newSkillGroups: { label: string; items: string[] }[] =
    accepted.appliedSkills.length > 0 ? [{ label: "Additional", items: accepted.appliedSkills.map((s) => s.skill) }] : [];

  if (resume.format === "docx") {
    const edits: ResumeEdits = {
      bullets: Object.fromEntries(acceptedBulletEdits.map((e) => [e.id, e.newText])),
      skillGroups: Object.fromEntries(result.skillReorders.map((r) => [r.id, r.items])),
      newSkillGroups,
    };
    return applyDocxEdits(resume.bytes, edits);
  }

  const resolved = mergeIntoStructure(structure, acceptedBulletEdits, result.skillReorders, newSkillGroups);
  return buildDocxTemplate(resolved);
}

function mergeIntoStructure(
  structure: ResumeStructure,
  bulletEdits: { id: string; newText: string }[],
  skillReorders: { id: string; items: string[] }[],
  newSkillGroups: { label: string; items: string[] }[],
): ResumeStructure {
  const bulletTextById = new Map(bulletEdits.map((e) => [e.id, e.newText]));
  const skillItemsById = new Map(skillReorders.map((r) => [r.id, r.items]));

  const sections = structure.sections.map((section, i) => {
    const bullets = section.bullets.map((b) => (bulletTextById.has(b.id) ? { ...b, text: bulletTextById.get(b.id)! } : b));
    const skillGroups: SkillGroup[] = section.skillGroups.map((g) =>
      skillItemsById.has(g.id) ? { ...g, items: skillItemsById.get(g.id)! } : g,
    );
    const isLastSkillsSection = section.kind === "skills" && !structure.sections.slice(i + 1).some((s) => s.kind === "skills");
    if (isLastSkillsSection && newSkillGroups.length > 0) {
      skillGroups.push(...newSkillGroups.map((g, j) => ({ id: `new-${j}`, label: g.label, items: g.items })));
    }
    return { ...section, bullets, skillGroups };
  });

  return { ...structure, sections };
}

/** Longest role slug kept in a file name; longer titles are cut at a word boundary. */
const ROLE_SLUG_MAX = 40;

const fileSlug = (s: string) => s.trim().replace(/[^\p{L}\p{N}]+/gu, "_").replace(/^_+|_+$/g, "");

/** "Alex Rivera" + "Stripe" -> "Alex_Rivera_Resume_Stripe.docx", matching the naming
 * she already used for her tailored resumes (Alex_Rivera_Resume_<Company>.docx). With a role,
 * a short slug of it is added ("..._Google_Software_Engineer.docx") so two roles at the same
 * company don't overwrite each other in her Tailored folder. */
export function tailoredFileName(fullName: string, company: string, role?: string): string {
  const nameSlug = fileSlug(fullName) || "Resume";
  const parts = [`${nameSlug}_Resume`, fileSlug(company), shortRoleSlug(role ?? "")].filter(Boolean);
  return `${parts.join("_")}.docx`;
}

function shortRoleSlug(role: string): string {
  const full = fileSlug(role);
  if (full.length <= ROLE_SLUG_MAX) return full;
  const cut = full.slice(0, ROLE_SLUG_MAX + 1);
  const atWord = cut.lastIndexOf("_");
  return (atWord > 0 ? cut.slice(0, atWord) : full.slice(0, ROLE_SLUG_MAX)).replace(/_+$/, "");
}
