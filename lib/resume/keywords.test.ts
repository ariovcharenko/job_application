import { describe, expect, it } from "vitest";
import { scoreKeywordCoverage } from "./keywords";

describe("scoreKeywordCoverage", () => {
  it("finds single-word keywords present in the resume", () => {
    const result = scoreKeywordCoverage("Built a dashboard with React and TypeScript.", ["React", "Python"]);
    expect(result.matched).toEqual(["react"]);
    expect(result.missing).toEqual(["python"]);
    expect(result.score).toBe(50);
  });

  it("requires every token of a multi-word keyword to be present", () => {
    const result = scoreKeywordCoverage("Experience with Node.js and REST APIs.", ["Node.js", "GraphQL APIs"]);
    expect(result.matched).toContain("node.js");
    expect(result.missing).toContain("graphql apis");
  });

  it("is case-insensitive and dedupes the keyword list", () => {
    const result = scoreKeywordCoverage("Python everywhere", ["python", "Python", "PYTHON"]);
    expect(result.matched).toEqual(["python"]);
    expect(result.score).toBe(100);
  });

  it("returns 0 for an empty keyword list", () => {
    const result = scoreKeywordCoverage("anything", []);
    expect(result.score).toBe(0);
    expect(result.matched).toEqual([]);
  });
});
