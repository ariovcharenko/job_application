import { describe, expect, it } from "vitest";
import { buildJobFocus } from "./focus";
import type { ResumeDoc } from "./schema";
import { fitToPage } from "./trim";

// The fit step with a job focus (focus.ts). Same fake page as trim.test.ts: every heading and
// bullet one line, a role two header lines, so each test says exactly how much room there is.
function lines(d: ResumeDoc): number {
  let n = 2;
  if (d.experience.length) n += 1 + d.experience.reduce((s, e) => s + 2 + e.bullets.length, 0);
  if (d.projects?.length) n += 1 + d.projects.reduce((s, e) => s + 2 + e.bullets.length, 0);
  if (d.skills.length) n += 1 + d.skills.length;
  if (d.leadership.length) n += 1 + d.leadership.length;
  return n;
}
const page = (capacity: number) => (d: ResumeDoc) => lines(d) / capacity;
const exact = { limit: 1, fillTarget: 0.9 };
const role = (company: string, title: string, dates: string, bullets: string[]) => ({ title, company, location: "", dates, bullets });
const doc = (over: Partial<ResumeDoc>): ResumeDoc => ({
  education: [],
  experience: [],
  skills: [],
  leadership: [],
  meta: { matchedKeywords: [], gaps: [], valuesReflected: [] },
  ...over,
});

const focus = buildJobFocus({
  role: "Software Engineer, Payments",
  jdText: "About the role\nBuild payout APIs in Go and PostgreSQL.",
  must: ["Go", "PostgreSQL"],
});

describe("fitToPage with a job focus", () => {
  it("drops a less relevant fourth role before a project that shows the job's stack", () => {
    const d = doc({
      experience: [
        role("Pay", "Software Engineer Intern", "Jun 2025 - Sep 2025", ["Built payouts in **Go**", "Tuned **PostgreSQL** queries", "Wrote payout docs"]),
        role("Web", "Frontend Intern", "Jun 2024 - Sep 2024", ["Built a **Go** API for the site", "Styled pages", "Fixed the layout"]),
        role("Lab", "Research Assistant", "Jan 2025 - Jun 2025", ["Ran **PostgreSQL** benchmarks", "Wrote a paper", "Gave a talk"]),
        role("School", "Teaching Assistant", "Sep 2024 - Jun 2026", ["Led sections", "Graded homework", "Held office hours"]),
      ],
      projects: [role("Ledger", "Personal project", "2025", ["Built a ledger in **Go** and **PostgreSQL**"])],
    }); // 2 + (1 + 4 x 5) + (1 + 3) = 27 lines
    const r = fitToPage(d, page(22), { ...exact, focus });
    expect(r.doc.experience.map((e) => e.company)).toEqual(["Pay", "Web", "Lab"]);
    expect(r.doc.projects?.map((p) => p.company)).toEqual(["Ledger"]);
    expect(r.leftOffEntries).toEqual([{ kind: "role", title: "Teaching Assistant", company: "School" }]);
  });

  it("cuts a role's off-topic bullet before a project that shows the job's stack", () => {
    const d = doc({
      experience: [
        role("Pay", "Software Engineer Intern", "Jun 2025 - Sep 2025", [
          "Built payouts in **Go**",
          "Tuned **PostgreSQL** queries",
          "Wrote **Go** tests",
          "Organized the team offsite",
        ]),
      ],
      projects: [role("Ledger", "Personal project", "2025", ["Built a ledger in **Go** and **PostgreSQL**", "Load-tested its **Go** payout API"])],
    }); // 2 + (1 + 6) + (1 + 4) = 14 lines
    const r = fitToPage(d, page(13), { ...exact, focus });
    expect(r.doc.experience[0].bullets).not.toContain("Organized the team offsite");
    expect(r.doc.projects?.[0].bullets).toHaveLength(2);
    expect(r.leftOffEntries).toEqual([]);
  });

  it("gives the role that shows the job the most bullets", () => {
    const d = doc({
      experience: [
        role("Web", "Frontend Intern", "Jun 2025 - Sep 2025", ["Styled pages", "Fixed the layout", "Wrote copy", "Ran a survey", "Made icons"]),
        role("Pay", "Software Engineer Intern", "Jun 2024 - Sep 2024", ["Built payouts in **Go**", "Tuned **PostgreSQL** queries", "Wrote **Go** tests", "Added payout retries", "Indexed ledgers in **PostgreSQL**"]),
      ],
    }); // 2 + 1 + 7 + 7 = 17 lines
    const r = fitToPage(d, page(14), { ...exact, focus, restore: false });
    const [web, pay] = r.doc.experience.map((e) => e.bullets.length);
    expect(pay).toBeGreaterThan(web);
  });

  it("without a focus keeps the old order: projects go before a fourth role", () => {
    const d = doc({
      experience: ["A", "B", "C", "D"].map((c) => role(c, "SWE", "", [`${c}1`, `${c}2`])),
      projects: [role("P", "Project", "", ["p1"])],
    }); // 2 + 1 + 16 + 1 + 3 = 23 lines
    const r = fitToPage(d, page(20), exact);
    expect(r.leftOffEntries[0]).toEqual({ kind: "project", title: "Project", company: "P" });
  });
});
