import JSZip from "jszip";
import { describe, expect, it } from "vitest";
import { wrapBullet } from "../quality/measure";
import { estimatePageFill } from "./budget";
import { PAGE_CSS } from "./html";
import { renderResumeDocx } from "./render";
import { LINE_HEIGHT, PAGE, sizesFor, spaceFor, TWIPS_PER_IN } from "./layout";
import type { ResumeDoc } from "./schema";

// The one-page check in the browser measures the HTML preview (fit.ts); the download is the .docx
// (render.ts). Both are built from layout.ts, but nothing proved they agree. This test reads the
// REAL .docx XML (page size, margins, every paragraph's spacing, font size, indent and text),
// lays it out with Times New Roman widths, and compares the page fill with the node-side estimate
// the plan and the offline eval use. It also checks the HTML's CSS carries the same constants.

const header = { name: "Alex Rivera", location: "Austin, TX", links: [{ text: "alex@example.com", url: "mailto:alex@example.com" }] };

const bullet = (n: number) => `Built a ${"checkout and payments service ".repeat(n)}with **TypeScript** and **Jest**, cutting refund time by **40%**`;

const doc = (layout?: ResumeDoc["layout"]): ResumeDoc => ({
  education: [{ school: "Lakeside University", location: "Austin, TX", degree: "Bachelor of Computer Science", dates: "Sep 2022 - Jun 2026", bullets: ["Dean's List, ACM chapter vice president and hackathon organizer"] }],
  experience: [
    { title: "Software Engineer Intern", company: "Brightloop", location: "Austin, TX", dates: "May 2026 - Aug 2026", bullets: [bullet(1), bullet(2), bullet(3), bullet(1), bullet(2)] },
    { title: "Teaching Assistant", company: "Lakeside University", location: "Austin, TX", dates: "Jan 2025 - May 2025", bullets: [bullet(2), bullet(1), bullet(3)] },
  ],
  projects: [{ title: "Project", company: "Taskwise", location: "", dates: "2025", bullets: [bullet(2), bullet(1)] }],
  skills: [
    { category: "Languages", items: ["TypeScript", "JavaScript", "Python", "Go", "SQL", "Java", "C++"] },
    { category: "Frameworks and tools", items: ["React", "Next.js", "Node.js", "Jest", "Docker", "PostgreSQL", "Git", "AWS", "Redis", "GraphQL", "Kubernetes", "Terraform"] },
  ],
  leadership: [{ role: "ACM Student Chapter, Vice President", dates: "Sep 2024 - Present" }],
  meta: { matchedKeywords: [], gaps: [], valuesReflected: [] },
  ...(layout ? { layout } : {}),
});

interface Para {
  before: number;
  after: number;
  size: number;
  text: string;
  bulletList: boolean;
  border: boolean;
  tabbed: boolean;
}

const attr = (xml: string, tag: string, name: string) => xml.match(new RegExp(`<w:${tag}\\b[^>]*\\bw:${name}="(-?\\d+)"`))?.[1];

async function readDocx(d: ResumeDoc) {
  const zip = await JSZip.loadAsync(await renderResumeDocx(header, d));
  const body = await zip.file("word/document.xml")!.async("string");
  const styles = await zip.file("word/styles.xml")!.async("string");
  const pg = body.match(/<w:pgSz[^>]*>/)![0];
  const mar = body.match(/<w:pgMar[^>]*>/)![0];
  const m = (name: string) => Number(mar.match(new RegExp(`w:${name}="(\\d+)"`))![1]);
  const defaultRun = Number(styles.match(/<w:docDefaults>[\s\S]*?<w:sz w:val="(\d+)"/)![1]) / 2;
  const lineTwips = Number(styles.match(/<w:docDefaults>[\s\S]*?<w:spacing[^>]*w:line="(\d+)"/)![1]);
  const paras: Para[] = [...body.matchAll(/<w:p>([\s\S]*?)<\/w:p>/g)].map((x) => {
    const p = x[1];
    const sizes = [...p.matchAll(/<w:sz w:val="(\d+)"/g)].map((s) => Number(s[1]) / 2);
    // Text of every run in order, with ** around bold runs so the wrap estimate counts them wider.
    const text = [...p.matchAll(/<w:r>([\s\S]*?)<\/w:r>/g)]
      .map((r) => {
        const t = [...r[1].matchAll(/<w:t[^>]*>([^<]*)<\/w:t>/g)].map((z) => z[1]).join("");
        return /<w:b\/>/.test(r[1]) && t ? `**${t}**` : t;
      })
      .join("");
    return {
      before: Number(attr(p, "spacing", "before") ?? 0) / 20,
      after: Number(attr(p, "spacing", "after") ?? 0) / 20,
      size: sizes.length ? Math.max(...sizes) : defaultRun,
      text,
      bulletList: /<w:numPr>/.test(p),
      border: /<w:pBdr>/.test(p),
      tabbed: /<w:tab\/>/.test(p),
    };
  });
  return {
    widthTwips: Number(pg.match(/w:w="(\d+)"/)![1]),
    heightTwips: Number(pg.match(/w:h="(\d+)"/)![1]),
    top: m("top"),
    bottom: m("bottom"),
    left: m("left"),
    right: m("right"),
    lineTwips,
    paras,
  };
}

/** Page fill by laying the real .docx paragraphs out the way Word does. */
async function docxFill(d: ResumeDoc): Promise<number> {
  const x = await readDocx(d);
  const usablePt = (x.heightTwips - x.top - x.bottom) / 20;
  const textWidthEm = (size: number, indentTwips: number) => ((x.widthTwips - x.left - x.right - indentTwips) / 20 / size) * 1000 * 0.97;
  let total = 0;
  for (const p of x.paras) {
    const indent = p.bulletList ? 270 : 0;
    // A line with a right-aligned date is one line; the tab content is short.
    const text = p.tabbed ? "" : p.text;
    const lines = text ? Math.max(1, wrapBullet(text, textWidthEm(p.size, indent)).lines.length) : 1;
    total += lines * p.size * LINE_HEIGHT * (x.lineTwips / 240) + p.before + p.after + (p.border ? 1 + 0.75 : 0);
  }
  return total / usablePt;
}

describe("the page check agrees with the .docx", () => {
  it("the .docx page is US Letter with her 0.45in side and 0.35in top/bottom margins", async () => {
    const x = await readDocx(doc());
    expect([x.widthTwips, x.heightTwips]).toEqual([8.5 * TWIPS_PER_IN, 11 * TWIPS_PER_IN]);
    expect([x.left, x.right]).toEqual([Math.round(0.45 * TWIPS_PER_IN), Math.round(0.45 * TWIPS_PER_IN)]);
    expect([x.top, x.bottom]).toEqual([Math.round(0.35 * TWIPS_PER_IN), Math.round(0.35 * TWIPS_PER_IN)]);
    expect(PAGE).toMatchObject({ marginXIn: 0.45, marginYIn: 0.35 });
  });

  it("sizes in the .docx are her spec: name 17, section headers and titles 10.5, body 10", async () => {
    const x = await readDocx(doc());
    const sizes = new Set(x.paras.map((p) => p.size));
    expect(sizes).toEqual(new Set([17, 10, 10.5]));
    expect(sizesFor()).toMatchObject({ name: 17, contact: 10, sectionHeader: 10.5, entryTitle: 10.5, entrySub: 10, bullet: 10, skills: 10 });
  });

  it.each([
    ["default layout (10pt, spacing 1)", undefined],
    ["fit loop's largest (11pt, spacing 1.15)", { body: 11, spacing: 1.15 }],
    ["in between (10.5pt, spacing 1.05)", { body: 10.5, spacing: 1.05 }],
  ] as const)("the node estimate is within 2 points of the .docx layout at %s", async (_label, layout) => {
    const d = doc(layout ? { ...layout } : undefined);
    const fromDocx = await docxFill(d);
    const estimate = estimatePageFill(d);
    // Fill is a share of the page: 0.02 is about one line.
    expect(Math.abs(estimate - fromDocx)).toBeLessThan(0.02);
  });

  it("the preview's CSS uses the same geometry as the .docx (margins, bullet indent, rule, line height)", () => {
    expect(PAGE_CSS).toContain(`padding:${PAGE.marginYIn}in ${PAGE.marginXIn}in`);
    expect(PAGE_CSS).toContain("width:8.5in");
    expect(PAGE_CSS).toContain("padding-left:0.1875in"); // 270 twips
    expect(PAGE_CSS).toContain("border-bottom:0.75pt solid #000");
    expect(PAGE_CSS).toContain(`line-height:calc(${LINE_HEIGHT} * var(--m))`);
    expect(PAGE_CSS).toContain('font-family:"Times New Roman"');
    // Space above a section and between entries scale with the same multiple as the .docx.
    const s = spaceFor();
    expect(PAGE_CSS).toContain(`padding-top:calc(var(--m) * ${s.beforeSection}pt)`);
    expect(PAGE_CSS).toContain(`margin-top:calc(var(--m) * ${s.beforeEntry}pt)`);
    expect(PAGE_CSS).toContain(`margin-bottom:calc(var(--m) * ${s.afterSectionHeader}pt)`);
  });
});
