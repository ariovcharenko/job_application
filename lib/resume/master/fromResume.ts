import { z } from "zod";
import type { AIProvider, JsonSchema } from "../../ai/provider";
import { getProfile, saveMasterProfile, saveProfile } from "../../db";
import type { Profile } from "../../types";
import { parseMasterExperiences } from "./experiences";
import type { ResumeSource } from "./extractText";
import { parseSkillInventory } from "./skills";

// "Import from my resume": one smart-model call turns her own resume into "Your experience" (the
// master profile the tailoring engine draws from), in the exact shape the parsers read. Nothing is
// saved here except by saveImport, which the review screen calls only on "Use this".
//
// Cost: the prompt is ~1.2k tokens; a 1 to 2 page resume is ~1.5k to 3k tokens as text, or ~3k to
// 6k as a PDF (text plus page images). The answer re-types the whole resume as JSON, ~2k to 4k
// output tokens, plus some thinking at medium effort. At Sonnet-class prices ($2-3 in, $10-15 out
// per million) that is roughly 3.5 to 8 cents, shown as "about 4 to 8¢".

export const IMPORT_COST_HINT = "about 4 to 8¢, one call";

/** Resume text beyond this is cut; a real resume is far shorter. */
const SOURCE_CHAR_LIMIT = 60000;
/** Room for adaptive thinking plus a long resume re-typed as JSON. */
const IMPORT_MAX_TOKENS = 16000;

/**
 * The Profile fields an import may offer to fill. Work authorization, sponsorship, visa status and
 * EEO answers are deliberately absent: those come only from what she enters herself (decision #4).
 */
export const CONTACT_FIELDS = [
  { key: "fullName", label: "Name" },
  { key: "email", label: "Email" },
  { key: "phone", label: "Phone" },
  { key: "location", label: "Location" },
  { key: "linkedin", label: "LinkedIn" },
  { key: "github", label: "GitHub" },
  { key: "portfolio", label: "Portfolio" },
  { key: "school", label: "School" },
  { key: "degreeType", label: "Degree" },
  { key: "major", label: "Major" },
  { key: "graduation", label: "Graduation" },
] as const satisfies readonly { key: keyof Profile; label: string }[];

export type ContactField = (typeof CONTACT_FIELDS)[number]["key"];
export type ImportedContact = Record<ContactField, string>;

export interface ImportResult {
  masterProfile: string;
  contact: ImportedContact;
}

const CONTACT_KEYS = CONTACT_FIELDS.map((f) => f.key);

const IMPORT_JSON_SCHEMA: JsonSchema = {
  type: "object",
  additionalProperties: false,
  required: ["masterProfile", "contact"],
  properties: {
    masterProfile: { type: "string" },
    contact: {
      type: "object",
      additionalProperties: false,
      required: CONTACT_KEYS,
      properties: Object.fromEntries(CONTACT_KEYS.map((k) => [k, { type: "string" }])),
    },
  },
};

const ImportSchema = z.object({
  masterProfile: z.string(),
  contact: z.object(Object.fromEntries(CONTACT_KEYS.map((k) => [k, z.string()])) as Record<ContactField, z.ZodString>),
});

export const IMPORT_SYSTEM_PROMPT = `You transcribe a person's own resume into their "experience" document for a resume tailoring app. Tailoring later picks and rewords from this document only, so it must be a faithful copy.

## Transcribe, don't improve
- Copy every bullet verbatim, in its original order. Only rejoin words split across lines and fix stray spacing.
- Keep every number exactly as written (80+, ~35%, $1.2M, p95, 3.85). Never round, convert, add or drop a number.
- Never add, merge, split, shorten, reword or drop a bullet, role, skill, employer, title, date or metric. Do not fix grammar or style.
- If something is unclear, copy it as it appears.

## Never include (even if the resume states it)
Work authorization, visa status, sponsorship needs, citizenship, gender, race or ethnicity, veteran status, disability, age or date of birth, photos. The app asks for those separately.

## masterProfile format (Markdown; code parses these exact shapes)
Leave out the name and contact header; those go in "contact". Then, using only sections the resume has:

### Education
**School name**, City, ST
Degree, Major, Minor | Mon YYYY - Mon YYYY
- Any lines listed under the degree (coursework, honors, GPA), copied as bullets

### Experience
**Title | Company | City, ST | Mon YYYY - Mon YYYY**
- Bullet copied verbatim
- Bullet copied verbatim

### Projects
**Role or project type | Project name | Mon YYYY - Mon YYYY**
- Bullet copied verbatim

### Skills inventory
- **Category:** Skill, Skill, Skill

### Leadership & Involvement
- Entry copied verbatim | Mon YYYY - Mon YYYY

Rules for the shapes:
- Every role and project heading is one bold line with parts separated by " | ", and has at least three parts. Leave out the location part if the resume gives none. If it has no dates, use its location or the word "Project" as the last part; never invent dates.
- Dates use three-letter months (Jan, Feb, Mar, Apr, May, Jun, Jul, Aug, Sep, Oct, Nov, Dec), a spaced hyphen between start and end, and "Present" for a current role. If the resume only gives years, keep only years.
- Use a plain hyphen ("-"), never an en dash or em dash, in headings and dates.
- Skills: keep the resume's own categories and skills in their order. If the resume has no skills section, add "- **From my experience:**" listing only tools, languages and methods named in the resume's own text.
- Any other section (Certifications, Awards, Publications, Volunteering) goes under its own "### Heading" with its lines copied as bullets.

## contact
Copy from the resume's header and education; use "" for anything not shown. fullName, email, phone, location (City, ST) as written. linkedin, github, portfolio: full URLs, taken from the text or from "[links: ...]" notes; "" if only a label with no address is shown. school, degreeType (e.g. "Bachelor of Science"), major: the most recent degree. graduation: that degree's end or expected date as YYYY-MM ("" if no month and year are given).`;

export function buildImportPrompt(source: ResumeSource): string {
  if (source.kind === "pdf") return "The resume is the attached PDF. Transcribe it following every rule in the system prompt.";
  const from = source.origin === "docx" ? "a Word file" : source.origin === "txt" ? "a text file" : "pasted text";
  return `The resume, extracted from ${from}:
"""
${source.text.slice(0, SOURCE_CHAR_LIMIT)}
"""

Transcribe it following every rule in the system prompt.`;
}

/** One smart-model call. Returns the draft for review; saves nothing. */
export async function importResume(provider: AIProvider, source: ResumeSource): Promise<ImportResult> {
  const raw = await provider.completeJson({
    tier: "smart",
    effort: "medium",
    maxTokens: IMPORT_MAX_TOKENS,
    system: IMPORT_SYSTEM_PROMPT,
    prompt: buildImportPrompt(source),
    attachments: source.kind === "pdf" ? [{ mediaType: "application/pdf", base64: source.base64 }] : undefined,
    schema: IMPORT_JSON_SCHEMA,
    parse: (r) => ImportSchema.parse(r),
  });
  return {
    masterProfile: cleanMasterText(raw.masterProfile),
    contact: normalizeContact(raw.contact as ImportedContact),
  };
}

/** Line endings, dash styles in headings/dates and trailing space; never the words themselves. */
export function cleanMasterText(text: string): string {
  return text
    .replace(/\r\n?/g, "\n")
    .split("\n")
    .map((l) => l.replace(/\s+$/, ""))
    .map((l) => (/^\*\*.*\*\*$/.test(l.trim()) ? l.replace(/\s*[–—]\s*/g, " - ") : l))
    .join("\n")
    .replace(/\n{3,}/g, "\n\n")
    .trim();
}

const MONTHS = ["jan", "feb", "mar", "apr", "may", "jun", "jul", "aug", "sep", "oct", "nov", "dec"];

/** "2026-06", "June 2026", "06/2026" -> "2026-06"; anything else -> "". */
export function normalizeGraduation(value: string): string {
  const v = value.trim().toLowerCase();
  let m = v.match(/^(\d{4})-(\d{1,2})$/);
  if (m) return Number(m[2]) >= 1 && Number(m[2]) <= 12 ? `${m[1]}-${m[2].padStart(2, "0")}` : "";
  m = v.match(/^(\d{1,2})\/(\d{4})$/);
  if (m) return Number(m[1]) >= 1 && Number(m[1]) <= 12 ? `${m[2]}-${m[1].padStart(2, "0")}` : "";
  m = v.match(/^([a-z]{3})[a-z]*\.?\s+(\d{4})$/);
  if (m && MONTHS.includes(m[1])) return `${m[2]}-${String(MONTHS.indexOf(m[1]) + 1).padStart(2, "0")}`;
  return "";
}

/** Maps the resume's wording onto the Profile's degree choices (lib/options.ts DEGREE_TYPES). */
export function normalizeDegree(value: string): string {
  const v = value.toLowerCase();
  if (!v.trim()) return "";
  if (/ph\.?\s?d|doctor/.test(v)) return "Doctorate (Ph.D.)";
  if (/\bmba\b|business administration/.test(v) && /master|\bmba\b/.test(v)) return "Master of Business Administration (MBA)";
  if (/master|\bm\.?s\.?\b|\bm\.?sc\b|\bm\.?eng\b/.test(v)) return /science|\bm\.?s\.?\b|\bm\.?sc\b/.test(v) ? "Master of Science (M.S.)" : "Master's degree";
  if (/associate|\ba\.?a\.?s?\b/.test(v)) return "Associate degree";
  if (/bachelor|\bb\.?[sae]\.?\b|\bb\.?sc\b|\bb\.?eng\b/.test(v)) {
    if (/science|\bb\.?s\.?\b|\bb\.?sc\b/.test(v)) return "Bachelor of Science (B.S.)";
    if (/\barts\b|\bb\.?a\.?\b/.test(v)) return "Bachelor of Arts (B.A.)";
    if (/engineering|\bb\.?e\.?\b|\bb\.?eng\b/.test(v)) return "Bachelor of Engineering (B.E.)";
    return "Bachelor's degree";
  }
  return "";
}

const withScheme = (url: string) => (!url || /^https?:\/\//i.test(url) ? url : `https://${url}`);

export function normalizeContact(c: ImportedContact): ImportedContact {
  const out = Object.fromEntries(CONTACT_KEYS.map((k) => [k, (c[k] ?? "").trim()])) as ImportedContact;
  out.email = out.email.replace(/^mailto:/i, "");
  out.linkedin = withScheme(out.linkedin);
  out.github = withScheme(out.github);
  out.portfolio = withScheme(out.portfolio);
  out.graduation = normalizeGraduation(out.graduation);
  out.degreeType = normalizeDegree(out.degreeType);
  return out;
}

// ---------------------------------------------------------------------------------------------
// Checks on the draft (run live as she edits it on the review screen)

/** "1,200" -> "1200", "4.00" -> "4", "05" -> "5"; version-like "1.2.3" stays as written. */
function normalizeNumber(n: string): string {
  const plain = n.replace(/,(?=\d{3}\b)/g, "");
  const value = Number(plain);
  return Number.isFinite(value) ? String(value) : plain;
}

const NUMBER = /\d+(?:[.,]\d+)*/g;

export function numbersIn(text: string): string[] {
  return (text.match(NUMBER) ?? []).map(normalizeNumber);
}

export interface NumberMismatch {
  number: string;
  /** 1-based line in the draft. */
  line: number;
  text: string;
}

/** Numbers in the draft that the original text doesn't have (so it can't have been transcribed). */
export function numbersNotInSource(draft: string, source: string): NumberMismatch[] {
  const known = new Set(numbersIn(source));
  const out: NumberMismatch[] = [];
  draft.split("\n").forEach((text, i) => {
    for (const raw of text.match(NUMBER) ?? []) {
      if (!known.has(normalizeNumber(raw))) out.push({ number: raw, line: i + 1, text: text.trim() });
    }
  });
  return out;
}

/** Lines about legal or identity status, which belong only in Profile answers. */
const LEGAL_LINE = /\b(visa|sponsorship|work authori[sz]ation|authorized to work|citizenship|us citizen|green card|permanent resident|h-?1b|f-1 (?:visa|student|opt)|gender|ethnicity|veteran status|disability)\b/i;

export interface ImportCheck {
  roles: number;
  skills: number;
  /** "We couldn't find ..." messages; "Use this" waits until these are fixed. */
  missing: string[];
  /** Null when there is no text to compare with (a PDF): she compares it by eye instead. */
  numbers: NumberMismatch[] | null;
  legalLines: { line: number; text: string }[];
}

export function checkImport(draft: string, sourceText: string | null): ImportCheck {
  const roles = parseMasterExperiences(draft).length;
  const skills = parseSkillInventory(draft).length;
  const missing: string[] = [];
  if (roles === 0) {
    missing.push('We couldn\'t find any roles. Add one below as a bold line like **Title | Company | City, ST | Jan 2024 - Present** under "### Experience".');
  }
  if (skills === 0) {
    missing.push('We couldn\'t find any skills. Add them below under "### Skills inventory" as lines like - **Languages:** Python, SQL.');
  }
  const legalLines: ImportCheck["legalLines"] = [];
  draft.split("\n").forEach((text, i) => {
    if (LEGAL_LINE.test(text)) legalLines.push({ line: i + 1, text: text.trim() });
  });
  return { roles, skills, missing, numbers: sourceText === null ? null : numbersNotInSource(draft, sourceText), legalLines };
}

// ---------------------------------------------------------------------------------------------
// Contact checklist and saving

export interface ContactOffer {
  key: ContactField;
  label: string;
  value: string;
}

/** Contact details from the resume for Profile fields that are still EMPTY. Filled ones are never offered. */
export function contactOffers(profile: Profile, contact: ImportedContact): ContactOffer[] {
  return CONTACT_FIELDS.filter((f) => !String(profile[f.key] ?? "").trim() && contact[f.key]?.trim()).map((f) => ({
    key: f.key,
    label: f.label,
    value: contact[f.key].trim(),
  }));
}

/**
 * "Use this": saves the experience text, and fills only the ticked contact fields that are still
 * empty in the Profile (re-read now, so nothing she typed meanwhile is overwritten). Never touches
 * any other Profile field.
 */
export async function saveImport(masterProfile: string, contact: ImportedContact, fields: ContactField[]): Promise<void> {
  const allowed = new Set<ContactField>(CONTACT_KEYS);
  const profile = await getProfile();
  const next: Profile = { ...profile };
  let changed = false;
  for (const key of fields) {
    if (!allowed.has(key) || String(profile[key] ?? "").trim()) continue;
    const value = contact[key]?.trim();
    if (!value) continue;
    next[key] = value;
    changed = true;
  }
  await saveMasterProfile(masterProfile.trim());
  if (changed) await saveProfile(next);
}
