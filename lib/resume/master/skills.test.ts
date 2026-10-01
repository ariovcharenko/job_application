import { describe, expect, it } from "vitest";
import { MASTER } from "../engine/__fixtures__/master";
import { hasSkill, matchSkills, normalizeSkill, parseSkillInventory } from "./skills";
import { appendSkillToMaster, dropSoftSkills, isSoftSkill } from "./skills";

const inventory = parseSkillInventory(MASTER);
const has = (s: string) => hasSkill(s, inventory, MASTER);

describe("parseSkillInventory", () => {
  it("reads every skills line under the skills heading, not bullets elsewhere", () => {
    expect(inventory).toEqual(expect.arrayContaining(["TypeScript", "React Native", "PostgreSQL", "Jest", "OpenAI API"]));
    expect(inventory).not.toContain("Relevant coursework");
  });

  it("expands a parenthesized list but drops a parenthesized note", () => {
    expect(inventory).toEqual(expect.arrayContaining(["AWS", "AWS Elastic Beanstalk", "AWS S3", "S3"]));
    expect(inventory).toContain("C++");
    expect(inventory.some((i) => i.includes("CodeMirror"))).toBe(false);
  });
});

describe("hasSkill", () => {
  it("accepts synonyms and the job's own spelling of a skill she has", () => {
    expect(has("Postgres")).toBe(true);
    expect(has("RESTful APIs")).toBe(true);
    expect(has("node")).toBe(true);
    expect(has("RESTful web services")).toBe(true);
    expect(has("REST services")).toBe(true);
  });

  it("accepts a general skill implied by a specific one", () => {
    expect(has("SQL")).toBe(true);
    expect(has("unit testing")).toBe(true);
  });

  it("finds tools named only in bullets", () => {
    expect(has("k6")).toBe(true);
  });

  it("rejects skills she doesn't have, including lookalikes", () => {
    expect(has("Kubernetes")).toBe(false);
    expect(has("AWS Lambda")).toBe(false);
    expect(has("Rust")).toBe(false);
    expect(hasSkill("Java", ["JavaScript"], "")).toBe(false);
  });
});

describe("hasSkill with vendor prefixes and parentheses", () => {
  it("strips Amazon / AWS / Google Cloud before matching, but not into a lookalike", () => {
    expect(has("Amazon S3")).toBe(true);
    expect(has("AWS S3")).toBe(true);
    expect(has("Amazon Web Services")).toBe(true);
    expect(has("AWS Lambda")).toBe(false);
    expect(has("Amazon Redshift")).toBe(false);
  });

  it("accepts \"Outer (Inner)\" when either part is a skill she has", () => {
    expect(has("Large Language Models (LLMs)")).toBe(true);
    expect(has("Kubernetes (K8s)")).toBe(false);
  });
});

describe("hasSkill free-text fallback", () => {
  it("only counts free text from Experience, Projects or Skills sections", () => {
    expect(has("Robotics Club")).toBe(false); // leadership
    expect(has("Grafana")).toBe(true);
    const master = "### Projects\n- Built a Terraform module\n\n### Leadership\n- Captain, Chess Club";
    expect(hasSkill("Terraform", [], master)).toBe(true);
    expect(hasSkill("Chess Club", [], master)).toBe(false);
  });

  it("uses the whole text when it has no section headings (e.g. a resume's text)", () => {
    expect(hasSkill("Terraform", [], "Built a Terraform module")).toBe(true);
  });
});

describe("matchSkills", () => {
  it("splits job skills into have and gap, de-duplicated", () => {
    expect(matchSkills(["React", "react", "Kubernetes", "TypeScript"], inventory, MASTER)).toEqual({
      have: ["React", "TypeScript"],
      gap: ["Kubernetes"],
    });
  });

  it("normalizes case and trailing punctuation", () => {
    expect(normalizeSkill(" Postgres. ")).toBe("postgresql");
  });
});

describe("soft skills", () => {
  it("recognizes traits that aren't technical skills", () => {
    for (const s of ["communication", "Excellent communication", "attention to detail", "positive attitude", "teamwork", "Collaboration"]) {
      expect(isSoftSkill(s)).toBe(true);
    }
    for (const s of ["Swift", "React", "inter-process communication", "network protocols", "systems knowledge"]) {
      expect(isSoftSkill(s)).toBe(false);
    }
  });
  it("drops them from both sides of a match", () => {
    expect(dropSoftSkills({ have: ["React", "communication"], gap: ["Swift", "attention to detail"] })).toEqual({ have: ["React"], gap: ["Swift"] });
  });
});

describe("hasSkill with short names", () => {
  it("doesn't count the ordinary word 'go' as the Go language", () => {
    const master = "### Experience\n- Built tools teams go to daily\n\n### Skills\n- Languages: Python";
    expect(hasSkill("Go", parseSkillInventory(master), master)).toBe(false);
    const withGo = "### Skills\n- Languages: Python, Go";
    expect(hasSkill("Go", parseSkillInventory(withGo), withGo)).toBe(true);
  });
});

describe("hasSkill with short aliases", () => {
  it("finds a short alias (JS, TS, LLM, k8s) written out in full in free text", () => {
    const text = "Built a JavaScript and TypeScript app on Kubernetes using LLMs.";
    expect(hasSkill("JS", [], text)).toBe(true);
    expect(hasSkill("TS", [], text)).toBe(true);
    expect(hasSkill("LLM", [], text)).toBe(true);
    expect(hasSkill("k8s", [], text)).toBe(true);
    // Still case-sensitive for short names that aren't aliases.
    expect(hasSkill("Go", [], "teams go to it")).toBe(false);
  });
});

describe("appendSkillToMaster", () => {
  const master = "### Experience\n**A | B | C | May 2025 - Aug 2025**\n\n### Skills\n- **Languages:** Python\n\n### Leadership\n- Club";
  it("adds an Additional line inside the skills section, then extends it", () => {
    const once = appendSkillToMaster(master, "Kubernetes");
    expect(once).toContain("- **Languages:** Python\n- **Additional:** Kubernetes\n\n### Leadership");
    expect(parseSkillInventory(once)).toContain("Kubernetes");
    const twice = appendSkillToMaster(once, "Terraform");
    expect(twice).toContain("- **Additional:** Kubernetes, Terraform");
    expect(parseSkillInventory(twice)).toEqual(expect.arrayContaining(["Kubernetes", "Terraform"]));
  });
  it("does nothing for a skill already listed, and creates a section if there is none", () => {
    expect(appendSkillToMaster(master, "python")).toBe(master);
    expect(appendSkillToMaster("### Experience", "Go")).toContain("### Skills inventory\n- **Additional:** Go");
  });
});

describe("vocabulary beyond software engineering", () => {
  const profile = (skills: string) => `### Skills\n- **All:** ${skills}`;
  const hasIn = (skill: string, skills: string) => hasSkill(skill, parseSkillInventory(profile(skills)), profile(skills));

  it("normalizes common alternate spellings", () => {
    expect(normalizeSkill("sklearn")).toBe("scikit-learn");
    expect(normalizeSkill("PowerBI")).toBe("power bi");
    expect(normalizeSkill("GitLab CI/CD")).toBe("gitlab ci");
    expect(normalizeSkill("Pen testing")).toBe("penetration testing");
    expect(hasIn("sklearn", "scikit-learn, Pandas")).toBe(true);
    expect(hasIn("Microsoft Power BI", "Power BI")).toBe(true);
  });

  it("EKS implies AWS and Kubernetes, GKE implies GCP", () => {
    expect(hasIn("AWS", "EKS")).toBe(true);
    expect(hasIn("Kubernetes", "EKS")).toBe(true);
    expect(hasIn("GCP", "GKE")).toBe(true);
    expect(hasIn("Azure", "EKS")).toBe(false);
  });

  it("LLMs are implied by the OpenAI or Anthropic API or LangChain", () => {
    expect(hasIn("LLMs", "Anthropic API")).toBe(true);
    expect(hasIn("Large language models", "LangChain")).toBe(true);
    expect(hasIn("LLMs", "Pandas")).toBe(false);
  });

  it("general skills match any common specific tool, including qualified names", () => {
    expect(hasIn("ORM", "Prisma ORM")).toBe(true);
    expect(hasIn("ORM", "JPA/Hibernate")).toBe(true);
    expect(hasIn("ORM", "SQLAlchemy")).toBe(true);
    expect(hasIn("Data visualization", "Tableau")).toBe(true);
    expect(hasIn("Infrastructure as code", "Pulumi")).toBe(true);
    expect(hasIn("Unit testing", "pytest")).toBe(true);
    expect(hasIn("SQL", "Snowflake")).toBe(true);
    expect(hasIn("NoSQL", "PostgreSQL")).toBe(false);
  });
});

describe("usage notes for confirmed skills", () => {
  const base = "### Skills inventory\n- **Languages:** TypeScript\n";
  it("adds, replaces and reads notes, and never turns them into skills lines", async () => {
    const { appendUsageNote, parseUsageNotes } = await import("./skills");
    let m = appendUsageNote(base, "Kotlin", "built an Android app at Brightloop");
    m = appendUsageNote(m, "Rust", "class project");
    m = appendUsageNote(m, "Kotlin", "Android app at Brightloop, 2 screens");
    expect(parseUsageNotes(m)).toEqual([
      { skill: "Kotlin", where: "Android app at Brightloop, 2 screens" },
      { skill: "Rust", where: "class project" },
    ]);
    expect(parseSkillInventory(m)).toEqual(["TypeScript"]);
  });
});
