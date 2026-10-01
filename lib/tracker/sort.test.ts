import { describe, expect, it } from "vitest";
import { blankApplication } from "./blank";
import { sortApplications } from "./sort";
import type { Application } from "../types";

const app = (id: number, patch: Partial<Application>): Application => ({ ...blankApplication(), id, ...patch });

describe("sortApplications", () => {
  it("puts Saved jobs first, newest added on top", () => {
    const out = sortApplications([
      app(1, { stage: "Applied", appliedDate: "2026-09-20", createdAt: 100 }),
      app(2, { stage: "Saved", createdAt: 50 }),
      app(3, { stage: "Saved", createdAt: 300 }),
    ]);
    expect(out.map((a) => a.id)).toEqual([3, 2, 1]);
  });

  it("orders the rest by apply date, then by when they were added", () => {
    const out = sortApplications([
      app(1, { stage: "Applied", appliedDate: "2026-09-01", createdAt: 10 }),
      app(2, { stage: "Rejected", appliedDate: "2026-09-20", createdAt: 5 }),
      app(3, { stage: "Applied", appliedDate: "2026-09-01", createdAt: 90 }),
      app(4, { stage: "Offer", appliedDate: "", createdAt: 999 }),
    ]);
    expect(out.map((a) => a.id)).toEqual([2, 3, 1, 4]);
  });

  it("does not mutate its input", () => {
    const input = [app(1, { stage: "Applied", createdAt: 1 }), app(2, { stage: "Saved", createdAt: 2 })];
    sortApplications(input);
    expect(input.map((a) => a.id)).toEqual([1, 2]);
  });
});
