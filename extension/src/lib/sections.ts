// Repeated sections: "Work experience 1, 2, ...", "Education 1, 2, ..." as Workday and others draw
// them. Each existing block is filled from the next role in "Your experience" (her own text,
// verbatim; nothing invented). The extension never clicks "Add": if the page shows fewer blocks
// than she has roles, it says so and she adds a block and clicks Fill again.
import { findFormFields, getFieldLabel, type FillableField } from "./matching";
import { cleanLabel } from "./label";
import { setNativeValue } from "./fillEngine";
import type { FillOutcome, SyncedExperience, SyncedProfile } from "../types";

const WORK_BLOCK = '[data-automation-id^="workExperience-"], [data-automation-id^="workExperienceSection-"]';
const EDU_BLOCK = '[data-automation-id^="education-"], [data-automation-id^="educationSection-"]';

type WorkKey = "title" | "company" | "location" | "description";
const WORK_RULES: { pattern: RegExp; key: WorkKey }[] = [
  { pattern: /job\s*title|position\s*title|^title$/i, key: "title" },
  { pattern: /^(company|employer|organization)\b/i, key: "company" },
  { pattern: /^location$/i, key: "location" },
  { pattern: /description|responsibilit|duties/i, key: "description" },
];
const DATE_LABEL = /^(from|to|start|end)\b|date/i;

type EduKey = "school" | "degree" | "major" | "gpa";
const EDU_RULES: { pattern: RegExp; key: EduKey }[] = [
  { pattern: /school|university|college|institution/i, key: "school" },
  { pattern: /^degree\b/i, key: "degree" },
  { pattern: /field\s*of\s*study|major/i, key: "major" },
  { pattern: /gpa|overall\s*result/i, key: "gpa" },
];

const WORK_SECTION = /experience|employment|work|internship/i;
const NOT_WORK = /project|education|skill|leadership|involvement|volunteer/i;

/** Roles for the page's work blocks: the master profile's experience entries, in the order written. */
export function workRoles(experiences: SyncedExperience[]): SyncedExperience[] {
  return experiences.filter((e) => WORK_SECTION.test(e.section) && !NOT_WORK.test(e.section));
}

function writeIfEmpty(field: FillableField, value: string): boolean {
  if (!value.trim()) return false;
  if (field instanceof HTMLSelectElement) return false;
  if ((field as HTMLInputElement | HTMLTextAreaElement).value.trim()) return false;
  setNativeValue(field as HTMLInputElement | HTMLTextAreaElement, value);
  return true;
}

export interface SectionResult {
  outcomes: FillOutcome[];
  /** Every field inside a section block, so the general pass leaves them alone. */
  handled: Set<Element>;
}

export function fillRepeatedSections(root: ParentNode, profile: SyncedProfile, experiences: SyncedExperience[]): SectionResult {
  const outcomes: FillOutcome[] = [];
  const handled = new Set<Element>();
  const roles = workRoles(experiences);

  const workBlocks = [...root.querySelectorAll<HTMLElement>(WORK_BLOCK)];
  workBlocks.forEach((block, i) => {
    const fields = findFormFields(block);
    fields.forEach((f) => handled.add(f));
    const role = roles[i];
    const where = `Work experience ${i + 1}`;
    if (!role) {
      outcomes.push({ label: where, status: "skipped-no-data", reason: "Your experience has no role for this block. Left for you." });
      return;
    }
    const values: Record<WorkKey, string> = { title: role.title, company: role.company, location: role.location, description: role.bullets.map((b) => `- ${b.replace(/\*\*/g, "")}`).join("\n") };
    for (const f of fields) {
      if (f instanceof HTMLInputElement && (f.type === "checkbox" || f.type === "radio")) continue;
      const label = cleanLabel(getFieldLabel(f));
      if (DATE_LABEL.test(label) && !/description/i.test(label)) {
        outcomes.push({ label: `${where}: ${label}`, status: "skipped-needs-review", reason: `Dates differ by form. Yours: ${role.dates}. Enter them yourself.` });
        continue;
      }
      const rule = WORK_RULES.find((r) => r.pattern.test(label));
      if (!rule) continue;
      const done = writeIfEmpty(f, values[rule.key]);
      outcomes.push(done ? { label: `${where}: ${label}`, status: "filled" } : { label: `${where}: ${label}`, status: "skipped-no-data", reason: "Already has a value or nothing saved." });
    }
  });
  if (roles.length > workBlocks.length && workBlocks.length > 0) {
    outcomes.push({ label: "More work experience", status: "skipped-needs-review", reason: `You have ${roles.length} roles saved and this page shows ${workBlocks.length}. Click Add yourself for more, then Fill again.` });
  }

  const eduBlocks = [...root.querySelectorAll<HTMLElement>(EDU_BLOCK)];
  eduBlocks.forEach((block, i) => {
    const fields = findFormFields(block);
    fields.forEach((f) => handled.add(f));
    const where = `Education ${i + 1}`;
    if (i > 0) {
      outcomes.push({ label: where, status: "skipped-no-data", reason: "Only your Profile's main degree is saved. Left for you." });
      return;
    }
    const values: Record<EduKey, string> = { school: profile.school, degree: profile.degreeType, major: profile.major, gpa: profile.gpa };
    for (const f of fields) {
      if (f instanceof HTMLInputElement && (f.type === "checkbox" || f.type === "radio")) continue;
      const label = cleanLabel(getFieldLabel(f));
      const rule = EDU_RULES.find((r) => r.pattern.test(label));
      if (!rule) continue;
      const done = writeIfEmpty(f, values[rule.key]);
      outcomes.push(done ? { label: `${where}: ${label}`, status: "filled" } : { label: `${where}: ${label}`, status: "skipped-no-data", reason: "Already has a value, a dropdown, or nothing saved." });
    }
  });

  return { outcomes, handled };
}
