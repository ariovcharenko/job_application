import { describe, expect, it } from "vitest";
import { MASTER } from "./__fixtures__/master";
import { autoBold, backfillFromExperience, copiedBullets, MAX_BACKFILL_PER_ROLE, MAX_BULLETS_PER_ROLE, overlap } from "./backfill";
import type { ResumeDoc } from "./schema";
import { validateResume } from "./validate";
import { parseSkillInventory } from "../master/skills";

const base = (bullets: string[]): ResumeDoc => ({
  education: [],
  experience: [{ title: "Software Engineer Intern", company: "Brightloop", location: "Austin, TX", dates: "May 2026 - Aug 2026", bullets }],
  skills: [{ category: "Languages", items: ["TypeScript"] }],
  leadership: [],
  meta: { matchedKeywords: [], gaps: [], valuesReflected: [] },
});

describe("overlap", () => {
  it("scores a rewrite of the same bullet high and an unrelated one low", () => {
    expect(overlap("Shipped **6 production features** to an event platform", "Shipped 6 production features to Brightloop's event-hosting platform")).toBeGreaterThan(0.5);
    expect(overlap("Wrote Jest tests for every feature", "Shipped 6 production features to an event platform")).toBeLessThan(0.3);
  });
});

describe("backfillFromExperience", () => {
  it("adds the role's unused source bullets after the model's, and none it already said", () => {
    const doc = base(["Shipped **6 production features** to Brightloop's checkout and payments platform."]);
    const r = backfillFromExperience(doc, MASTER);
    const bullets = r.doc.experience[0].bullets;
    expect(bullets[0]).toBe(doc.experience[0].bullets[0]);
    expect(r.added).toBeGreaterThan(0);
    expect(bullets.filter((b) => /6 production features/.test(b))).toHaveLength(1);
  });

  it("never creates a flag: every added bullet is her own words", () => {
    const r = backfillFromExperience(base(["Shipped **6 production features** to Brightloop's checkout and payments platform."]), MASTER);
    expect(validateResume(r.doc, MASTER).flags).toEqual([]);
  });

  it("orders the added bullets by relevance when both have a metric or both have none", () => {
    const taskwise: ResumeDoc = { ...base([]), experience: [{ title: "Founding Software Engineer", company: "Taskwise", location: "Remote", dates: "Oct 2025 - Present", bullets: [] }] };
    const r = backfillFromExperience(taskwise, MASTER, (t) => (/Prometheus/.test(t) ? 10 : 0));
    expect(r.doc.experience[0].bullets[0]).toMatch(/Prometheus/);
    const r2 = backfillFromExperience(taskwise, MASTER, (t) => (/habit/.test(t) ? 10 : 0));
    expect(r2.doc.experience[0].bullets[0]).toMatch(/habit/);
  });

  it("puts bullets with a metric before more relevant ones without", () => {
    const r = backfillFromExperience(base([]), MASTER, (t) => (/Jest/.test(t) ? 10 : 0));
    expect(r.doc.experience[0].bullets[0]).toMatch(/6.*production features/);
    expect(r.doc.experience[0].bullets[1]).toMatch(/Jest/);
  });
});

describe("copiedBullets", () => {
  it("finds the bullets that are her source lines word for word, bold and casing aside", () => {
    const filled = backfillFromExperience(base(["Delivered **6 production features** across Brightloop's checkout and payments platform."]), MASTER).doc;
    const copied = copiedBullets(filled, MASTER);
    expect(copied.length).toBeGreaterThan(0);
    expect(copied.every((c) => c.entry === 0 && c.bullet >= 1)).toBe(true);
    expect(copiedBullets(base(["Wrote **Jest** tests for every checkout feature"]), MASTER)).toEqual([]);
  });
});

describe("autoBold", () => {
  it("bolds her technologies and the first real metric, at most three technologies", () => {
    const inv = parseSkillInventory(MASTER);
    const out = autoBold("Wrote unit, component, and contract tests using Jest and React Testing Library, keeping coverage near 30%.", inv, MASTER);
    expect(out).toContain("**Jest**");
    expect(out).toContain("**React Testing Library**");
    expect(out).toContain("**30%**");
    expect((out.match(/\*\*/g) ?? []).length / 2).toBeLessThanOrEqual(4);
  });
});

describe("covers", () => {
  it("asks whether the page says most of the source bullet, not whether two bullets share a few words", async () => {
    const { covers } = await import("./backfill");
    const page = "Built a config-driven registration wizard with React hooks.";
    const source = "Led a large-scale UI migration of the registration, invite, and RSVP flows onto a shared design system, tracking delivery in Jira.";
    expect(covers(page, source)).toBeLessThan(0.5);
    expect(covers("Led a UI migration of registration, invite and RSVP flows onto a shared design system in Jira", source)).toBeGreaterThanOrEqual(0.5);
  });
});

describe("backfillFromExperience per role, projects and caps", () => {
  const MASTER2 = `### Experience

**Engineer | Northwind | Remote | Jan 2025 - Present**
- Built a Kafka pipeline handling 2M events per day for billing.
- Cut deploy time by 40% by moving CI to GitHub Actions.
- Wrote runbooks for on-call.
- Mentored two interns on code review.
- Added dashboards for latency.
- Rotated secrets quarterly.
- Fixed flaky tests in the checkout suite.
- Reviewed vendor contracts.

**Engineer | Contoso | Remote | Jan 2023 - Dec 2024**
- Built a Kafka pipeline handling 2M events per day for billing.
- Wrote runbooks for on-call.

### Projects

**Builder | PitchPal | Remote | 2025**
- Shipped a slide generator with React used by 120 people.
- Added export to PDF.
- Wrote a prompt library.

### Skills inventory
- **Languages:** Python
`;
  const doc = (exp: ResumeDoc["experience"], projects?: ResumeDoc["projects"]): ResumeDoc => ({
    education: [],
    experience: exp,
    ...(projects ? { projects } : {}),
    skills: [],
    leadership: [],
    meta: { matchedKeywords: [], gaps: [], valuesReflected: [] },
  });
  const role = (company: string, bullets: string[]) => ({ title: "Engineer", company, location: "Remote", dates: "x", bullets });

  it("judges coverage per role: a similar bullet in another role does not hide this role's line", () => {
    const d = doc([role("Northwind", []), role("Contoso", ["Built a Kafka pipeline handling 2M events per day for billing."])]);
    const r = backfillFromExperience(d, MASTER2);
    expect(r.doc.experience[0].bullets.some((b) => /Kafka/.test(b))).toBe(true);
    expect(r.doc.experience[1].bullets.filter((b) => /Kafka/.test(b))).toHaveLength(1);
  });

  it("treats a source bullet as covered when a bullet of the same role has its numbers and tools", () => {
    const d = doc([role("Northwind", ["Moved CI to **GitHub Actions**, so deploys got **40%** faster."])]);
    const r = backfillFromExperience(d, MASTER2);
    expect(r.doc.experience[0].bullets.filter((b) => /40%/.test(b))).toHaveLength(1);
  });

  it("ranks metric bullets first and caps what is restored per role", () => {
    const r = backfillFromExperience(doc([role("Northwind", [])]), MASTER2, () => 0);
    const bullets = r.doc.experience[0].bullets;
    expect(bullets).toHaveLength(MAX_BACKFILL_PER_ROLE);
    expect(bullets[0]).toMatch(/2M/);
    expect(bullets[1]).toMatch(/40%/);
    expect(r.added).toBe(MAX_BACKFILL_PER_ROLE);
  });

  it("never fills a role past the total cap, and leaves the model's own count alone", () => {
    const own = Array.from({ length: 5 }, (_, i) => `Own bullet number ${i} about something else entirely`);
    const r = backfillFromExperience(doc([role("Northwind", own)]), MASTER2);
    expect(r.doc.experience[0].bullets).toHaveLength(MAX_BULLETS_PER_ROLE);
    const eight = Array.from({ length: 8 }, (_, i) => `Own bullet ${i} about another thing`);
    expect(backfillFromExperience(doc([role("Northwind", eight)]), MASTER2).doc.experience[0].bullets).toEqual(eight);
  });

  it("fills projects too, word for word", () => {
    const d = doc([], [role("PitchPal", ["Added export to PDF."])]);
    const r = backfillFromExperience(d, MASTER2);
    const bullets = r.doc.projects![0].bullets;
    expect(bullets[0]).toBe("Added export to PDF.");
    expect(bullets.some((b) => b.replace(/\*\*/g, "") === "Shipped a slide generator with React used by 120 people.")).toBe(true);
    expect(bullets.every((b) => ["Added export to PDF.", "Wrote a prompt library."].includes(b) || /slide generator/.test(b))).toBe(true);
    expect(backfillFromExperience(doc([]), MASTER2).doc.projects).toBeUndefined();
  });
});
