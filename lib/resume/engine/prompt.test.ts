import { describe, expect, it } from "vitest";
import { DEMO_EXPERIENCE, DEMO_JOBS } from "../../demo/data";
import { MASTER } from "./__fixtures__/master";
import { buildJobFocus } from "./focus";
import { buildFocusBrief, buildSystemPrompt, buildUserPrompt } from "./prompt";

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

  it("asks for more than fits, ranked, instead of a small fixed budget", () => {
    expect(p).not.toMatch(/12 to 16 bullets/);
    expect(p).toMatch(/Give more than fits, ranked/);
    expect(p).toMatch(/include every bullet from that role.s MASTER PROFILE entry/);
    expect(p).toMatch(/3 to 4 experiences/);
    expect(p).toMatch(/never stop short/);
  });

  it("keeps her quality rules", () => {
    expect(p).toMatch(/Always include the most recent real production role/);
    expect(p).toMatch(/user research/);
    expect(p).toMatch(/no opening verb more than twice/i);
    expect(p).toMatch(/action \+ what \+ technologies \+ measurable result/);
    expect(p).toMatch(/"ownership" becomes "owned end-to-end"/);
    expect(p).toMatch(/top 3 required skills/);
    expect(p).toMatch(/At least 70%/);
    expect(p).toMatch(/Keep 5 to 6 lines/);
    expect(p).toMatch(/Never stretch/);
    expect(p).toMatch(/No coursework line/);
    expect(p).toMatch(/job-matched skills first/);
    expect(p).toMatch(/only if space remains/);
  });

  it("stays the same for every job, so it can be prompt-cached", () => {
    expect(buildSystemPrompt("MASTER")).toBe(p);
  });

  it("gives generic role-family guidance instead of naming one candidate's role types", () => {
    expect(p).toMatch(/Match the role family/);
    expect(p).not.toMatch(/product\/UX-leaning|AI\/ML-leaning/);
  });

  it("leaves fonts and paper size to code", () => {
    expect(p).not.toMatch(/US Letter|serif/);
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

  it("adds the job focus after the job skills when given", () => {
    const p = buildUserPrompt("Acme", "We use React.", { have: ["React"], gaps: [] }, "JOB FOCUS (x):\n- Kind of role: Frontend/Web");
    expect(p.indexOf("JOB FOCUS")).toBeGreaterThan(p.indexOf("GAPS"));
    expect(p).toMatch(/Tailor the resume to this role/);
  });
});

describe("buildFocusBrief", () => {
  const focusOf = (company: string) => {
    const j = DEMO_JOBS.find((x) => x.signals.company === company)!;
    return buildJobFocus({ role: j.signals.role, jdText: j.jd, must: j.signals.mustHaveSkills, nice: j.signals.niceToHaveSkills });
  };

  it("ranks her experiences for the job and asks for every bullet of a relevant role, rewritten", () => {
    const brief = buildFocusBrief(focusOf("Lumen Health"), DEMO_EXPERIENCE);
    expect(brief).toMatch(/Kind of role: Frontend\/Web/);
    expect(brief).toMatch(/What this team works on: front end/);
    expect(brief).toMatch(/1\. Lumen Health \(Frontend Engineer Intern\): shows React, TypeScript, Jest/);
    expect(brief).toMatch(/Rewrite all 5 of its bullets/);
    expect(brief).toMatch(/reverse-chronological/);
    // The teaching role ranks last for an engineering job.
    expect(brief).toMatch(/4\. University of Washington \(Teaching Assistant, Data Structures\)[^\n]*Least relevant/);
    expect(brief).toMatch(/Projects, most relevant first: Trailhead/);
  });

  it("puts the payments role first for the payments job", () => {
    const brief = buildFocusBrief(focusOf("Cobalt Payments"), DEMO_EXPERIENCE);
    expect(brief).toMatch(/1\. Cobalt Payments \(Software Engineer Intern\): shows Go, PostgreSQL, AWS/);
    expect(brief).toMatch(/What this team works on: payments/);
  });

  it("keeps gap skills out of the must-have list when the have list is given", () => {
    expect(buildFocusBrief(focusOf("Pinecrest Robotics"), DEMO_EXPERIENCE, [])).not.toMatch(/Rust/);
  });

  it("suggests her alternate title when it fits the job better", () => {
    const design = buildJobFocus({ role: "Product Designer", jdText: "", must: [] });
    expect(buildFocusBrief(design, MASTER)).toContain('Use the title "Product & UX Engineer" for this job.');
  });

  it("has no em or en dashes", () => {
    for (const j of DEMO_JOBS) expect(buildFocusBrief(focusOf(j.signals.company), DEMO_EXPERIENCE)).not.toMatch(/[–—]/);
  });
});
