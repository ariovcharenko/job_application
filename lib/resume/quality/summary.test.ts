import { describe, expect, it } from "vitest";
import { EXAMPLE_RESUME } from "../../example/fixture";
import { buildRevisionPrompt } from "../engine/revise";
import { lintResume } from "./lint";
import { issuesToComments, qualityScore, SCORE_WEIGHTS } from "./summary";
import { MASTER_DOC, SLOP_DOC } from "./testDocs";
import type { QualityIssue } from "./types";

const issue = (over: Partial<QualityIssue>): QualityIssue => ({
  id: "x",
  severity: "fix",
  rule: "buzzword",
  message: "m",
  fixHint: "h",
  ...over,
});

describe("qualityScore", () => {
  it("is 100 with no issues", () => {
    expect(qualityScore([])).toEqual({ score: 100, fix: 0, consider: 0, total: 0 });
  });

  it("takes 8 per fix and 2 per consider, with consider capped at 20", () => {
    expect(qualityScore([issue({}), issue({ severity: "consider" })]).score).toBe(100 - SCORE_WEIGHTS.fix - SCORE_WEIGHTS.consider);
    const manyConsider = Array.from({ length: 30 }, () => issue({ severity: "consider" }));
    expect(qualityScore(manyConsider).score).toBe(80);
  });

  it("never goes below 0", () => {
    expect(qualityScore(Array.from({ length: 20 }, () => issue({}))).score).toBe(0);
  });

  it("ranks the fixtures sensibly", () => {
    expect(qualityScore(lintResume(MASTER_DOC)).score).toBe(100);
    expect(qualityScore(lintResume(EXAMPLE_RESUME)).score).toBe(98);
    expect(qualityScore(lintResume(SLOP_DOC)).score).toBeLessThan(20);
  });
});

describe("issuesToComments", () => {
  it("drops consider issues", () => {
    expect(issuesToComments([issue({ severity: "consider" })])).toEqual([]);
  });

  it("keeps the quote and target of a single issue", () => {
    const t = { section: "experience" as const, entry: 0, bullet: 1 };
    expect(issuesToComments([issue({ id: "buzzword:experience.0.1:spearheaded", quote: "Spearheaded", target: t, fixHint: "Replace it." })])).toEqual([
      { id: "quality:buzzword:experience.0.1:spearheaded", quote: "Spearheaded", note: "Replace it.", target: t },
    ]);
  });

  it("merges issues on the same spot into one comment", () => {
    const t = { section: "experience" as const, entry: 0, bullet: 0 };
    const out = issuesToComments([
      issue({ id: "a", quote: "Spearheaded", target: t, fixHint: "Replace Spearheaded." }),
      issue({ id: "b", quote: "various", target: t, fixHint: "Replace various." }),
      issue({ id: "c", quote: "leveraging", target: { ...t, bullet: 1 }, fixHint: "Replace leveraging." }),
    ]);
    expect(out).toHaveLength(2);
    expect(out[0]).toEqual({ id: "quality:a", quote: "", note: "Replace Spearheaded. Replace various.", target: t });
  });

  it("feeds the existing revision prompt", () => {
    const comments = issuesToComments(lintResume(SLOP_DOC));
    expect(comments.length).toBeGreaterThan(3);
    const prompt = buildRevisionPrompt("Acme", "We build things.", SLOP_DOC, comments);
    expect(prompt).toContain("On experience[0] (Acme, bullet 1)");
    expect(prompt).toContain(
      'On skills[1] (the Other skills line): Remove "Communication" from the skills section. Remove the repeated "Python" from the Other skills line.',
    );
  });
});
