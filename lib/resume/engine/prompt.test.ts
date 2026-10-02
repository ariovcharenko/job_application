import { describe, expect, it } from "vitest";
import { DEMO_EXPERIENCE, DEMO_JOBS } from "../../demo/data";
import { MASTER } from "./__fixtures__/master";
import { buildJobFocus } from "./focus";
import { buildBrief, buildSystemPrompt, buildUserPrompt, confirmedLines } from "./prompt";

describe("buildSystemPrompt", () => {
  const p = buildSystemPrompt("MASTER");

  it("says different products in one category are not synonyms", () => {
    expect(p).toMatch(/MySQL is not SQL Server/);
    expect(p).toMatch(/React is not Vue/);
  });

  it("covers alt titles and number bolding", () => {
    expect(p).toMatch(/alt\. title/);
    expect(p).toMatch(/at most 4 words/);
  });

  it("asks for the final page written to the plan, not more than fits", () => {
    expect(p).not.toMatch(/Give more than fits/);
    expect(p).not.toMatch(/never stop short/);
    expect(p).toMatch(/write the final one-page resume/);
    expect(p).toMatch(/Follow the PAGE PLAN/);
  });

  it("keeps every skill: never drops one to save space", () => {
    expect(p).toMatch(/keep EVERY skill from the MASTER PROFILE's skills inventory/);
    expect(p).toMatch(/Never drop a skill to save space/);
    expect(p).not.toMatch(/Drop skills that add nothing/);
  });

  it("keeps her core quality rules in a short list", () => {
    expect(p).toMatch(/no opening verb more than twice/i);
    expect(p).toMatch(/Action \+ what \+ technologies \+ result/);
    expect(p).toMatch(/No inflation/);
    expect(p).toMatch(/Usage notes/);
    expect(p).toMatch(/Kotlin @ ShelfLife \| Hackathon project/);
    // Far shorter than the old ~11k-character rule list.
    expect(p.length).toBeLessThan(6000);
  });

  it("stays the same for every job, so it can be prompt-cached", () => {
    expect(buildSystemPrompt("MASTER")).toBe(p);
  });

  it("leaves fonts and paper size to code, and has no em or en dashes", () => {
    expect(p).not.toMatch(/US Letter|serif/);
    expect(p).not.toMatch(/[\u2013\u2014]/);
  });
});

describe("buildUserPrompt", () => {
  it("works with just company and job text", () => {
    const p = buildUserPrompt("Acme", "We use React.");
    expect(p).toContain("Company: Acme");
    expect(p).not.toContain("GAPS");
  });

  it("lists the job skills she has and the gaps when given", () => {
    const p = buildUserPrompt("Acme", "We use React.", { have: ["React", "Postgres"], gaps: ["Kubernetes"] });
    expect(p).toContain("Job skills the candidate HAS (use these exact spellings; the most important ones belong near the top): React, Postgres");
    expect(p).toContain("GAPS (never mention anywhere, including bullets): Kubernetes");
  });

  it("adds the brief after the job skills when given", () => {
    const p = buildUserPrompt("Acme", "We use React.", { have: ["React"], gaps: [] }, "JOB FOCUS (x):\n- Kind of role: Frontend/Web");
    expect(p.indexOf("JOB FOCUS")).toBeGreaterThan(p.indexOf("GAPS"));
    expect(p).toMatch(/Write the tailored one-page resume/);
  });
});

describe("confirmedLines", () => {
  it("lists what she confirmed before tailoring, with where, and is empty when she confirmed nothing", () => {
    expect(confirmedLines([])).toBe("");
    const text = confirmedLines([
      { skill: "Rust", where: null, how: "" },
      { skill: "Kotlin", where: "ShelfLife", how: "" },
    ]);
    expect(text).toMatch(/^SKILLS THE CANDIDATE JUST CONFIRMED/);
    expect(text).toContain("- Rust: Skills section only.");
    expect(text).toContain("- Kotlin: used in ShelfLife. Show it in that entry's bullets, saying only that");
    expect(buildUserPrompt("Acme", "x", undefined, "", [{ skill: "Rust", where: null, how: "" }])).toContain("- Rust: Skills section only.");
  });
});

describe("buildBrief", () => {
  const focusOf = (company: string) => {
    const j = DEMO_JOBS.find((x) => x.signals.company === company)!;
    return buildJobFocus({ role: j.signals.role, jdText: j.jd, must: j.signals.mustHaveSkills, nice: j.signals.niceToHaveSkills });
  };

  it("reads the job and gives a page plan: which roles, how many bullets each", () => {
    const brief = buildBrief(DEMO_EXPERIENCE, focusOf("Lumen Health"));
    expect(brief).toMatch(/Kind of role: Frontend\/Web/);
    expect(brief).toMatch(/What this team works on: front end/);
    expect(brief).toMatch(/PAGE PLAN/);
    expect(brief).toMatch(/1\. Lumen Health \(Frontend Engineer Intern\): \d bullets\. Shows React, TypeScript, Jest/);
    expect(brief).toMatch(/reverse-chronological/);
    expect(brief).toMatch(/A line holds about \d+ characters/);
    // The teaching role gives way for an engineering job.
    expect(brief).not.toMatch(/Teaching Assistant/);
  });

  it("puts the payments role first, with the most bullets, for the payments job", () => {
    const brief = buildBrief(DEMO_EXPERIENCE, focusOf("Cobalt Payments"));
    expect(brief).toMatch(/1\. Cobalt Payments \(Software Engineer Intern\): 6 bullets\. Shows Go, PostgreSQL, AWS/);
    expect(brief).toMatch(/What this team works on: payments/);
  });

  it("keeps gap skills out of the lists when the have list is given", () => {
    expect(buildBrief(DEMO_EXPERIENCE, focusOf("Pinecrest Robotics"), [])).not.toMatch(/Rust/);
  });

  it("suggests her alternate title when it fits the job better", () => {
    const design = buildJobFocus({ role: "Product Designer", jdText: "", must: [] });
    expect(buildBrief(MASTER, design)).toMatch(/Use these titles for this job: "Product & UX Engineer" at/);
  });

  it("still gives a page plan without a job focus", () => {
    const brief = buildBrief(DEMO_EXPERIENCE);
    expect(brief).not.toMatch(/JOB FOCUS/);
    expect(brief).toMatch(/PAGE PLAN/);
  });

  it("has no em or en dashes", () => {
    for (const j of DEMO_JOBS) expect(buildBrief(DEMO_EXPERIENCE, focusOf(j.signals.company))).not.toMatch(/[\u2013\u2014]/);
  });
});
