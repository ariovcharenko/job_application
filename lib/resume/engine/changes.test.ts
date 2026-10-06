import { describe, expect, it } from "vitest";
import { changedRanges, diffDocs } from "./changes";
import { renderResumeHtml } from "./html";
import type { ResumeDoc } from "./schema";

const doc = (bullets: string[], extra: Partial<ResumeDoc> = {}): ResumeDoc => ({
  education: [],
  experience: [{ title: "Engineer", company: "Brightloop", location: "Austin, TX", dates: "May 2025 - Aug 2025", bullets }],
  skills: [{ category: "Languages", items: ["TypeScript", "Python"] }],
  leadership: [],
  meta: { matchedKeywords: [], gaps: [], valuesReflected: [] },
  ...extra,
});
const header = { name: "Alex Rivera", location: "Austin, TX", links: [] };
const at = (s: string, r: [number, number][]) => r.map(([a, b]) => s.slice(a, b));

describe("changedRanges", () => {
  it("marks only the words that are new", () => {
    const after = "Built a React dashboard with TypeScript for 6 teams";
    expect(at(after, changedRanges("Built a dashboard for 6 teams", after))).toEqual(["React", "with TypeScript"]);
  });

  it("marks nothing for the same text, or a change in punctuation or case only", () => {
    expect(changedRanges("Built a tool.", "Built a tool")).toEqual([]);
    expect(changedRanges("built a Tool", "Built a tool")).toEqual([]);
  });
});

describe("diffDocs", () => {
  it("is empty when nothing changed", () => {
    const d = doc(["Shipped **6 features** with **React**"]);
    expect(diffDocs(d, d)).toEqual([]);
  });

  it("marks changed words of an edited bullet, and a rewritten one as a whole", () => {
    const before = doc(["Shipped 6 features with React", "Wrote tests with Jest"]);
    const after = doc(["Shipped **6 production features** with **React**", "Mentored two interns on code review practices"]);
    const marks = diffDocs(before, after);
    const first = marks.find((m) => "bullet" in m && m.bullet === 0)!;
    expect("ranges" in first && first.ranges !== "all" && at("Shipped 6 production features with React", first.ranges)).toEqual(["production"]);
    expect(marks.find((m) => "bullet" in m && m.bullet === 1)).toMatchObject({ ranges: "all" });
  });

  it("matches entries by name, not position, and marks a swapped-in entry whole", () => {
    const before = doc(["Wrote tests with Jest"]);
    const swapped = { title: "Intern", company: "Taskwise", location: "Remote", dates: "2024", bullets: ["Built an API"] };
    const after = doc(["Wrote tests with Jest"], { experience: [swapped, before.experience[0]] });
    const marks = diffDocs(before, after);
    expect(marks).toContainEqual({ section: "experience", entry: 0 });
    expect(marks).toContainEqual({ section: "experience", entry: 0, bullet: 0, ranges: "all" });
    expect(marks.some((m) => m.section === "experience" && m.entry === 1)).toBe(false);
  });

  it("marks new skills only", () => {
    const after = doc([], { skills: [{ category: "Languages", items: ["Python", "TypeScript", "Go"] }] });
    expect(diffDocs(doc([]), after)).toEqual([{ section: "skills", line: 0, item: 2 }]);
  });
});

describe("renderResumeHtml with changes", () => {
  it("wraps the changed words in a marker, nested correctly with bold, and keeps the line selectable", () => {
    const before = doc(["Shipped 6 features with React"]);
    const after = doc(["Shipped **6 production features** with **React**"]);
    const html = renderResumeHtml(header, after, [], diffDocs(before, after));
    expect(html).toContain('<li data-b="0" tabindex="0">Shipped <b>6 <mark class="ch">production</mark> features</b> with <b>React</b></li>');
    expect(renderResumeHtml(header, after)).not.toContain("<mark");
  });

  it("escapes text inside the marker", () => {
    const after = doc(["Built <script> tools"]);
    const html = renderResumeHtml(header, after, [], diffDocs(doc(["Built tools"]), after));
    expect(html).not.toContain("<script>");
  });
});
