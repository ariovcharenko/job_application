import { describe, expect, it } from "vitest";
import { MASTER } from "./__fixtures__/master";
import { cleanTitle, entriesNotOnPage, parseMasterExperiences } from "../master/experiences";
import { addSkill, describeTarget, removeSpot, removeTarget, spotOn, spotTarget, targetFromElement } from "./edit";
import type { ResumeDoc } from "./schema";

const doc: ResumeDoc = {
  education: [{ school: "Lakeside University", location: "Austin, TX", degree: "B.S.", dates: "Sep 2022 - Jun 2026", bullets: ["Coursework"] }],
  experience: [
    { title: "Software Engineer Intern", company: "Brightloop", location: "Austin, TX", dates: "May 2026 - Aug 2026", bullets: ["A", "B", "C"] },
    { title: "Founding Software Engineer", company: "Taskwise", location: "Remote", dates: "Oct 2025 - Present", bullets: ["D"] },
  ],
  skills: [
    { category: "Languages", items: ["TypeScript", "Python"] },
    { category: "Cloud & DevOps", items: ["AWS", "Docker"] },
  ],
  leadership: [{ role: "Robotics Club", dates: "Oct 2023 - Present" }],
  meta: { matchedKeywords: [], gaps: [], valuesReflected: [] },
};

describe("removeTarget", () => {
  it("removes one bullet, a whole entry, a skills line, or a leadership item", () => {
    expect(removeTarget(doc, { section: "experience", entry: 0, bullet: 1 }).experience[0].bullets).toEqual(["A", "C"]);
    expect(removeTarget(doc, { section: "experience", entry: 0 }).experience.map((e) => e.company)).toEqual(["Taskwise"]);
    expect(removeTarget(doc, { section: "skills", entry: 1 }).skills.map((l) => l.category)).toEqual(["Languages"]);
    expect(removeTarget(doc, { section: "leadership", entry: 0 }).leadership).toEqual([]);
    expect(removeTarget(doc, { section: "education", entry: 0, bullet: 0 }).education[0].bullets).toEqual([]);
  });
  it("leaves the original untouched", () => {
    removeTarget(doc, { section: "experience", entry: 0, bullet: 0 });
    expect(doc.experience[0].bullets).toEqual(["A", "B", "C"]);
  });
});

describe("describeTarget", () => {
  it("names the spot in words", () => {
    expect(describeTarget(doc, { section: "experience", entry: 0, bullet: 1 })).toBe("Brightloop, bullet 2");
    expect(describeTarget(doc, { section: "experience", entry: 1 })).toBe("the Taskwise role");
    expect(describeTarget(doc, { section: "skills", entry: 0 })).toBe("the Languages skills line");
  });
});

describe("addSkill", () => {
  it("puts a skill on the line it belongs to", () => {
    expect(addSkill(doc, "Kubernetes").skills[1].items).toEqual(["AWS", "Docker", "Kubernetes"]);
    expect(addSkill(doc, "Go").skills[0].items).toEqual(["TypeScript", "Python", "Go"]);
  });
  it("prefers the line that already holds skills of the same kind, whatever it's called", () => {
    const renamed: ResumeDoc = { ...doc, skills: [{ category: "Languages", items: ["TypeScript"] }, { category: "Platforms", items: ["AWS", "Docker"] }] };
    expect(addSkill(renamed, "Kubernetes").skills).toEqual([
      { category: "Languages", items: ["TypeScript"] },
      { category: "Platforms", items: ["AWS", "Docker", "Kubernetes"] },
    ]);
  });
  it("adds an Additional line when nothing fits, and never duplicates", () => {
    expect(addSkill(doc, "Figma").skills.at(-1)).toEqual({ category: "Additional", items: ["Figma"] });
    expect(addSkill(doc, "python")).toBe(doc);
  });
});

describe("targetFromElement", () => {
  // A minimal stand-in for a DOM element: its own attributes plus its ancestors'.
  type Attrs = Record<string, string>;
  const el = (...chain: Attrs[]) => ({
    closest(sel: string) {
      const name = sel.slice(1, -1);
      const hit = chain.find((a) => name in a);
      return hit ? { getAttribute: (n: string) => hit[n] ?? null } : null;
    },
  });

  it("reads a bullet inside an entry", () => {
    expect(targetFromElement(el({ "data-b": "2" }, { "data-sec": "experience", "data-e": "1" }))).toEqual({ section: "experience", entry: 1, bullet: 2 });
  });
  it("reads a whole entry or skills line when no bullet was hit", () => {
    expect(targetFromElement(el({ "data-sec": "skills", "data-e": "0" }))).toEqual({ section: "skills", entry: 0 });
  });
  it("returns null outside the resume's marked parts", () => {
    expect(targetFromElement(el({}))).toBeNull();
    expect(targetFromElement(null)).toBeNull();
    expect(targetFromElement(el({ "data-sec": "experience", "data-e": "x" }))).toBeNull();
  });
});

describe("master experiences", () => {
  it("reads every role heading from the master profile", () => {
    const entries = parseMasterExperiences(MASTER);
    expect(entries.map((e) => e.company)).toEqual(expect.arrayContaining(["Brightloop", "Taskwise", "Query Insights App"]));
    expect(entries.find((e) => e.company === "Brightloop")?.dates).toBe("May 2026 - Aug 2026");
  });
  it("reads each role's location and its own block of lines", () => {
    const entries = parseMasterExperiences(MASTER);
    const brightloop = entries.find((e) => e.company === "Brightloop")!;
    expect(brightloop.location).toBe("Austin, TX");
    expect(brightloop.block).toContain("Shipped 6 production features");
    expect(brightloop.block).not.toContain("80+ early users");
    expect(entries.find((e) => e.company === "Taskwise")?.location).toBe("Remote");
  });
  it("cleanTitle drops the alt-title note", () => {
    expect(cleanTitle("Founding Software Engineer (alt. title: Product & UX Engineer)")).toBe("Founding Software Engineer");
    expect(cleanTitle("Software Engineer (Contract)")).toBe("Software Engineer (Contract)");
  });
  it("lists the roles that aren't on the page", () => {
    const missing = entriesNotOnPage(MASTER, doc).map((e) => e.company);
    expect(missing).toContain("Query Insights App");
    expect(missing).not.toContain("Brightloop");
  });
});

describe("flag spots", () => {
  it("maps a flag's spot to the line that holds it", () => {
    expect(spotTarget({ section: "skills", line: 1, item: 3 })).toEqual({ section: "skills", entry: 1 });
    expect(spotTarget({ section: "experience", entry: 0, bullet: 2 })).toEqual({ section: "experience", entry: 0, bullet: 2 });
    expect(spotOn({ section: "skills", line: 0, item: 2 }, { section: "skills", entry: 0 })).toBe(true);
    expect(spotOn({ section: "experience", entry: 0, bullet: 1 }, { section: "experience", entry: 0 })).toBe(false);
    expect(spotOn({ section: "experience", entry: 0 }, { section: "experience", entry: 0 })).toBe(true);
  });

  it("removes one skill (not its whole line), or the flagged bullet", () => {
    const d: ResumeDoc = { ...doc, skills: [{ category: "Languages", items: ["Go", "Rust"] }, { category: "Tools", items: ["Figma"] }] };
    expect(removeSpot(d, { section: "skills", line: 0, item: 1 }).skills).toEqual([{ category: "Languages", items: ["Go"] }, { category: "Tools", items: ["Figma"] }]);
    expect(removeSpot(d, { section: "skills", line: 1, item: 0 }).skills).toEqual([{ category: "Languages", items: ["Go", "Rust"] }]);
    expect(removeSpot(d, { section: "experience", entry: 0, bullet: 1 }).experience[0].bullets).toEqual(["A", "C"]);
  });
});
