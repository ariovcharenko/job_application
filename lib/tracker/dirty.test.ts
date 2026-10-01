import { describe, expect, it } from "vitest";
import { blankApplication } from "./blank";
import { hasUnsavedChanges } from "./dirty";

describe("hasUnsavedChanges", () => {
  const saved = { ...blankApplication(1000), id: 7, company: "Google", role: "Software Engineer" };

  it("is false for an unchanged copy", () => {
    expect(hasUnsavedChanges({ ...saved }, saved)).toBe(false);
  });

  it("is true once any field is edited", () => {
    expect(hasUnsavedChanges({ ...saved, notes: "Ask about the team" }, saved)).toBe(true);
    expect(hasUnsavedChanges({ ...saved, stage: "Applied" }, saved)).toBe(true);
  });

  it("ignores updatedAt, and treats a missing field like undefined", () => {
    expect(hasUnsavedChanges({ ...saved, updatedAt: 9999 }, saved)).toBe(false);
    expect(hasUnsavedChanges({ ...saved, tailoredResumeId: undefined }, saved)).toBe(false);
    expect(hasUnsavedChanges({ ...saved, tailoredResumeId: 3 }, saved)).toBe(true);
  });
});
