import { describe, expect, it } from "vitest";
import { MASTER } from "./__fixtures__/master";
import { autoBold, backfillFromExperience, copiedBullets, overlap } from "./backfill";
import type { ResumeDoc } from "./schema";
import { validateResume } from "./validate";
import { parseSkillInventory } from "../master/skills";

const base = (bullets: string[]): ResumeDoc => ({
  education: [],
  experience: [{ title: "Software Engineer Intern", company: "Brightloop", location: "Austin, TX", dates: "May 2026 - Aug 2026", bullets }],
  skills: [{ category: "Languages", items: ["TypeScript"] }],
  leadership: [],
  meta: { matchedKeywords: [], gaps: [], valuesReflected: [] },
});

describe("overlap", () => {
  it("scores a rewrite of the same bullet high and an unrelated one low", () => {
    expect(overlap("Shipped **6 production features** to an event platform", "Shipped 6 production features to Brightloop's event-hosting platform")).toBeGreaterThan(0.5);
    expect(overlap("Wrote Jest tests for every feature", "Shipped 6 production features to an event platform")).toBeLessThan(0.3);
  });
});

describe("backfillFromExperience", () => {
  it("adds the role's unused source bullets after the model's, and none it already said", () => {
    const doc = base(["Shipped **6 production features** to Brightloop's checkout and payments platform."]);
    const r = backfillFromExperience(doc, MASTER);
    const bullets = r.doc.experience[0].bullets;
    expect(bullets[0]).toBe(doc.experience[0].bullets[0]);
    expect(r.added).toBeGreaterThan(0);
    expect(bullets.filter((b) => /6 production features/.test(b))).toHaveLength(1);
  });

  it("never creates a flag: every added bullet is her own words", () => {
    const r = backfillFromExperience(base(["Shipped **6 production features** to Brightloop's checkout and payments platform."]), MASTER);
    expect(validateResume(r.doc, MASTER).flags).toEqual([]);
  });

  it("orders the added bullets by relevance", () => {
    const r = backfillFromExperience(base([]), MASTER, (t) => (/Jest/.test(t) ? 10 : 0));
    expect(r.doc.experience[0].bullets[0]).toMatch(/Jest/);
  });
});

describe("copiedBullets", () => {
  it("finds the bullets that are her source lines word for word, bold and casing aside", () => {
    const filled = backfillFromExperience(base(["Delivered **6 production features** across Brightloop's checkout and payments platform."]), MASTER).doc;
    const copied = copiedBullets(filled, MASTER);
    expect(copied.length).toBeGreaterThan(0);
    expect(copied.every((c) => c.entry === 0 && c.bullet >= 1)).toBe(true);
    expect(copiedBullets(base(["Wrote **Jest** tests for every checkout feature"]), MASTER)).toEqual([]);
  });
});

describe("autoBold", () => {
  it("bolds her technologies and the first real metric, at most three technologies", () => {
    const inv = parseSkillInventory(MASTER);
    const out = autoBold("Wrote unit, component, and contract tests using Jest and React Testing Library, keeping coverage near 30%.", inv, MASTER);
    expect(out).toContain("**Jest**");
    expect(out).toContain("**React Testing Library**");
    expect(out).toContain("**30%**");
    expect((out.match(/\*\*/g) ?? []).length / 2).toBeLessThanOrEqual(4);
  });
});
