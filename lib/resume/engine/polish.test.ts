import { describe, expect, it } from "vitest";
import { capBoldSpans, dedupeSkills, fixTechCasing, polishResume } from "./polish";
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

describe("polishResume", () => {
  it("applies all fixes and reports them", () => {
    const doc: ResumeDoc = {
      education: [],
      experience: [{ title: "SWE", company: "Acme", location: "", dates: "", bullets: ["Built **a** **b** **c** **d** **e** in Javascript"] }],
      skills: [
        { category: "Languages", items: ["Javascript"] },
        { category: "Web", items: ["JavaScript"] },
      ],
      leadership: [],
      meta: { matchedKeywords: [], gaps: [], valuesReflected: [] },
    };
    const r = polishResume(doc);
    expect(r.doc.experience[0].bullets[0]).toBe("Built **a** **b** **c** **d** e in JavaScript");
    expect(r.doc.skills).toEqual([{ category: "Languages", items: ["JavaScript"] }]);
    expect(r.notes).toHaveLength(2);
  });
});
