import { describe, expect, it } from "vitest";
import { MASTER } from "./__fixtures__/master";
import type { ResumeDoc, ResumeHeader } from "./schema";
import { linkOk, verifyResume } from "./verify";

const header: ResumeHeader = {
  name: "Alex Rivera",
  location: "Austin, TX",
  links: [
    { text: "alex.rivera@example.com", url: "mailto:alex.rivera@example.com" },
    { text: "LinkedIn", url: "https://www.linkedin.com/in/alex-rivera/" },
  ],
};
const doc = (over: Partial<ResumeDoc> = {}): ResumeDoc => ({
  education: [],
  experience: [
    {
      title: "Software Engineer Intern",
      company: "Brightloop",
      location: "Austin, TX",
      dates: "May 2026 - Aug 2026",
      bullets: ["Shipped **6 production features** with **Jest** tests"],
    },
  ],
  skills: [{ category: "Languages", items: ["TypeScript", "Java"] }],
  leadership: [],
  meta: { matchedKeywords: [], gaps: [], valuesReflected: [] },
  ...over,
});
const failing = (checks: ReturnType<typeof verifyResume>) => checks.filter((c) => !c.ok).map((c) => c.id);

describe("verifyResume", () => {
  it("passes a clean, full page", () => {
    expect(failing(verifyResume({ header, doc: doc(), fits: true, fill: 0.96, master: MASTER }))).toEqual([]);
  });

  it("fails an underfilled or overflowing page", () => {
    expect(failing(verifyResume({ header, doc: doc(), fits: true, fill: 0.75, master: MASTER }))).toEqual(["fill"]);
    expect(failing(verifyResume({ header, doc: doc(), fits: false, fill: 1.1, master: MASTER }))).toEqual(["one-page", "fill"]);
  });

  it("catches dashes, touching bold, unlisted skills, invented numbers and wrong dates", () => {
    const d = doc({
      experience: [{ ...doc().experience[0], dates: "May 2026 – Present", bullets: ["Built **Java 17****Spring Boot** for **500 users**"] }],
      skills: [{ category: "Languages", items: ["Kubernetes", "TypeScript"] }],
    });
    expect(failing(verifyResume({ header, doc: d, fits: true, fill: 0.96, master: MASTER }))).toEqual(["dashes", "bold", "skills", "numbers", "dates"]);
  });

  it("checks header links", () => {
    expect(linkOk("mailto:alex.rivera@example.com")).toBe(true);
    expect(linkOk("https://github.com/alexrivera")).toBe(true);
    expect(linkOk("github.com/alexrivera")).toBe(false);
    expect(linkOk("javascript:alert(1)")).toBe(false);
    const bad = { ...header, links: [{ text: "GitHub", url: "github.com/alexrivera" }] };
    expect(failing(verifyResume({ header: bad, doc: doc(), fits: true, fill: 0.96, master: MASTER }))).toEqual(["links"]);
  });
});

describe("header links", () => {
  it("shows each URL once, exactly as saved", async () => {
    const { buildHeader } = await import("./index");
    const { DEFAULT_PROFILE } = await import("../../defaults");
    const h = buildHeader({
      ...DEFAULT_PROFILE,
      fullName: "Alex Rivera",
      email: "alex.rivera@example.com",
      github: "https://github.com/alexrivera",
      portfolio: "https://github.com/alexrivera/",
    });
    expect(h.links.map((l) => l.url)).toEqual(["mailto:alex.rivera@example.com", "https://github.com/alexrivera"]);
  });
});

describe("education lines", () => {
  it("keeps a coursework line only when the experience lists coursework", async () => {
    const { validateResume } = await import("./validate");
    const d = (): ResumeDoc => ({ ...doc(), education: [{ school: "Lakeside University", location: "Austin, TX", degree: "Bachelor of Computer Science", dates: "", bullets: ["Relevant coursework: Machine Learning"] }] });
    expect(validateResume(d(), MASTER).doc.education[0].bullets).toHaveLength(1);
    const noCourses = MASTER.replace(/^- Relevant coursework.*$/m, "");
    expect(validateResume(d(), noCourses).doc.education[0].bullets).toEqual([]);
  });
});
