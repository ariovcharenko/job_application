import { describe, expect, it } from "vitest";
import { DEMO_JOBS } from "../../demo/data";
import {
  buildJobFocus,
  endMonth,
  entryRelevance,
  familyBonus,
  preferredTitle,
  relevanceParts,
  showsDomain,
  teachingPenalty,
  titleFamily,
  topResponsibilities,
  weightedLines,
} from "./focus";

const demo = (company: string) => {
  const j = DEMO_JOBS.find((x) => x.signals.company === company)!;
  return buildJobFocus({ role: j.signals.role, jdText: j.jd, must: j.signals.mustHaveSkills, nice: j.signals.niceToHaveSkills });
};

const POSTING = `Acme · Software Engineer, Payments
About the role
Build the ledger and payout APIs behind our checkout. You will own refunds end to end.
Responsibilities
- Review code and write clear documentation
- Take part in an on-call rotation
Benefits
Medical, dental and a learning budget for billing courses.`;

describe("weightedLines", () => {
  it("counts the role's own text, and not boilerplate lines or benefits", () => {
    const lines = weightedLines(POSTING);
    expect(lines.find((l) => /ledger/.test(l.text))?.weight).toBe(2);
    expect(lines.find((l) => /Review code/.test(l.text))?.weight).toBe(0);
    expect(lines.find((l) => /on-call/.test(l.text))?.weight).toBe(0);
    expect(lines.find((l) => /billing courses/.test(l.text))?.weight).toBe(0);
  });
});

describe("buildJobFocus", () => {
  it("reads the role family, domains and responsibilities from the posting", () => {
    const f = buildJobFocus({ role: "Software Engineer, Payments", jdText: POSTING, must: ["Go"], nice: ["gRPC", "go"] });
    expect(f.family).toBe("Software Engineering");
    expect(f.domains[0].id).toBe("payments");
    expect(f.responsibilities[0]).toMatch(/^Build the ledger and payout APIs/);
    expect(f.terms).toContain("ledger");
    // A nice-to-have that's also a must-have is listed once, as a must-have.
    expect(f.nice).toEqual(["gRPC"]);
  });

  it("tells the demo jobs apart", () => {
    expect(demo("Lumen Health").family).toBe("Frontend/Web");
    expect(demo("Lumen Health").domains.map((d) => d.id)).toEqual(expect.arrayContaining(["frontend", "accessibility"]));
    expect(demo("Cobalt Payments").domains[0].id).toBe("payments");
    expect(demo("Harbor Analytics").domains[0].id).toBe("data");
    expect(demo("Pinecrest Robotics").family).toBe("Embedded / Hardware");
    expect(demo("Pinecrest Robotics").domains.map((d) => d.id)).toEqual(["systems"]);
  });

  it("ignores the boilerplate every posting shares", () => {
    // Every demo posting has the same Responsibilities block (code review, on-call, designers).
    expect(demo("Harbor Analytics").domains.map((d) => d.id)).not.toContain("design");
    expect(topResponsibilities(DEMO_JOBS[0].jd).every((r) => !/on-call|Review code/.test(r))).toBe(true);
  });
});

describe("relevanceParts", () => {
  const f = buildJobFocus({ role: "Software Engineer, Payments", jdText: POSTING, must: ["Go", "PostgreSQL"], nice: ["Terraform"] });

  it("weighs a must-have over a nice-to-have and names every part", () => {
    const must = relevanceParts(f, "Built a service in **Go**");
    const nice = relevanceParts(f, "Wrote **Terraform** modules");
    expect(must.must).toEqual(["Go"]);
    expect(nice.nice).toEqual(["Terraform"]);
    expect(must.score).toBeGreaterThan(nice.score);
  });

  it("credits the job's domain and responsibility words without any skill", () => {
    const p = relevanceParts(f, "Added idempotency keys to the payouts API so refunds never ran twice");
    expect(p.domains).toContain("payments");
    expect(p.terms).toBeGreaterThan(0);
    expect(p.score).toBeGreaterThan(relevanceParts(f, "Led weekly sections for 30 students").score);
  });
});

describe("showsDomain", () => {
  it("matches whole words only", () => {
    expect(showsDomain("Shipped a **React** UI", "frontend")).toBe(true);
    expect(showsDomain("Built a guide for new hires", "frontend")).toBe(false);
    expect(showsDomain("Wrote firmware and tooling for warehouse robots", "data")).toBe(false);
  });
});

describe("roles", () => {
  const now = new Date(2026, 9, 1);

  it("reads the end of a date range", () => {
    expect(endMonth("Jun 2025 - Sep 2025", now)).toBe(2025 * 12 + 8);
    expect(endMonth("Sep 2024 - Present", now)).toBe(2026 * 12 + 9);
    expect(endMonth("Oct 2024", now)).toBe(2024 * 12 + 9);
    expect(endMonth("", now)).toBeNull();
  });

  it("gives a role whose title is this kind of work a bonus, and no family to teaching", () => {
    const fe = demo("Lumen Health");
    expect(familyBonus(fe, "Frontend Engineer Intern")).toBe(1);
    expect(familyBonus(fe, "Software Engineer Intern")).toBe(0.25);
    expect(titleFamily("Teaching Assistant, Data Structures")).toBe("Other");
    expect(teachingPenalty(fe, "Teaching Assistant, Data Structures")).toBeGreaterThan(0);
  });

  it("picks the alternate title that fits the job", () => {
    const design = buildJobFocus({ role: "Product Designer", jdText: "", must: [] });
    const title = "Founding Software Engineer (alt. title: Product & UX Engineer)";
    expect(preferredTitle(title, design)).toBe("Product & UX Engineer");
    expect(preferredTitle(title, demo("Cobalt Payments"))).toBe("Founding Software Engineer");
  });

  it("ranks the role that does this job's work above a recent but unrelated one", () => {
    const fe = demo("Lumen Health");
    const lumen = { title: "Frontend Engineer Intern", company: "Lumen Health", dates: "Jun 2024 - Sep 2024", bullets: ["Shipped a **React** and **TypeScript** scheduling page"] };
    const ta = { title: "Teaching Assistant", company: "University", dates: "Sep 2024 - Jun 2026", bullets: ["Led weekly sections for 30 students"] };
    expect(entryRelevance(fe, lumen, [lumen, ta], now)).toBeGreaterThan(entryRelevance(fe, ta, [lumen, ta], now));
  });
});
