import { describe, expect, it } from "vitest";
import { editTarget, textOfTarget } from "./editText";
import type { ResumeDoc } from "./schema";
import { validateResume } from "./validate";
import { MASTER } from "./__fixtures__/master";

const doc: ResumeDoc = {
  education: [],
  experience: [{ title: "Software Engineer Intern", company: "Brightloop", location: "Austin, TX", dates: "May 2026 - Aug 2026", bullets: ["Shipped **6 production features**", "B"] }],
  skills: [{ category: "Languages", items: ["TypeScript", "Python"] }],
  leadership: [],
  meta: { matchedKeywords: [], gaps: [], valuesReflected: [] },
};

describe("textOfTarget / editTarget", () => {
  it("edits a bullet, keeping her bold markers", () => {
    expect(textOfTarget(doc, { section: "experience", entry: 0, bullet: 0 })).toBe("Shipped **6 production features**");
    const next = editTarget(doc, { section: "experience", entry: 0, bullet: 0 }, "Shipped **6 production features** to players");
    expect(next.experience[0].bullets).toEqual(["Shipped **6 production features** to players", "B"]);
  });

  it("edits a skills line from a comma-separated list", () => {
    expect(textOfTarget(doc, { section: "skills", entry: 0 })).toBe("TypeScript, Python");
    expect(editTarget(doc, { section: "skills", entry: 0 }, "Python,  TypeScript , Go").skills[0].items).toEqual(["Python", "TypeScript", "Go"]);
  });

  it("ignores empty text and whole entries", () => {
    expect(editTarget(doc, { section: "experience", entry: 0, bullet: 1 }, "   ")).toBe(doc);
    expect(textOfTarget(doc, { section: "experience", entry: 0 })).toBeNull();
  });

  it("still flags a new number she types that isn't in her master profile", () => {
    const next = editTarget(doc, { section: "experience", entry: 0, bullet: 0 }, "Shipped **9 production features**");
    expect(validateResume(next, MASTER).flags.some((f) => f.kind === "number")).toBe(true);
  });
});
