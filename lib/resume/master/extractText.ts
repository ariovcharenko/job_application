import type { Element } from "@xmldom/xmldom";
import JSZip from "jszip";
import { isBulletParagraph, paragraphText, parseXml, W_NS } from "../../docx/xml";

// Reads an uploaded resume for "Import from my resume" (fromResume.ts). A PDF is passed to the
// model as a document attachment; a Word file or text file becomes plain text here, so it costs
// less and so code can check that every number in the result appears in the original.

export const MAX_RESUME_BYTES = 5 * 1024 * 1024;
/** Less text than this is not a resume (an empty or image-only file). */
const MIN_RESUME_CHARS = 80;

export type ResumeSource =
  | { kind: "pdf"; fileName: string; base64: string; bytes: ArrayBuffer }
  | { kind: "text"; origin: "docx" | "txt" | "paste"; fileName: string; text: string };

/** A problem with the file itself, worded for the person who picked it. */
export class ResumeFileError extends Error {
  constructor(message: string) {
    super(message);
    this.name = "ResumeFileError";
  }
}

const HYPERLINK_TYPE = /\/hyperlink$/;

/** r:id -> URL for the document's hyperlinks, so "LinkedIn" in the header keeps its address. */
async function hyperlinkTargets(zip: JSZip): Promise<Map<string, string>> {
  const out = new Map<string, string>();
  const rels = await zip.file("word/_rels/document.xml.rels")?.async("string");
  if (!rels) return out;
  const doc = parseXml(rels);
  const list = doc.getElementsByTagName("Relationship");
  for (let i = 0; i < list.length; i++) {
    const r = list[i];
    if (HYPERLINK_TYPE.test(r.getAttribute("Type") ?? "")) out.set(r.getAttribute("Id") ?? "", r.getAttribute("Target") ?? "");
  }
  return out;
}

function hasParagraphAncestor(p: Element): boolean {
  for (let n = p.parentNode; n; n = n.parentNode) {
    if (n.nodeType === 1 && (n as Element).localName === "p") return true;
  }
  return false;
}

/** Every paragraph of one Word XML part as a line: bullets start with "- ", links show their URL. */
function partLines(xml: string, links: Map<string, string>): string[] {
  const doc = parseXml(xml);
  const paragraphs = doc.getElementsByTagNameNS(W_NS, "p");
  const lines: string[] = [];
  for (let i = 0; i < paragraphs.length; i++) {
    const p = paragraphs[i] as unknown as Element;
    // A text box's paragraphs sit inside another paragraph, whose text already includes them.
    if (hasParagraphAncestor(p)) continue;
    let text = paragraphText(p).replace(/ /g, " ").replace(/[ \t]+$/g, "");
    const anchors = p.getElementsByTagNameNS(W_NS, "hyperlink");
    const urls: string[] = [];
    for (let j = 0; j < anchors.length; j++) {
      const id = anchors[j].getAttribute("r:id") ?? "";
      const url = links.get(id);
      const shown = url?.replace(/^mailto:/, "");
      if (shown && !text.includes(shown) && !urls.includes(shown)) urls.push(shown);
    }
    if (urls.length) text += `  [links: ${urls.join(", ")}]`;
    if (!text.trim()) continue;
    lines.push(isBulletParagraph(p) ? `- ${text.trim()}` : text);
  }
  return lines;
}

/** The text of a .docx: page headers first (name and contact often live there), then the body. */
export async function extractDocxText(bytes: ArrayBuffer): Promise<string> {
  let zip: JSZip;
  try {
    zip = await JSZip.loadAsync(bytes);
  } catch {
    throw new ResumeFileError("That Word file couldn't be opened. It may be damaged or password-protected. Save it again as .docx or PDF and try again.");
  }
  const body = zip.file("word/document.xml");
  if (!body) throw new ResumeFileError("That doesn't look like a Word (.docx) file. Save it again as .docx or PDF and try again.");
  const links = await hyperlinkTargets(zip);
  const headerNames = Object.keys(zip.files).filter((n) => /^word\/header\d*\.xml$/.test(n)).sort();
  const lines: string[] = [];
  for (const name of headerNames) lines.push(...partLines(await zip.file(name)!.async("string"), links));
  lines.push(...partLines(await body.async("string"), links));
  return lines.join("\n").replace(/\n{3,}/g, "\n\n").trim();
}

function toBase64(bytes: ArrayBuffer): string {
  const view = new Uint8Array(bytes);
  let binary = "";
  const CHUNK = 0x8000;
  for (let i = 0; i < view.length; i += CHUNK) binary += String.fromCharCode(...view.subarray(i, i + CHUNK));
  return btoa(binary);
}

function ensureEnoughText(text: string, what: string): string {
  const trimmed = text.replace(/\r\n?/g, "\n").trim();
  if (trimmed.length < MIN_RESUME_CHARS) {
    throw new ResumeFileError(`${what} has almost no text. Check that it's your resume, or paste the text instead.`);
  }
  return trimmed;
}

/** Pasted resume text, checked the same way as a file. */
export function pastedSource(text: string): ResumeSource {
  return { kind: "text", origin: "paste", fileName: "Pasted text", text: ensureEnoughText(text, "The pasted text") };
}

/** What she picked in the file input: a PDF, a Word (.docx) or a plain text file, up to 5 MB. */
export async function readResumeUpload(file: Pick<File, "name" | "size" | "arrayBuffer">): Promise<ResumeSource> {
  const name = file.name;
  const ext = name.toLowerCase().match(/\.([a-z0-9]+)$/)?.[1] ?? "";
  if (file.size === 0) throw new ResumeFileError(`"${name}" is empty. Pick your resume file again.`);
  if (file.size > MAX_RESUME_BYTES) throw new ResumeFileError(`"${name}" is larger than 5 MB. Use a smaller PDF or Word file, or paste the text.`);
  if (ext === "doc") throw new ResumeFileError("Old Word (.doc) files can't be read. Open it in Word and save it as .docx or PDF.");
  if (!["pdf", "docx", "txt", "md"].includes(ext)) {
    throw new ResumeFileError("Use a PDF, a Word (.docx) or a text file, or paste the text.");
  }
  const bytes = await file.arrayBuffer();
  if (ext === "pdf") {
    const head = new TextDecoder().decode(new Uint8Array(bytes.slice(0, 5)));
    if (head !== "%PDF-") throw new ResumeFileError(`"${name}" isn't a readable PDF. Export it again as PDF, or paste the text.`);
    return { kind: "pdf", fileName: name, base64: toBase64(bytes), bytes };
  }
  if (ext === "docx") {
    return { kind: "text", origin: "docx", fileName: name, text: ensureEnoughText(await extractDocxText(bytes), `"${name}"`) };
  }
  const text = new TextDecoder().decode(bytes);
  return { kind: "text", origin: "txt", fileName: name, text: ensureEnoughText(text, `"${name}"`) };
}
