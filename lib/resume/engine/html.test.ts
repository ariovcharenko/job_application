import { describe, expect, it } from "vitest";
import { PAGE_CSS, renderResumeHtml } from "./html";
import type { ResumeDoc } from "./schema";

const doc: ResumeDoc = {
  education: [],
  experience: [{ title: "Engineer", company: "Acme", location: "Irvine, CA", dates: "May 2025 - Aug 2025", bullets: ["Built **React** app"] }],
  skills: [{ category: "Languages", items: ["TypeScript"] }],
  leadership: [{ role: "Club", dates: "2024" }],
  meta: { matchedKeywords: [], gaps: [], valuesReflected: [] },
};

describe("renderResumeHtml", () => {
  it("makes every clickable spot keyboard-focusable", () => {
    const html = renderResumeHtml({ name: "A", location: "", links: [] }, doc);
    const tagged = html.match(/<[^>]+data-(?:sec|b)=[^>]*>/g) ?? [];
    expect(tagged.length).toBe(4);
    for (const tag of tagged) expect(tag).toContain('tabindex="0"');
  });

  it("matches Word's layout: space under section rules, dates never wrap", () => {
    expect(PAGE_CSS).toMatch(/\.rp \.h\{[^}]*padding-bottom:1pt/);
    expect(PAGE_CSS).toContain(".rp .r>span:last-child{white-space:nowrap;flex-shrink:0}");
    expect(PAGE_CSS).toMatch(/cursor:pointer/);
    expect(PAGE_CSS).toMatch(/focus-visible\{outline:2px solid #7B3FE4/);
  });

  it("measures like Word: space above a header adds to the line before it, no kerning", () => {
    // Margins would collapse (3pt + 5pt = 5pt in CSS, 8pt in Word); padding adds up like Word.
    expect(PAGE_CSS).toMatch(/\.rp \.h\{[^}]*padding-top:5pt/);
    expect(PAGE_CSS).not.toMatch(/\.rp \.h\{[^}]*margin-top/);
    expect(PAGE_CSS).toMatch(/font-kerning:none/);
    expect(PAGE_CSS).toMatch(/font-variant-ligatures:none/);
  });

  it("styles lines like her format: bold title with regular dates, italic company and location", () => {
    const html = renderResumeHtml({ name: "A", location: "", links: [] }, doc);
    expect(html).toContain('<div class="r t"><span>Engineer</span><span style="font-weight:normal">May 2025 - Aug 2025</span></div>');
    expect(html).toContain('<div class="r s"><span>Acme</span><span>Irvine, CA</span></div>');
    expect(PAGE_CSS).toMatch(/\.rp \.s\{font-style:italic;font-size:9pt\}/);
    expect(html).toContain("<b>Languages:</b> TypeScript");
  });
});
