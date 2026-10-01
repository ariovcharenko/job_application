import JSZip from "jszip";
import { describe, expect, it } from "vitest";
import { DEFAULT_PROFILE } from "../../defaults";
import { buildHeader } from "./index";
import { renderResumeHtml } from "./html";
import { renderResumeDocx } from "./render";
import type { ResumeDoc } from "./schema";

const header = buildHeader({
  ...DEFAULT_PROFILE,
  fullName: "Alex Rivera",
  location: "Austin, TX",
  email: "alex.rivera@example.com",
  linkedin: "https://www.linkedin.com/in/alex-rivera/",
  github: "github.com/alexrivera",
  portfolio: "https://alexrivera.dev/",
});

const doc: ResumeDoc = {
  education: [{ school: "Lakeside University", location: "Austin, TX", degree: "Bachelor of CS", dates: "Sep 2022 - Jun 2026", bullets: [] }],
  experience: [
    {
      title: "Software Engineer Intern",
      company: "Brightloop",
      location: "Austin, TX",
      dates: "May 2026 - Aug 2026",
      bullets: ["Shipped **6 production features** using **React** & <hooks>"],
    },
  ],
  skills: [{ category: "Languages", items: ["TypeScript", "Python"] }],
  leadership: [{ role: "Robotics Club", dates: "Oct 2023 - Present" }],
  meta: { matchedKeywords: [], gaps: [], valuesReflected: [] },
};

async function docxXml() {
  const zip = await JSZip.loadAsync(await renderResumeDocx(header, doc));
  return {
    body: await zip.file("word/document.xml")!.async("string"),
    rels: await zip.file("word/_rels/document.xml.rels")!.async("string"),
  };
}

describe("buildHeader", () => {
  it("builds the four links from the Profile, adding https:// where missing", () => {
    expect(header.links).toEqual([
      { text: "alex.rivera@example.com", url: "mailto:alex.rivera@example.com" },
      { text: "LinkedIn", url: "https://www.linkedin.com/in/alex-rivera/" },
      { text: "GitHub", url: "https://github.com/alexrivera" },
      { text: "Portfolio", url: "https://alexrivera.dev/" },
    ]);
  });

  it("leaves out links she hasn't filled in", () => {
    expect(buildHeader({ ...DEFAULT_PROFILE, fullName: "A", email: "a@b.co" }).links).toHaveLength(1);
  });
});

describe("renderResumeDocx", () => {
  it("puts dates at the right margin with Word's own tab element, never a literal tab character", async () => {
    const { body } = await docxXml();
    expect(body).toMatch(/<w:tab\s*\/>/);
    expect(body).not.toContain("\t");
    expect(body).toMatch(/<w:tab w:val="right"/);
  });

  it("makes every header link a real hyperlink with the exact URL, once each", async () => {
    const { rels } = await docxXml();
    for (const l of header.links) {
      const escaped = l.url.replace(/&/g, "&amp;");
      expect(rels.split(`Target="${escaped}"`).length - 1).toBe(1);
    }
  });

  it("uses Times New Roman, black text, and only #0563C1 for links", async () => {
    const { body } = await docxXml();
    expect(body).toContain('w:ascii="Times New Roman"');
    const colors = new Set([...body.matchAll(/w:color w:val="([0-9A-Fa-f]{6})"/g)].map((m) => m[1].toUpperCase()));
    expect([...colors].every((c) => c === "0563C1" || c === "000000")).toBe(true);
  });

  it("bolds the ** spans and sets US Letter with the spec's margins", async () => {
    const { body } = await docxXml();
    expect(body).toMatch(/<w:b\/>[\s\S]*?6 production features/);
    expect(body).toContain('w:w="12240"');
    expect(body).toContain('w:h="15840"');
    expect(body).toMatch(/w:left="648"/);
    expect(body).toMatch(/w:top="504"/);
  });

  it("contains no dashes and no literal ** markers", async () => {
    const { body } = await docxXml();
    const text = [...body.matchAll(/<w:t[^>]*>([^<]*)<\/w:t>/g)].map((m) => m[1]).join("");
    expect(text).not.toMatch(/--|—|–/);
    expect(text).not.toContain("**");
    expect(text).toContain("EXPERIENCE");
  });
});

describe("renderResumeHtml", () => {
  it("escapes model text and only allows http(s)/mailto links", () => {
    const html = renderResumeHtml({ ...header, links: [...header.links, { text: "x", url: "javascript:alert(1)" }] }, doc);
    expect(html).toContain("&lt;hooks&gt;");
    expect(html).not.toContain("<hooks>");
    expect(html).not.toContain("javascript:");
    expect(html).toContain("<b>6 production features</b>");
  });
});
