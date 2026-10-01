import type { Target } from "./edit";
import type { ResumeDoc } from "./schema";

// Her own wording for a bullet or a skills line, applied by code with no AI call. Whatever she
// types is re-checked against the master profile afterwards (validateResume), so a new fact she
// writes is flagged and needs her tick like anything else (decision #6).

/** The editable text of a spot: a bullet with its **bold** markers, or a skills line as "a, b, c". */
export function textOfTarget(doc: ResumeDoc, t: Target): string | null {
  if (t.section === "skills") return doc.skills[t.entry]?.items.join(", ") ?? null;
  if ((t.section === "experience" || t.section === "education") && t.bullet !== undefined) {
    return doc[t.section][t.entry]?.bullets[t.bullet] ?? null;
  }
  return null;
}

/** The document with that bullet or skills line replaced by her text. Empty text is a no-op. */
export function editTarget(doc: ResumeDoc, t: Target, text: string): ResumeDoc {
  const value = text.replace(/\s+/g, " ").trim();
  if (!value) return doc;
  if (t.section === "skills") {
    const items = value.split(",").map((s) => s.trim()).filter(Boolean);
    return { ...doc, skills: doc.skills.map((l, i) => (i === t.entry ? { ...l, items } : l)) };
  }
  if ((t.section === "experience" || t.section === "education") && t.bullet !== undefined) {
    const key = t.section;
    const entries = doc[key] as ResumeDoc["experience"] | ResumeDoc["education"];
    return {
      ...doc,
      [key]: entries.map((e, i) => (i === t.entry ? { ...e, bullets: e.bullets.map((b, j) => (j === t.bullet ? value : b)) } : e)),
    };
  }
  return doc;
}
