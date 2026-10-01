import type { Element } from "@xmldom/xmldom";
import type { ResumeSection } from "./types";
import { children, isBulletParagraph, paragraphText, runIsBold } from "./xml";

const SECTION_KIND_PATTERNS: [RegExp, ResumeSection["kind"]][] = [
  [/education/i, "education"],
  [/experience/i, "experience"],
  [/skill/i, "skills"],
  [/leadership|activities|involvement|volunteer/i, "leadership"],
];

export function sectionKind(heading: string): ResumeSection["kind"] {
  for (const [re, kind] of SECTION_KIND_PATTERNS) if (re.test(heading)) return kind;
  return "other";
}

export function allRuns(p: Element): Element[] {
  const runs: Element[] = [];
  const walk = (el: Element) => {
    for (const child of children(el, "r")) runs.push(child);
    for (const hl of children(el, "hyperlink")) runs.push(...children(hl, "r"));
  };
  walk(p);
  return runs;
}

/** A section-heading candidate: its own paragraph, short, bold, and entirely uppercase letters. */
export function isSectionHeading(p: Element): boolean {
  if (isBulletParagraph(p)) return false;
  const text = paragraphText(p).trim().replace(/\s+/g, " ");
  if (!text || text.length > 50) return false;
  if (!/[A-Z]/.test(text)) return false;
  if (text !== text.toUpperCase()) return false; // has any lowercase letter -> not a heading
  if (!/^[A-Z0-9 &/'’,.-]+$/.test(text)) return false;
  return allRuns(p).some(runIsBold);
}

/** For each body paragraph, which section it falls in (null before the first heading), and
 * whether the paragraph is itself that section's heading line. */
export function classifyParagraphs(paragraphs: Element[]): { kind: ResumeSection["kind"] | null; isHeading: boolean }[] {
  let current: ResumeSection["kind"] | null = null;
  return paragraphs.map((p) => {
    if (isSectionHeading(p)) {
      current = sectionKind(paragraphText(p).trim());
      return { kind: current, isHeading: true };
    }
    return { kind: current, isHeading: false };
  });
}
