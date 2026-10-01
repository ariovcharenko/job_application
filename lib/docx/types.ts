// Structured view of a resume, whether it came from a .docx (editable in place) or a .pdf
// (read-only; a tailored copy is rebuilt from a template — see lib/resume/buildDocxTemplate.ts).

/** One bullet under an experience/leadership entry. `id` is the docx paragraph's own w14:paraId
 * when the source is a .docx (stable across edits/saves), or a synthetic id for a PDF source. */
export interface ResumeBullet {
  id: string;
  text: string;
}

/** A skill line as Word shows it, e.g. "Frontend: React, Next.js, Tailwind CSS". `id` is the
 * paragraph's w14:paraId (docx) or a synthetic id (PDF). */
export interface SkillGroup {
  id: string;
  label: string; // "Frontend" ("" if the line has no bold label prefix)
  items: string[];
}

export interface ResumeSection {
  heading: string; // as written, e.g. "EXPERIENCE"
  kind: "experience" | "education" | "skills" | "leadership" | "other";
  /** Plain-text context for this section (job titles, companies, dates, degrees — read-only,
   * given to the AI so it understands the resume but is never asked to edit it). */
  context: string;
  bullets: ResumeBullet[];
  skillGroups: SkillGroup[];
}

export interface ResumeStructure {
  format: "docx" | "pdf";
  /** Header block (name/contact line), read-only, never sent to the AI for editing. */
  headerText: string;
  sections: ResumeSection[];
  /** Full plain-text rendering, for keyword coverage scoring and as classify/tailor context. */
  fullText: string;
}

export function allBullets(structure: ResumeStructure): ResumeBullet[] {
  return structure.sections.flatMap((s) => s.bullets);
}

export function allSkillGroups(structure: ResumeStructure): SkillGroup[] {
  return structure.sections.flatMap((s) => s.skillGroups);
}
