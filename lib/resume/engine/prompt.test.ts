import { describe, expect, it } from "vitest";
import { buildSystemPrompt, buildUserPrompt } from "./prompt";

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
});
