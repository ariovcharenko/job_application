import type { Element } from "@xmldom/xmldom";
import JSZip from "jszip";
import { allRuns, isSectionHeading, sectionKind } from "./sections";
import type { ResumeBullet, ResumeSection, ResumeStructure, SkillGroup } from "./types";
import { bodyParagraphs, isBulletParagraph, paraId, paragraphText, parseXml, runIsBold } from "./xml";

const DOCUMENT_XML_PATH = "word/document.xml";

/** "Frontend: React, Next.js" -> { label: "Frontend", items: ["React", "Next.js"] }. Requires the
 * text up to the colon to be bold, matching how the user's skills lines are actually formatted. */
function parseSkillLine(p: Element): { label: string; items: string[] } | null {
  const text = paragraphText(p).trim();
  const m = /^([A-Za-z0-9 /&+.-]{2,40}):\s*(.+)$/.exec(text);
  if (!m) return null;
  const runs = allRuns(p);
  const firstRun = runs[0];
  if (!firstRun || !runIsBold(firstRun)) return null;
  const items = m[2]
    .split(",")
    .map((s) => s.trim())
    .filter(Boolean);
  if (items.length === 0) return null;
  return { label: m[1].trim(), items };
}

/** Reads a .docx into its structured sections. Never inspects header formatting beyond plain
 * text — the header (name/contact/hyperlinks) is treated as opaque and is never rewritten. */
export async function parseDocx(bytes: ArrayBuffer): Promise<ResumeStructure> {
  const zip = await JSZip.loadAsync(bytes);
  const documentXmlFile = zip.file(DOCUMENT_XML_PATH);
  if (!documentXmlFile) throw new Error("Not a valid .docx: missing word/document.xml");
  const xml = await documentXmlFile.async("string");
  const doc = parseXml(xml);
  const paragraphs = bodyParagraphs(doc);

  const headerLines: string[] = [];
  const sections: ResumeSection[] = [];
  let current: ResumeSection | null = null;
  let localIdx = 0;

  for (const p of paragraphs) {
    if (isSectionHeading(p)) {
      const heading = paragraphText(p).trim().replace(/\s+/g, " ");
      current = { heading, kind: sectionKind(heading), bullets: [], skillGroups: [], context: "" };
      sections.push(current);
      localIdx = 0;
      continue;
    }
    const text = paragraphText(p).trim();
    if (!current) {
      if (text) headerLines.push(text);
      continue;
    }
    localIdx++;
    if (isBulletParagraph(p)) {
      if (!text) continue;
      const id = paraId(p) || `docx-${sections.length}-${localIdx}`;
      current.bullets.push({ id, text });
      continue;
    }
    if (!text) continue;
    if (current.kind === "skills") {
      const parsed = parseSkillLine(p);
      if (parsed) {
        const id = paraId(p) || `docx-${sections.length}-${localIdx}`;
        current.skillGroups.push({ id, label: parsed.label, items: parsed.items });
        continue;
      }
    }
    current.context = current.context ? `${current.context}\n${text}` : text;
  }

  const headerText = headerLines.join("\n");
  const fullText = renderFullText(headerText, sections);
  return { format: "docx", headerText, sections, fullText };
}

function renderFullText(headerText: string, sections: ResumeSection[]): string {
  const parts = [headerText];
  for (const s of sections) {
    parts.push(s.heading);
    if (s.context) parts.push(s.context);
    for (const b of s.bullets) parts.push(`- ${b.text}`);
    for (const g of s.skillGroups) parts.push(g.label ? `${g.label}: ${g.items.join(", ")}` : g.items.join(", "));
  }
  return parts.filter(Boolean).join("\n");
}

export type { ResumeBullet, ResumeSection, ResumeStructure, SkillGroup };
