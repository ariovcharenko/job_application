import { readFileSync } from "node:fs";
import { fileURLToPath } from "node:url";
import JSZip from "jszip";
import { describe, expect, it } from "vitest";
import { extractDocxText, MAX_RESUME_BYTES, pastedSource, readResumeUpload, ResumeFileError } from "./extractText";

const FIXTURE = readFileSync(fileURLToPath(new URL("../../docx/__fixtures__/sample-resume.docx", import.meta.url)));
const fixtureBytes = () => FIXTURE.buffer.slice(FIXTURE.byteOffset, FIXTURE.byteOffset + FIXTURE.byteLength) as ArrayBuffer;

const upload = (name: string, bytes: ArrayBuffer | Uint8Array | string) => {
  const data = typeof bytes === "string" ? new TextEncoder().encode(bytes) : bytes instanceof Uint8Array ? bytes : new Uint8Array(bytes);
  return { name, size: data.byteLength, arrayBuffer: async () => data.buffer.slice(data.byteOffset, data.byteOffset + data.byteLength) as ArrayBuffer };
};

describe("extractDocxText", () => {
  it("reads the fixture's sections, bullets and header links as plain text", async () => {
    const text = await extractDocxText(fixtureBytes());
    expect(text).toMatch(/EXPERIENCE/);
    expect(text).toMatch(/SKILLS/);
    expect(text).toMatch(/^- /m); // bullets keep a marker
    expect(text).toMatch(/linkedin\.com/i); // the header's hyperlink target, not only its label
    expect(text).not.toMatch(/<w:/);
  });

  it("explains a file that isn't a Word document", async () => {
    await expect(extractDocxText(new TextEncoder().encode("not a zip").buffer as ArrayBuffer)).rejects.toThrow(/couldn't be opened/);
    const zip = new JSZip();
    zip.file("hello.txt", "hi");
    const bytes = await zip.generateAsync({ type: "arraybuffer" });
    await expect(extractDocxText(bytes)).rejects.toThrow(/doesn't look like a Word/);
  });
});

describe("readResumeUpload", () => {
  it("turns a .docx into text", async () => {
    const src = await readResumeUpload(upload("resume.docx", fixtureBytes()));
    expect(src).toMatchObject({ kind: "text", origin: "docx", fileName: "resume.docx" });
    expect(src.kind === "text" && src.text.length).toBeGreaterThan(500);
  });

  it("keeps a PDF as base64 for the model", async () => {
    const src = await readResumeUpload(upload("resume.pdf", "%PDF-1.7 fake pdf body"));
    expect(src.kind).toBe("pdf");
    expect(src.kind === "pdf" && atob(src.base64)).toContain("%PDF-1.7");
  });

  it("reads a text file", async () => {
    const text = "Jane Doe\nExperience\nData Analyst at Acme, 2023 to 2025. Built 12 dashboards in Tableau for the sales team.";
    expect(await readResumeUpload(upload("resume.txt", text))).toMatchObject({ kind: "text", origin: "txt", text });
  });

  it("gives an actionable error for empty, huge, old-Word, wrong-type and near-empty files", async () => {
    await expect(readResumeUpload(upload("r.pdf", ""))).rejects.toThrow(/is empty/);
    await expect(readResumeUpload({ name: "r.pdf", size: MAX_RESUME_BYTES + 1, arrayBuffer: async () => new ArrayBuffer(0) })).rejects.toThrow(/larger than 5 MB/);
    await expect(readResumeUpload(upload("r.doc", "x"))).rejects.toThrow(/save it as \.docx/);
    await expect(readResumeUpload(upload("r.png", "x"))).rejects.toThrow(/PDF, a Word/);
    await expect(readResumeUpload(upload("r.txt", "too short"))).rejects.toThrow(/almost no text/);
    await expect(readResumeUpload(upload("r.pdf", "not really a pdf"))).rejects.toBeInstanceOf(ResumeFileError);
  });
});

describe("pastedSource", () => {
  it("accepts real text and rejects nearly nothing", () => {
    expect(pastedSource("  " + "Software engineer with 3 years building APIs in Go. ".repeat(3)).kind).toBe("text");
    expect(() => pastedSource("hi")).toThrow(/almost no text/);
  });
});
