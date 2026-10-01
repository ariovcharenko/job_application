import type { Document, Element } from "@xmldom/xmldom";
import JSZip from "jszip";
import { classifyParagraphs } from "./sections";
import { W_NS, bodyParagraphs, child, children, isBulletParagraph, paraId, paragraphText, parseXml, runIsBold, serializeXml } from "./xml";

const DOCUMENT_XML_PATH = "word/document.xml";

export interface ResumeEdits {
  /** bullet paraId -> new text. */
  bullets: Record<string, string>;
  /** skill-group paraId -> new items (same or reordered set, or with ticked suggestions appended). */
  skillGroups: Record<string, string[]>;
  /** Brand-new skill line(s) to append at the end of the skills section (e.g. ticked suggestions
   * that didn't fit an existing category). Each becomes one "Label: item, item" line. */
  newSkillGroups?: { label: string; items: string[] }[];
}

/** Writes tailoring edits into a .docx's own XML, editing paragraphs in place by their stable
 * w14:paraId. Never touches any paragraph not named in `edits` — the header, dates, company
 * names, education and everything else pass through byte-for-byte. */
export async function applyDocxEdits(bytes: ArrayBuffer, edits: ResumeEdits): Promise<ArrayBuffer> {
  const zip = await JSZip.loadAsync(bytes);
  const documentXmlFile = zip.file(DOCUMENT_XML_PATH);
  if (!documentXmlFile) throw new Error("Not a valid .docx: missing word/document.xml");
  const xml = await documentXmlFile.async("string");
  const doc = parseXml(xml);
  const paragraphs = bodyParagraphs(doc);

  const bulletIds = new Set(Object.keys(edits.bullets));
  const skillIds = new Set(Object.keys(edits.skillGroups));

  for (const p of paragraphs) {
    const id = paraId(p);
    if (id && bulletIds.has(id) && isBulletParagraph(p)) {
      rewriteBulletParagraph(doc, p, edits.bullets[id]);
    } else if (id && skillIds.has(id) && !isBulletParagraph(p)) {
      rewriteSkillParagraph(doc, p, edits.skillGroups[id]);
    }
  }

  // The insertion point for brand-new skill lines: the last non-bullet, non-empty paragraph in
  // whichever section is classified "skills" — independent of which paragraphs `edits` touched,
  // so this works even when no existing skill line is being edited this round.
  let lastSkillsParagraph: Element | null = null;
  const classified = classifyParagraphs(paragraphs);
  for (let i = 0; i < paragraphs.length; i++) {
    const p = paragraphs[i];
    if (classified[i].kind === "skills" && !classified[i].isHeading && !isBulletParagraph(p) && paragraphText(p).trim()) {
      lastSkillsParagraph = p;
    }
  }

  if (edits.newSkillGroups?.length && lastSkillsParagraph) {
    let anchor = lastSkillsParagraph;
    for (const group of edits.newSkillGroups) {
      const newP = buildSkillParagraph(doc, anchor, group.label, group.items);
      anchor.parentNode?.insertBefore(newP, anchor.nextSibling);
      anchor = newP;
    }
  }

  const newXml = serializeXml(doc);
  zip.file(DOCUMENT_XML_PATH, newXml);
  const out = await zip.generateAsync({ type: "arraybuffer" });
  return out;
}

/** Rewrites a bullet's text, re-segmenting it into runs so any substring that was bold in the
 * original bullet and still appears verbatim in the new text stays bold (this is how metrics and
 * technology names stay bold after tailoring, without letting the AI invent new bold spans). */
function rewriteBulletParagraph(doc: Document, p: Element, newText: string): void {
  const originalBoldTexts = collectBoldRunTexts(p);
  const spans = segmentByBoldSpans(newText, originalBoldTexts);
  replaceRuns(doc, p, spans);
}

function rewriteSkillParagraph(doc: Document, p: Element, items: string[]): void {
  const runs = allRunsDirect(p);
  const hasBoldLabel = runs.length > 0 && runIsBold(runs[0]);
  const newText = `: ${items.join(", ")}`;
  if (hasBoldLabel) {
    // Keep the bold label run untouched; replace everything after it with one plain run.
    for (let i = runs.length - 1; i >= 1; i--) p.removeChild(runs[i]);
    p.appendChild(buildRun(doc, newText, false));
  } else {
    replaceRuns(doc, p, [{ text: items.join(", "), bold: false }]);
  }
}

function buildSkillParagraph(doc: Document, template: Element, label: string, items: string[]): Element {
  const p = template.cloneNode(false) as Element; // shallow: keeps w:pPr's sibling slot but not its children
  const pPr = child(template, "pPr");
  if (pPr) p.appendChild(pPr.cloneNode(true));
  if (label) {
    p.appendChild(buildRun(doc, label, true));
    p.appendChild(buildRun(doc, `: ${items.join(", ")}`, false));
  } else {
    p.appendChild(buildRun(doc, items.join(", "), false));
  }
  return p;
}

function collectBoldRunTexts(p: Element): string[] {
  const texts = allRunsDirect(p)
    .filter(runIsBold)
    .map((r) => runText(r))
    .filter((t) => t.trim().length > 0);
  // Longest first, so greedy matching prefers a full bold phrase over a shorter substring of it.
  return [...new Set(texts)].sort((a, b) => b.length - a.length);
}

function runText(r: Element): string {
  return children(r, "t")
    .map((t) => t.textContent ?? "")
    .join("");
}

function allRunsDirect(p: Element): Element[] {
  return children(p, "r");
}

interface Span {
  text: string;
  bold: boolean;
}

/** Greedily re-applies bold to any occurrence of a formerly-bold substring, left to right. */
function segmentByBoldSpans(text: string, boldTexts: string[]): Span[] {
  const spans: Span[] = [];
  let i = 0;
  let plainBuf = "";
  const flushPlain = () => {
    if (plainBuf) {
      spans.push({ text: plainBuf, bold: false });
      plainBuf = "";
    }
  };
  outer: while (i < text.length) {
    for (const bt of boldTexts) {
      if (bt && text.startsWith(bt, i)) {
        flushPlain();
        spans.push({ text: bt, bold: true });
        i += bt.length;
        continue outer;
      }
    }
    plainBuf += text[i];
    i++;
  }
  flushPlain();
  return spans;
}

function replaceRuns(doc: Document, p: Element, spans: Span[]): void {
  for (const el of [...allRunsDirect(p)]) p.removeChild(el);
  for (const hl of children(p, "hyperlink")) p.removeChild(hl);
  for (const span of spans) p.appendChild(buildRun(doc, span.text, span.bold));
}

function buildRun(doc: Document, text: string, bold: boolean): Element {
  const r = doc.createElementNS(W_NS, "w:r");
  if (bold) {
    const rPr = doc.createElementNS(W_NS, "w:rPr");
    rPr.appendChild(doc.createElementNS(W_NS, "w:b"));
    r.appendChild(rPr);
  }
  const t = doc.createElementNS(W_NS, "w:t");
  if (/^\s|\s$/.test(text)) t.setAttribute("xml:space", "preserve");
  t.appendChild(doc.createTextNode(text));
  r.appendChild(t);
  return r;
}
