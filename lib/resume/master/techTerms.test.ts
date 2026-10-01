import { describe, expect, it } from "vitest";
import { matchSkills, parseSkillInventory } from "./skills";
import { mentionsTerm, TECH_TERM_FAMILIES, TECH_TERMS } from "./techTerms";

describe("TECH_TERMS", () => {
  it("covers role families beyond software engineering, without repeats", () => {
    for (const t of ["Tableau", "Power BI", "Excel", "Hugging Face", "MLflow", "Helm", "Burp Suite", "Appium", "Jira", "Figma", "Framer", "Verilog"]) {
      expect(TECH_TERMS).toContain(t);
    }
    expect(new Set(TECH_TERMS).size).toBe(TECH_TERMS.length);
    expect(Object.keys(TECH_TERM_FAMILIES)).toEqual(expect.arrayContaining(["data", "ml", "cloudAndDevOps", "security", "qa", "product", "design", "embedded"]));
  });

  it("finds a Data Analyst posting's tools and matches them against a profile that lists them", () => {
    const jd = "Data Analyst. You will build dashboards in Tableau, write SQL against our warehouse and model scenarios in Excel.";
    const found = TECH_TERMS.filter((t) => mentionsTerm(jd, t));
    expect(found).toEqual(expect.arrayContaining(["Tableau", "SQL", "Excel"]));
    const master = "### Experience\n**Analyst | Acme | Remote | Jan 2024 - Present**\n- Built reports\n\n### Skills\n- **Tools:** Tableau, SQL, Excel";
    const m = matchSkills(found, parseSkillInventory(master), master);
    expect(m.gap).toEqual([]);
    expect(m.have.length).toBeGreaterThanOrEqual(3);
  });

  it("doesn't count English words that are also tool names", () => {
    expect(mentionsTerm("You excel at working with people", "Excel")).toBe(false);
    expect(mentionsTerm("Advanced Excel skills", "Excel")).toBe(true);
    expect(mentionsTerm("sketch out ideas", "Sketch")).toBe(false);
    expect(mentionsTerm("Tracked work in Jira", "Jira")).toBe(true);
    expect(mentionsTerm("a jira-like tool", "Jira")).toBe(false);
  });

  it("keeps Go, R and C case-sensitive", () => {
    expect(mentionsTerm("go live", "Go")).toBe(false);
    expect(mentionsTerm("r and python", "R")).toBe(false);
    expect(mentionsTerm("c or java", "C")).toBe(false);
    expect(mentionsTerm("R and Python", "R")).toBe(true);
  });
});

describe("mentionsTerm", () => {
  it("matches whole words, with symbols like C++ and Node.js", () => {
    expect(mentionsTerm("Strong C++ skills", "C++")).toBe(true);
    expect(mentionsTerm("Built on Node.js services", "Node.js")).toBe(true);
    expect(mentionsTerm("Experience with react and redux", "React")).toBe(true);
  });

  it("doesn't count ordinary words for short or ambiguous names", () => {
    expect(mentionsTerm("You will go above and beyond", "Go")).toBe(false);
    expect(mentionsTerm("rest assured", "REST")).toBe(false);
    expect(mentionsTerm("Written in Go and Rust", "Go")).toBe(true);
    expect(mentionsTerm("a swift response", "Swift")).toBe(false);
    expect(mentionsTerm("C and C++", "C")).toBe(true);
    expect(mentionsTerm("C++ only", "C")).toBe(false);
    expect(mentionsTerm("Swift and Objective-C", "C")).toBe(false);
    expect(mentionsTerm("our R&D team", "R")).toBe(false);
  });

  it("can require the term's own capitalization for any length", () => {
    expect(mentionsTerm("an express checkout", "Express", { exactCase: true })).toBe(false);
    expect(mentionsTerm("an API in Express", "Express", { exactCase: true })).toBe(true);
    expect(mentionsTerm("an express checkout", "Express")).toBe(true);
  });
});
