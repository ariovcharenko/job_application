import { describe, expect, it } from "vitest";
import { DEMO_EXPERIENCE } from "../demo/data";
import { skillsMatchPercent } from "../intake/decision";
import { applyConfirmations, confirmedForPrompt, placeChoices, preTailorGaps } from "./gaps";
import { hasSkill, parseSkillInventory, parseUsageNotes } from "./master/skills";
import { validateResume } from "./engine/validate";
import type { ResumeDoc } from "./engine/schema";

/** A saved analysis with these skills lists, as the job dialog stores it. */
const analyzed = (required: { have: string[]; gap: string[] }, preferred: { have: string[]; gap: string[] }) => ({
  fitBreakdown: JSON.stringify({ score: 0, verdict: "Maybe", factors: [], skills: skillsMatchPercent(required, preferred) }),
  jdText: "",
});

describe("preTailorGaps", () => {
  it("lists the job's skills her experience doesn't show, required first, then nice to have", () => {
    const app = analyzed({ have: ["Go"], gap: ["Kubernetes", "Rust"] }, { have: ["React"], gap: ["Kafka"] });
    expect(preTailorGaps(app, DEMO_EXPERIENCE)).toEqual([
      { skill: "Kubernetes", required: true },
      { skill: "Rust", required: true },
      { skill: "Kafka", required: false },
    ]);
  });

  it("re-checks against her experience now, so a skill she confirmed earlier is never asked again", () => {
    const app = analyzed({ have: [], gap: ["Kubernetes", "Rust"] }, { have: [], gap: [] });
    const later = applyConfirmations(DEMO_EXPERIENCE, [{ skill: "Rust", place: null, how: "" }]);
    expect(preTailorGaps(app, later).map((g) => g.skill)).toEqual(["Kubernetes"]);
  });

  it("drops soft skills and duplicates, and skills the analysis called gaps that she does have", () => {
    const app = analyzed({ have: [], gap: ["Communication", "Kubernetes", "kubernetes", "Docker"] }, { have: [], gap: [] });
    expect(preTailorGaps(app, DEMO_EXPERIENCE).map((g) => g.skill)).toEqual(["Kubernetes"]);
  });

  it("falls back to the technologies the posting mentions when there's no analysis", () => {
    const gaps = preTailorGaps({ fitBreakdown: "", jdText: "We build services in Go and Rust on Kubernetes." }, DEMO_EXPERIENCE);
    expect(gaps.map((g) => g.skill)).toEqual(expect.arrayContaining(["Rust", "Kubernetes"]));
    expect(gaps.map((g) => g.skill)).not.toContain("Go");
  });
});

describe("placeChoices", () => {
  it("offers every role and project in her experience", () => {
    const places = placeChoices(DEMO_EXPERIENCE);
    expect(places.map((p) => p.label)).toEqual([
      "Cobalt Payments (Software Engineer Intern)",
      "Lumen Health (Frontend Engineer Intern)",
      "UW Systems Lab (Undergraduate Research Assistant)",
      "University of Washington (Teaching Assistant, Data Structures)",
      "Trailhead",
      "ShelfLife",
    ]);
    expect(places[0].role).toEqual({ company: "Cobalt Payments", title: "Software Engineer Intern" });
  });
});

describe("applyConfirmations", () => {
  it("adds each confirmed skill to her skills list and ties a placed one to that exact role", () => {
    const shelf = placeChoices(DEMO_EXPERIENCE).find((p) => p.role.company === "ShelfLife")!;
    const m = applyConfirmations(DEMO_EXPERIENCE, [
      { skill: "Rust", place: null, how: "" },
      { skill: "Firebase", place: shelf, how: "stored scans in Firestore" },
    ]);
    const inventory = parseSkillInventory(m);
    expect(hasSkill("Rust", inventory, m)).toBe(true);
    expect(hasSkill("Firebase", inventory, m)).toBe(true);
    expect(parseUsageNotes(m)).toEqual([{ skill: "Firebase", where: "stored scans in Firestore", role: { company: "ShelfLife", title: "Hackathon project" } }]);
  });

  it("makes the validator accept the skill in the role she named, and only note it elsewhere", () => {
    const places = placeChoices(DEMO_EXPERIENCE);
    const shelf = places.find((p) => p.role.company === "ShelfLife")!;
    const m = applyConfirmations(DEMO_EXPERIENCE, [{ skill: "Firebase", place: shelf, how: "" }]);
    const doc: ResumeDoc = {
      education: [],
      experience: [{ title: "Software Engineer Intern", company: "Cobalt Payments", location: "Seattle, WA", dates: "Jun 2025 - Sep 2025", bullets: ["Stored refunds in **Firebase**"] }],
      projects: [{ title: "Hackathon project", company: "ShelfLife", location: "Seattle, WA", dates: "Oct 2024", bullets: ["Built an Android app in **Kotlin** with **Firebase** to track food expiry dates"] }],
      skills: [{ category: "Tools", items: ["Firebase"] }],
      leadership: [],
      meta: { matchedKeywords: [], gaps: [], valuesReflected: [] },
    };
    const flags = validateResume(doc, m).flags;
    expect(flags.filter((f) => f.target.section === "projects")).toEqual([]);
    expect(flags.filter((f) => f.target.section === "skills")).toEqual([]);
    expect(flags.filter((f) => f.target.section === "experience").map((f) => f.severity)).toEqual(["note"]);
  });

  it("changes nothing when she confirms nothing", () => {
    expect(applyConfirmations(DEMO_EXPERIENCE, [])).toBe(DEMO_EXPERIENCE);
  });
});

describe("confirmedForPrompt", () => {
  it("names where each skill goes, or Skills only", () => {
    const shelf = placeChoices(DEMO_EXPERIENCE).find((p) => p.role.company === "ShelfLife")!;
    expect(confirmedForPrompt([{ skill: "Rust", place: null, how: "" }, { skill: "Firebase", place: shelf, how: " stored scans " }])).toEqual([
      { skill: "Rust", where: null, how: "" },
      { skill: "Firebase", where: "ShelfLife", how: "stored scans" },
    ]);
  });
});
