import { describe, expect, it } from "vitest";
import { boldOnlyTechAndNumbers, boldSpansTouch, capBoldSpans, dedupeSkills, fixTechCasing, MAX_SKILL_LINES, orderSkillLines, polishResume, separateBoldSpans, tidySkillLines } from "./polish";
import { fixBoldMarkers } from "./validate";
import type { ResumeDoc } from "./schema";

describe("fixTechCasing", () => {
  it("fixes the casing of well-known technologies written capitalized", () => {
    expect(fixTechCasing("Fixed a bug using Javascript and Typescript")).toBe("Fixed a bug using JavaScript and TypeScript");
    expect(fixTechCasing("**Postgresql** on **Aws**")).toBe("**PostgreSQL** on **AWS**");
  });
  it("leaves ordinary words, other names and short names alone", () => {
    expect(fixTechCasing("designed flows users react to")).toBe("designed flows users react to");
    expect(fixTechCasing("Moved data to Postgres")).toBe("Moved data to Postgres");
    expect(fixTechCasing("a swift rollout in Go")).toBe("a swift rollout in Go");
  });
});

describe("capBoldSpans", () => {
  it("keeps four spans, numbers first, then reading order", () => {
    const r = capBoldSpans("Built **React** and **Next.js** UI with **Tailwind**, **Jest** and **Prisma**, cutting time **~35%**");
    expect(r.changed).toBe(true);
    expect(r.text).toBe("Built **React** and **Next.js** UI with **Tailwind**, Jest and Prisma, cutting time **~35%**");
  });
  it("leaves bullets with four or fewer spans unchanged", () => {
    const t = "Shipped **6 production features** with **React** and **Jest**";
    expect(capBoldSpans(t)).toEqual({ text: t, changed: false });
  });
});

describe("dedupeSkills", () => {
  it("drops a skill already listed on an earlier line, and empty lines", () => {
    const r = dedupeSkills([
      { category: "Languages", items: ["TypeScript", "HTML/CSS"] },
      { category: "Frontend", items: ["React", "HTML/CSS"] },
      { category: "Other", items: ["Typescript"] },
    ]);
    expect(r.removed).toBe(2);
    expect(r.skills).toEqual([
      { category: "Languages", items: ["TypeScript", "HTML/CSS"] },
      { category: "Frontend", items: ["React"] },
    ]);
  });
});

describe("separateBoldSpans", () => {
  it("puts a space between bold spans that touch, and between bold and a word it runs into", () => {
    expect(separateBoldSpans("Built with **Java 17****Spring Boot**")).toBe("Built with **Java 17** **Spring Boot**");
    expect(separateBoldSpans("**Java 17**Spring and use**React**")).toBe("**Java 17** Spring and use **React**");
  });
  it("leaves punctuation and properly spaced spans alone", () => {
    const t = "**React**, **Next.js** and **TypeScript** (**~35%**)";
    expect(separateBoldSpans(t)).toBe(t);
  });
});

describe("fixBoldMarkers (validate.ts)", () => {
  it("keeps the space between two adjacent bold spans (the Java 17Spring Boot bug)", () => {
    expect(fixBoldMarkers("**Java 17** **Spring Boot** backend")).toBe("**Java 17** **Spring Boot** backend");
    expect(fixBoldMarkers("an **** empty span")).toBe("an  empty span");
  });
});

describe("boldOnlyTechAndNumbers", () => {
  it("unbolds phrases that are neither a technology nor a number", () => {
    expect(boldOnlyTechAndNumbers("**Led** an **end-to-end** rewrite in **React** for **80+ users**", []).text).toBe(
      "Led an end-to-end rewrite in **React** for **80+ users**",
    );
  });
  it("keeps a technology from her skills list", () => {
    expect(boldOnlyTechAndNumbers("Built on **Prisma ORM**", ["Prisma ORM"]).changed).toBe(false);
  });
});

describe("skills lines", () => {
  it("drops non-technical lines and merges Additional into Tools", () => {
    const r = tidySkillLines([
      { category: "Languages", items: ["TypeScript"] },
      { category: "Collaboration", items: ["Agile"] },
      { category: "Tools", items: ["Git"] },
      { category: "Additional", items: ["Figma"] },
    ]);
    expect(r.skills).toEqual([
      { category: "Languages", items: ["TypeScript"] },
      { category: "Tools", items: ["Git", "Figma"] },
    ]);
  });
  it("orders lines by the job's skills and keeps at most six", () => {
    const lines = ["A", "B", "C", "D", "E", "F", "G"].map((c, i) => ({ category: c, items: [`Skill${i}`] }));
    lines[6].items = ["Kubernetes"];
    const out = orderSkillLines(lines, ["Kubernetes"]);
    expect(out[0].category).toBe("G");
    expect(out).toHaveLength(MAX_SKILL_LINES);
  });
});

describe("polishResume", () => {
  const doc: ResumeDoc = {
    education: [],
    experience: [
      {
        title: "SWE",
        company: "Acme",
        location: "",
        dates: "",
        bullets: ["Built **Java 17** **Spring Boot**, **React**, **Docker**, **Redis** and **Jest** in Javascript for **80+ users**", "**Owned** the **Java 17****Spring Boot** API"],
      },
    ],
    skills: [
      { category: "Languages", items: ["Javascript"] },
      { category: "Web", items: ["JavaScript"] },
    ],
    leadership: [],
    meta: { matchedKeywords: [], gaps: [], valuesReflected: [] },
  };

  it("applies all fixes and reports them", () => {
    const r = polishResume(doc);
    expect(r.doc.experience[0].bullets[0]).toBe("Built **Java 17** **Spring Boot**, **React**, Docker, Redis and Jest in JavaScript for **80+ users**");
    expect(r.doc.experience[0].bullets[1]).toBe("Owned the **Java 17** **Spring Boot** API");
    expect(r.doc.skills).toEqual([{ category: "Languages", items: ["JavaScript"] }]);
  });

  it("never leaves two bold spans touching without a space", () => {
    const r = polishResume(doc);
    for (const b of r.doc.experience.flatMap((e) => e.bullets)) expect(boldSpansTouch(b)).toBe(false);
  });
});
