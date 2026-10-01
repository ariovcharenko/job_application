import { hasSkill, normalizeSkill } from "../master/skills";
import { mentionsTerm, TECH_TERMS } from "../master/techTerms";
import { wrapBullet } from "../quality/measure";
import type { JobFocus } from "./focus";
import { boldSegments, PAGE } from "./layout";
import { metricsIn } from "./relevance";
import type { ResumeDoc } from "./schema";

// Mechanical polish applied by code to every generated resume, so these never depend on the
// model following its instructions: at most four bold spans per bullet (numbers kept first), the
// usual spelling of well-known technologies, and no skill listed twice.

export const MAX_BOLD_SPANS = 4;

/** Names whose lowercase form is an ordinary word or that are too short to recase safely. */
const NO_RECASE = new Set(["swift", "excel", "sketch", "framer", "looker", "go", "r", "c", "git", "rest", "ios", "iam"]);

const RECASE: [RegExp, string][] = TECH_TERMS.filter((t) => t.length > 2 && !NO_RECASE.has(t.toLowerCase()) && /[A-Z]/.test(t)).map((t) => [
  new RegExp(`(^|[^A-Za-z0-9+#.])(${t.replace(/[.*+?^${}()|[\]\\]/g, "\\$&")})(?![A-Za-z0-9+#])`, "gi"),
  t,
]);

/**
 * "Javascript" -> "JavaScript", "Postgresql" -> "PostgreSQL", "NODE.JS" -> "Node.js". Only when the
 * text already capitalizes the word (so "react to feedback" is left alone), and only the casing
 * changes: a different name the job uses ("Postgres") is kept.
 */
export function fixTechCasing(text: string): string {
  let out = text;
  for (const [re, canonical] of RECASE) {
    out = out.replace(re, (whole, pre: string, word: string) => {
      if (word === canonical) return whole;
      const capitalized = /^[A-Z]/.test(word);
      return capitalized ? `${pre}${canonical}` : whole;
    });
  }
  return out;
}

/**
 * Keeps at most `max` bold spans in a bullet: spans with a number first, then the rest in reading
 * order. Extra spans stay as plain text.
 */
export function capBoldSpans(text: string, max = MAX_BOLD_SPANS): { text: string; changed: boolean } {
  const segs = boldSegments(text);
  const bold = segs.map((s, i) => ({ s, i })).filter((x) => x.s.bold);
  if (bold.length <= max) return { text, changed: false };
  const keep = new Set(
    [...bold]
      .sort((a, b) => Number(metricsIn(b.s.text).length > 0) - Number(metricsIn(a.s.text).length > 0) || a.i - b.i)
      .slice(0, max)
      .map((x) => x.i),
  );
  const out = segs.map((seg, i) => (seg.bold && keep.has(i) ? `**${seg.text}**` : seg.text)).join("");
  return { text: out, changed: true };
}

/** Removes a skill that already appears on an earlier line (same skill, any spelling). */
export function dedupeSkills(skills: ResumeDoc["skills"]): { skills: ResumeDoc["skills"]; removed: number } {
  const seen = new Set<string>();
  let removed = 0;
  const out = skills
    .map((line) => ({
      ...line,
      items: line.items.filter((item) => {
        const key = normalizeSkill(item);
        if (seen.has(key)) {
          removed++;
          return false;
        }
        seen.add(key);
        return true;
      }),
    }))
    .filter((line) => line.items.length > 0);
  return { skills: out, removed };
}

const ALNUM = /[A-Za-z0-9]/;

/**
 * Bold spans never touch their neighbors without a space: "**Java 17****Spring Boot**" and
 * "**Java 17**Spring" get a space between, so Word doesn't run them together.
 */
export function separateBoldSpans(text: string): string {
  const parts = text.split("**");
  if (parts.length % 2 === 0) return text;
  let out = "";
  let prevBold = false;
  let prevText = "";
  parts.forEach((p, i) => {
    if (p === "") return;
    const bold = i % 2 === 1;
    const touching = prevText !== "" && ALNUM.test(prevText.slice(-1)) && ALNUM.test(p[0]);
    if (prevText !== "" && ((bold && prevBold) || (touching && bold !== prevBold))) out += " ";
    out += bold ? `**${p}**` : p;
    prevBold = bold;
    prevText = p;
  });
  return out;
}

/** True if two bold spans touch, or a bold span runs into a word, with no space between. */
export function boldSpansTouch(text: string): boolean {
  return separateBoldSpans(text) !== text;
}

/**
 * Bold only technologies and numbers: a bold span stays bold if it has a digit, or names a
 * technology (a known one, or one on her skills list). "end-to-end", "Led" and "design system" lose it.
 */
export function boldOnlyTechAndNumbers(text: string, inventory: string[]): { text: string; changed: boolean } {
  let changed = false;
  const out = text.replace(/\*\*(.+?)\*\*/g, (whole, span: string) => {
    const keep = /\d/.test(span) || TECH_TERMS.some((t) => mentionsTerm(span, t)) || inventory.some((i) => i.length > 1 && mentionsTerm(span, i)) || hasSkill(span, inventory, "");
    if (keep) return whole;
    changed = true;
    return span;
  });
  return { text: out, changed };
}

/** Skills lines that aren't skills ("Collaboration", "Soft skills") go; an "Additional"/"Other" line merges into Tools. */
export function tidySkillLines(skills: ResumeDoc["skills"]): { skills: ResumeDoc["skills"]; notes: string[] } {
  const notes: string[] = [];
  let out = skills.filter((l) => {
    const drop = /collaborat|soft\s*skill|interpersonal|communication/i.test(l.category);
    if (drop) notes.push(`Left off the "${l.category}" line (not technical skills).`);
    return !drop;
  });
  const extra = out.filter((l) => /^(additional|other)\b/i.test(l.category.trim()));
  if (extra.length) {
    const items = extra.flatMap((l) => l.items);
    out = out.filter((l) => !extra.includes(l));
    const tools = out.findIndex((l) => /tool/i.test(l.category));
    if (tools >= 0) out = out.map((l, i) => (i === tools ? { ...l, items: [...l.items, ...items] } : l));
    else out = [...out, { category: "Tools", items }];
    notes.push(`Moved the "${extra[0].category}" skills into ${tools >= 0 ? out[tools].category : "Tools"}.`);
  }
  return { skills: out, notes };
}

/** Her rule: 5 to 6 skills lines. */
export const MAX_SKILL_LINES = 6;

/**
 * Skills lines in the order this job cares about (most of the job's skills first, ties keep the
 * model's order), at most MAX_SKILL_LINES (the lines with the fewest of the job's skills go).
 */
export function orderSkillLines(skills: ResumeDoc["skills"], jobSkills: string[], focus?: JobFocus): ResumeDoc["skills"] {
  if (focus) return focusSkillLines(skills, jobSkills, focus);
  const hits = (l: ResumeDoc["skills"][number]) => jobSkills.filter((j) => hasSkill(j, l.items, "")).length;
  const ranked = skills.map((l, i) => ({ l, i, h: hits(l) })).sort((a, b) => b.h - a.h || a.i - b.i);
  return ranked.slice(0, MAX_SKILL_LINES).map((x) => x.l);
}

/**
 * Whether a skills-line item is this job skill: the same skill or a synonym, also counting the parts
 * of "AWS (Lambda, SQS, S3)". A longer name that merely contains it doesn't count ("React Testing
 * Library" isn't React).
 */
export function itemMatches(skill: string, item: string): boolean {
  const m = item.match(/^(.*?)\s*\((.*)\)\s*$/);
  const parts = m ? [m[1], ...m[2].split(",")].map((p) => p.trim()).filter(Boolean) : [item];
  return hasSkill(skill, parts, "");
}

/**
 * The width of a skills line at the default 10pt body: (8.5in - 2 x 0.45in margins) in 1/1000 em,
 * with the same 0.97 safety factor as the bullet estimate (lib/resume/quality/measure.ts).
 */
const SKILL_LINE_UNITS = ((PAGE.widthIn - 2 * PAGE.marginXIn) * 72 / 10) * 1000 * 0.97;

/** Whether "Category: a, b, c" takes more than one line on the page (estimated, no browser). */
export const skillLineWraps = (l: ResumeDoc["skills"][number]) => wrapBullet(`**${l.category}:** ${l.items.join(", ")}`, SKILL_LINE_UNITS).lines.length > 1;

/**
 * Skills lines tailored to the job, by code:
 *  - lines ordered by the job's skills they hold (a must-have counts twice a nice-to-have), ties
 *    keep the model's order;
 *  - within a line, the job's skills first (must-haves in the posting's order, then nice-to-haves,
 *    then any other skill the job names), the rest in their order;
 *  - a line that would wrap to a second line drops items the job doesn't ask for from its end
 *    until it fits one line (never one the job asks for).
 * At most MAX_SKILL_LINES lines.
 */
export function focusSkillLines(skills: ResumeDoc["skills"], jobSkills: string[], focus: JobFocus): ResumeDoc["skills"] {
  const others = jobSkills.filter((j) => ![...focus.must, ...focus.nice].some((x) => x.toLowerCase() === j.toLowerCase()));
  const ranked = [...focus.must.map((s) => ({ s, w: 2 })), ...focus.nice.map((s) => ({ s, w: 1 })), ...others.map((s) => ({ s, w: 1 }))];
  const rankOf = (item: string) => ranked.findIndex((r) => itemMatches(r.s, item));
  const lines = skills.map((l, i) => {
    const hits = ranked.filter((r) => l.items.some((it) => itemMatches(r.s, it)));
    const order = l.items.map((item, k) => ({ item, k, r: rankOf(item) }));
    order.sort((a, b) => (a.r < 0 ? 1e9 : a.r) - (b.r < 0 ? 1e9 : b.r) || a.k - b.k);
    let items = order.map((x) => x.item);
    const matched = new Set(order.filter((x) => x.r >= 0).map((x) => x.item));
    while (items.length > 1 && skillLineWraps({ ...l, items }) && !matched.has(items[items.length - 1])) items = items.slice(0, -1);
    return { line: { ...l, items }, i, w: hits.reduce((s, r) => s + r.w, 0) };
  });
  lines.sort((a, b) => b.w - a.w || a.i - b.i);
  return lines.slice(0, MAX_SKILL_LINES).map((x) => x.line);
}

export interface PolishOptions {
  /** Her skills list, so a bold technology she lists keeps its bold. */
  inventory?: string[];
  /** The job's skills, to order the skills lines. */
  jobSkills?: string[];
  /** What the job is about (focus.ts): weights must-haves and orders items within each line. */
  focus?: JobFocus;
}

/** Applies all of the above. Returns the polished document and plain notes for the Checks list. */
export function polishResume(doc: ResumeDoc, opts: PolishOptions = {}): { doc: ResumeDoc; notes: string[] } {
  let boldCapped = 0;
  let unbolded = 0;
  const inventory = opts.inventory ?? [];
  const bullet = (b: string) => {
    const only = boldOnlyTechAndNumbers(separateBoldSpans(fixTechCasing(b)), inventory);
    if (only.changed) unbolded++;
    const r = capBoldSpans(only.text);
    if (r.changed) boldCapped++;
    return separateBoldSpans(r.text);
  };
  const tidy = tidySkillLines(doc.skills.map((l) => ({ ...l, items: l.items.map(fixTechCasing) })));
  const { skills: deduped, removed } = dedupeSkills(tidy.skills);
  const before = deduped.length;
  const skills = opts.jobSkills || opts.focus ? orderSkillLines(deduped, opts.jobSkills ?? [], opts.focus) : deduped.slice(0, MAX_SKILL_LINES);
  const out: ResumeDoc = {
    ...doc,
    experience: doc.experience.map((e) => ({ ...e, bullets: e.bullets.map(bullet) })),
    ...(doc.projects ? { projects: doc.projects.map((e) => ({ ...e, bullets: e.bullets.map(bullet) })) } : {}),
    education: doc.education.map((e) => ({ ...e, bullets: e.bullets.map(bullet) })),
    skills,
  };
  const notes: string[] = [...tidy.notes];
  if (unbolded) notes.push(`Bold kept only on technologies and numbers in ${unbolded} bullet${unbolded === 1 ? "" : "s"}.`);
  if (boldCapped) notes.push(`Kept at most ${MAX_BOLD_SPANS} bold spans in ${boldCapped} bullet${boldCapped === 1 ? "" : "s"}.`);
  if (removed) notes.push(`Removed ${removed} duplicate skill${removed === 1 ? "" : "s"}.`);
  if (before > skills.length) notes.push(`Kept the ${skills.length} skills lines that matter most for this job.`);
  return { doc: out, notes };
}
