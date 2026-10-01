import { describe, expect, it } from "vitest";
import { verdictFor } from "../intake/decision";
import { parseMasterExperiences } from "../resume/master/experiences";
import { parseSkillInventory } from "../resume/master/skills";
import { ResumeDocSchema } from "../resume/engine/schema";
import { validateResume } from "../resume/engine/validate";
import { db } from "../db";
import { EXAMPLE_EXPERIENCE, EXAMPLE_RESUME } from "./fixture";
import { runExample } from "./run";

describe("/example fixture", () => {
  it("is an Apply with the real assessment code", async () => {
    const a = await runExample();
    expect(a.decision.canApply).toBe(true);
    expect(a.decision.failed).toHaveLength(0);
    expect(a.skills?.percent).toBe(100);
    expect(verdictFor(a.decision, a.skills?.percent ?? null)).toBe("apply");
  });

  it("shows no sponsorship or OPT rows for a candidate who doesn't need sponsorship", async () => {
    const a = await runExample();
    const keys = a.criteria.map((c) => c.key);
    expect(keys).not.toContain("sponsorship");
    expect(keys).not.toContain("opt");
  });

  it("has an experience the parsers read, and a resume with no unverified facts", () => {
    expect(parseMasterExperiences(EXAMPLE_EXPERIENCE).length).toBeGreaterThan(0);
    expect(parseSkillInventory(EXAMPLE_EXPERIENCE).length).toBeGreaterThan(0);
    expect(() => ResumeDocSchema.parse(EXAMPLE_RESUME)).not.toThrow();
    expect(validateResume(EXAMPLE_RESUME, EXAMPLE_EXPERIENCE).flags).toEqual([]);
  });

  it("writes nothing to the database", async () => {
    await Promise.all(db.tables.map((t) => t.clear()));
    await runExample();
    const counts = await Promise.all(db.tables.map((t) => t.count()));
    expect(counts.every((n) => n === 0)).toBe(true);
  });
});
