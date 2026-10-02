import { describe, expect, it } from "vitest";
import { DEMO_EXPERIENCE, DEMO_JOBS } from "../../demo/data";
import { MASTER } from "./__fixtures__/master";
import { bulletLines, describePlan, linesShort, PAGE_LINES, PLAN_FILL, planPage } from "./budget";
import { buildJobFocus } from "./focus";

const focusOf = (company: string) => {
  const j = DEMO_JOBS.find((x) => x.signals.company === company)!;
  return buildJobFocus({ role: j.signals.role, jdText: j.jd, must: j.signals.mustHaveSkills, nice: j.signals.niceToHaveSkills });
};

describe("planPage", () => {
  it("measures the page from the layout: about 64 lines of 10pt text", () => {
    expect(PAGE_LINES).toBeGreaterThan(60);
    expect(PAGE_LINES).toBeLessThan(68);
  });

  it("leaves room for bullets after the header, education, every skill and leadership", () => {
    const plan = planPage(DEMO_EXPERIENCE, focusOf("Cobalt Payments"));
    expect(plan.skillLines).toBeGreaterThanOrEqual(6);
    expect(plan.leadershipLines).toBe(2);
    expect(plan.fixedLines + plan.bulletLines).toBeLessThanOrEqual(plan.pageLines);
    expect(plan.bulletLines).toBeGreaterThan(20);
  });

  it("gives the most relevant role the most bullets, never more than its own lines, never fewer than 2", () => {
    const plan = planPage(DEMO_EXPERIENCE, focusOf("Cobalt Payments"));
    expect(plan.roles[0]).toMatchObject({ company: "Cobalt Payments", bullets: 6 });
    for (const r of plan.roles) {
      expect(r.bullets).toBeGreaterThanOrEqual(2);
      expect(r.bullets).toBeLessThanOrEqual(Math.max(2, r.sourceBullets));
    }
    expect(plan.roles.length).toBeGreaterThanOrEqual(3);
    expect(plan.roles.length).toBeLessThanOrEqual(4);
  });

  it("changes with the job: the frontend role leads a frontend job, the teaching role gives way", () => {
    const fe = planPage(DEMO_EXPERIENCE, focusOf("Lumen Health"));
    expect(fe.roles[0].company).toBe("Lumen Health");
    expect(fe.roles.map((r) => r.company)).not.toContain("University of Washington");
    expect(fe.projects.map((p) => p.company)).toContain("Trailhead");
  });

  it("fills the planned lines: bullets times lines per bullet is about the room left", () => {
    for (const j of DEMO_JOBS.filter((x) => x.resume)) {
      const plan = planPage(DEMO_EXPERIENCE, focusOf(j.signals.company));
      const planned = plan.totalBullets * plan.linesPerBullet;
      expect(Math.abs(planned - plan.bulletLines)).toBeLessThanOrEqual(3);
      expect(plan.linesPerBullet).toBeGreaterThanOrEqual(1);
      expect(plan.linesPerBullet).toBeLessThanOrEqual(2);
    }
  });

  it("uses her alternate title when it fits the job better", () => {
    const design = buildJobFocus({ role: "Product Designer", jdText: "", must: [] });
    expect(planPage(MASTER, design).roles.some((r) => r.title === "Product & UX Engineer")).toBe(true);
  });

  it("works without a job focus, in her order", () => {
    const plan = planPage(DEMO_EXPERIENCE);
    expect(plan.roles[0].company).toBe("Cobalt Payments");
    expect(plan.totalBullets).toBeGreaterThan(8);
  });
});

describe("linesShort", () => {
  it("is how many lines below the planned fill the page ends, never negative", () => {
    expect(linesShort(PLAN_FILL)).toBe(0);
    expect(linesShort(1)).toBe(0);
    expect(linesShort(PLAN_FILL - 5 / PAGE_LINES)).toBe(5);
  });
});

describe("bulletLines", () => {
  it("counts a short bullet as one line and a long one as two", () => {
    expect(bulletLines("Built a **React** app")).toBe(1);
    expect(bulletLines("Built a ".padEnd(180, "word "))).toBe(2);
  });
});

describe("describePlan", () => {
  it("says the room, the characters per line, and each entry's bullets, with no em or en dashes", () => {
    const text = describePlan(planPage(DEMO_EXPERIENCE, focusOf("Atlas Cloud")), (c) => (c === "Cobalt Payments" ? "Go, AWS" : ""));
    expect(text).toMatch(/^PAGE PLAN/);
    expect(text).toMatch(/About \d+ lines are left/);
    expect(text).toMatch(/Cobalt Payments \(Software Engineer Intern\): \d bullets\. Shows Go, AWS\./);
    expect(text).toMatch(/That is \d+ bullets/);
    expect(text).not.toMatch(/[–—]/);
  });
});
