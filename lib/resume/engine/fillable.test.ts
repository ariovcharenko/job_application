import { describe, expect, it } from "vitest";
import { MASTER } from "./__fixtures__/master";
import { fillOffer, unusedSourceBullets } from "./fillable";
import { PLAN_FILL } from "./budget";
import type { ResumeDoc } from "./schema";

const doc = (bullets: string[]): ResumeDoc => ({
  education: [],
  experience: [{ title: "Software Engineer Intern", company: "Brightloop", location: "Austin, TX", dates: "May 2026 - Aug 2026", bullets }],
  skills: [{ category: "Languages", items: ["TypeScript"] }],
  leadership: [],
  meta: { matchedKeywords: [], gaps: [], valuesReflected: [] },
});

const ALL = [
  "Shipped 6 production features to Brightloop's checkout and payments platform.",
  "Wrote unit, component, and contract tests alongside every feature using Jest and React Testing Library.",
];

describe("unusedSourceBullets", () => {
  it("counts source bullets of roles on the page that the page doesn't say", () => {
    expect(unusedSourceBullets(doc([ALL[0]]), MASTER)).toBe(1);
    expect(unusedSourceBullets(doc([]), MASTER)).toBe(2);
  });
  it("is 0 when every bullet is already on the page", () => {
    expect(unusedSourceBullets(doc(ALL), MASTER)).toBe(0);
  });
  it("ignores roles that are not on the page", () => {
    const d = { ...doc(ALL), experience: [{ ...doc(ALL).experience[0], company: "Nowhere Inc" }] };
    expect(unusedSourceBullets(d, MASTER)).toBe(0);
  });
});

describe("fillOffer", () => {
  it("offers nothing on a full page", () => {
    expect(fillOffer(doc([ALL[0]]), MASTER, PLAN_FILL, true)).toEqual({ short: 0, canFill: false, note: null });
  });
  it("offers nothing when the page is over one page", () => {
    expect(fillOffer(doc([ALL[0]]), MASTER, 0.5, false).canFill).toBe(false);
  });
  it("offers the update when the page is short and bullets remain", () => {
    const o = fillOffer(doc([ALL[0]]), MASTER, PLAN_FILL - 0.1, true);
    expect(o.short).toBeGreaterThan(0);
    expect(o.canFill).toBe(true);
    expect(o.note).toBeNull();
  });
  it("shows a neutral note when the page is short and nothing is left to add", () => {
    const o = fillOffer(doc(ALL), MASTER, PLAN_FILL - 0.1, true);
    expect(o.canFill).toBe(false);
    expect(o.note).toBe("Your experience has no more lines to add here.");
  });
});
