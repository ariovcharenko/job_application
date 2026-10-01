import { describe, expect, it } from "vitest";
import { validateResume } from "../resume/engine/validate";
import { parseSkillInventory } from "../resume/master/skills";
import { DEMO_EXPERIENCE, DEMO_JOBS } from "./data";
import { demoPool, isLocalHost, skillLines } from "./seed";
import { looksLikeJobPosting } from "../intake/analyze";

describe("demo data", () => {
  it("only loads on a local copy of the app", () => {
    expect(isLocalHost("localhost")).toBe(true);
    expect(isLocalHost("127.0.0.1")).toBe(true);
    expect(isLocalHost("job-copilot.vercel.app")).toBe(false);
  });

  it("has full job postings, so none shows as Incomplete", () => {
    for (const j of DEMO_JOBS) expect(looksLikeJobPosting(j.jd), j.signals.company).toBe(true);
  });

  it("reads the skills lines with commas inside parentheses kept together", () => {
    const lines = skillLines(DEMO_EXPERIENCE);
    expect(lines).toHaveLength(6);
    expect(lines.find((l) => l.category === "Cloud & DevOps")?.items).toContain("AWS (Lambda, SQS, S3)");
    expect(parseSkillInventory(DEMO_EXPERIENCE).length).toBeGreaterThan(20);
  });

  it.each(DEMO_JOBS.filter((j) => j.resume).map((j) => [j.signals.company, j] as const))("builds a resume for %s with no unverified facts and more than a page of content", (_c, job) => {
    const skills = [...job.signals.mustHaveSkills, ...job.signals.niceToHaveSkills];
    const r = validateResume(demoPool(DEMO_EXPERIENCE, skills), DEMO_EXPERIENCE, { jobSkills: skills });
    expect(r.flags.map((f) => f.message)).toEqual([]);
    expect(r.doc.experience.flatMap((e) => e.bullets).length).toBeGreaterThanOrEqual(15);
    expect(r.doc.projects?.length).toBe(2);
  });
});
