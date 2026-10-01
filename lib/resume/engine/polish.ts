import { normalizeSkill } from "../master/skills";
import { TECH_TERMS } from "../master/techTerms";
import { boldSegments } from "./layout";
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

/** Applies all of the above. Returns the polished document and plain notes for the Checks list. */
export function polishResume(doc: ResumeDoc): { doc: ResumeDoc; notes: string[] } {
  let boldCapped = 0;
  const bullet = (b: string) => {
    const r = capBoldSpans(fixTechCasing(b));
    if (r.changed) boldCapped++;
    return r.text;
  };
  const { skills, removed } = dedupeSkills(doc.skills.map((l) => ({ ...l, items: l.items.map(fixTechCasing) })));
  const out: ResumeDoc = {
    ...doc,
    experience: doc.experience.map((e) => ({ ...e, bullets: e.bullets.map(bullet) })),
    education: doc.education.map((e) => ({ ...e, bullets: e.bullets.map(bullet) })),
    skills,
  };
  const notes: string[] = [];
  if (boldCapped) notes.push(`Kept at most ${MAX_BOLD_SPANS} bold spans in ${boldCapped} bullet${boldCapped === 1 ? "" : "s"}.`);
  if (removed) notes.push(`Removed ${removed} duplicate skill${removed === 1 ? "" : "s"}.`);
  return { doc: out, notes };
}
