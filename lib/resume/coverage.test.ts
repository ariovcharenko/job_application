import { describe, expect, it } from "vitest";
import { blankApplication } from "../tracker/blank";
import { jobFocusFor, jobSkills, skillCoverage, skillHits } from "./coverage";

describe("skill coverage", () => {
  it("uses the analyzed skills lists, without soft skills", () => {
    const app = {
      ...blankApplication(),
      fitBreakdown: JSON.stringify({ skills: { percent: 80, required: { have: ["React", "Python"], gap: ["Go"] }, preferred: { have: ["communication"], gap: [] } } }),
    };
    expect(jobSkills(app, "")).toEqual(["React", "Python", "Go"]);
  });

  it("measures how many of them a resume shows", () => {
    const c = skillCoverage(["React", "Python", "Go"], "Built **React** apps with Python. Let's go.");
    expect(c?.found).toEqual(["React", "Python"]);
    expect(c?.missing).toEqual(["Go"]);
    expect(c?.percent).toBe(67);
    expect(skillCoverage([], "anything")).toBeNull();
  });

  it("counts a short alias as shown when the page spells it out", () => {
    expect(skillCoverage(["TS", "JS"], "Languages: TypeScript, JavaScript")?.missing).toEqual([]);
  });
});

describe("jobFocusFor", () => {
  it("takes required skills as must-haves and preferred ones as nice-to-haves, without soft skills", () => {
    const app = {
      ...blankApplication(),
      role: "Frontend Engineer",
      jdText: "About the role\nBuild accessible web apps in React.",
      fitBreakdown: JSON.stringify({ skills: { percent: 80, required: { have: ["React"], gap: ["Vue"] }, preferred: { have: ["communication", "Jest"], gap: [] } } }),
    };
    const f = jobFocusFor(app, "");
    expect(f.family).toBe("Frontend/Web");
    expect(f.must).toEqual(["React", "Vue"]);
    expect(f.nice).toEqual(["Jest"]);
    expect(f.domains.map((d) => d.id)).toContain("accessibility");
  });

  it("uses the technologies the posting mentions when it was analyzed without skills lists", () => {
    const app = { ...blankApplication(), role: "Engineer", jdText: "We use Python, PostgreSQL, Docker and AWS every day." };
    expect(jobFocusFor(app, "").must).toEqual(expect.arrayContaining(["Python", "PostgreSQL"]));
  });
});

describe("skillHits", () => {
  it("counts the job's skills one bullet shows, for ranking bullets when the page is full", () => {
    const skills = ["Jest", "React", "Kubernetes", "Go"];
    expect(skillHits(skills, "Wrote Jest unit tests for React components")).toBe(2);
    expect(skillHits(skills, "Planned the go-live")).toBe(0);
    expect(skillHits([], "Anything")).toBe(0);
  });
});
