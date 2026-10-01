import { monthsOfExperience } from "./layout";
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
    expect(PAGE_CSS).toMatch(/\.rp \.h\{[^}]*padding-top:calc\(var\(--m\) \* 5pt\)/);
    expect(PAGE_CSS).not.toMatch(/\.rp \.h\{[^}]*margin-top/);
    expect(PAGE_CSS).toMatch(/font-kerning:none/);
    expect(PAGE_CSS).toMatch(/font-variant-ligatures:none/);
  });

  it("styles lines like her format: bold title with regular dates, italic company and location", () => {
    const html = renderResumeHtml({ name: "A", location: "", links: [] }, doc);
    expect(html).toContain('<div class="r t"><span>Engineer</span><span style="font-weight:normal">May 2025 - Aug 2025</span></div>');
    expect(html).toContain('<div class="r s"><span>Acme</span><span>Irvine, CA</span></div>');
    expect(PAGE_CSS).toMatch(/\.rp \.s\{font-style:italic;font-size:calc\(var\(--b\) \* 1pt \+ 0pt\)\}/);
    expect(html).toContain("<b>Languages:</b> TypeScript");
  });

  it("sets the fitted layout on the page and renders Projects after Experience", () => {
    const html = renderResumeHtml(
      { name: "A", location: "", links: [] },
      { ...doc, layout: { body: 10.5, spacing: 1.1 }, projects: [{ title: "Builder", company: "DemoDeck", location: "", dates: "Jun 2025 - Aug 2025", bullets: ["Built it"] }] },
    );
    expect(html).toContain('style="--b:10.5;--m:1.1"');
    expect(html.indexOf("PROJECTS")).toBeGreaterThan(html.indexOf("EXPERIENCE"));
    expect(html).toContain('data-sec="projects"');
    expect(html).toContain('<div class="r t"><span>DemoDeck</span>');
    const generic = renderResumeHtml({ name: "A", location: "", links: [] }, { ...doc, projects: [{ title: "Project", company: "DemoDeck", location: "", dates: "", bullets: [] }] });
    expect(generic).not.toContain("<span>Project</span>");
  });
});

describe("section order", () => {
  const entry = (dates: string) => ({ title: "Engineer", company: "Acme", location: "", dates, bullets: ["Built it"] });
  const base = {
    education: [{ school: "Lakeside University", location: "", degree: "B.S.", dates: "", bullets: [] }],
    skills: [],
    leadership: [],
    meta: { matchedKeywords: [], gaps: [], valuesReflected: [] },
  };
  const h = { name: "A", location: "", links: [] };
  it("puts Education first for a new grad and Experience first after about 2 years of work", () => {
    const grad = renderResumeHtml(h, { ...base, experience: [entry("May 2026 - Aug 2026"), entry("Oct 2025 - Feb 2026")] });
    expect(grad.indexOf("EDUCATION")).toBeLessThan(grad.indexOf("EXPERIENCE"));
    const senior = renderResumeHtml(h, { ...base, experience: [entry("Jan 2021 - Dec 2023")] });
    expect(senior.indexOf("EXPERIENCE")).toBeLessThan(senior.indexOf("EDUCATION"));
  });
  it("keeps Education first for a student or recent graduate even with long part-time roles", () => {
    const student = renderResumeHtml(h, { ...base, education: [{ ...base.education[0], dates: "Jun 2099" }], experience: [entry("Jan 2021 - Dec 2023")] });
    expect(student.indexOf("EDUCATION")).toBeLessThan(student.indexOf("EXPERIENCE"));
  });

  it("counts overlapping roles once", () => {
    expect(monthsOfExperience(["Jan 2026 - Jun 2026", "Mar 2026 - Apr 2026"])).toBe(6);
  });
});
