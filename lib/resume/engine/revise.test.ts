import { describe, expect, it } from "vitest";
import { findQuote } from "./highlight";
import { buildJobFocus } from "./focus";
import { buildRevisionPrompt, carryApprovals, fillPageComment, MAX_RETAILOR, retailorComments, retailorNote } from "./revise";
import { fitToPage } from "./trim";
import type { ResumeDoc } from "./schema";
import type { Flag } from "./validate";

const doc: ResumeDoc = {
  education: [],
  experience: [{ title: "Engineer", company: "Acme", location: "Irvine, CA", dates: "May 2025 - Aug 2025", bullets: ["Built **React** app"] }],
  skills: [{ category: "Languages", items: ["TypeScript"] }],
  leadership: [],
  meta: { matchedKeywords: [], gaps: [], valuesReflected: [] },
};

describe("retailorComments", () => {
  const focus = buildJobFocus({ role: "Frontend Engineer", jdText: "About the role\nBuild accessible web apps.", must: ["React", "TypeScript"] });

  it("asks for each copied bullet to be rewritten, on its spot in the pool, naming what the job cares about", () => {
    const pool: ResumeDoc = { ...doc, experience: [{ ...doc.experience[0], bullets: ["Built **React** app", "Wrote docs", "Fixed bugs"] }] };
    // The page shows pool bullets 0 and 2; page bullet 1 is pool bullet 2.
    const fit = fitToPage(pool, (d) => d.experience[0].bullets.length / 2, { limit: 1, focus });
    expect(fit.doc.experience[0].bullets).toHaveLength(2);
    const shown = fit.map.experience[0].bullets;
    const comments = retailorComments(fit.doc, fit.map, [{ entry: 0, bullet: 1 }], focus);
    expect(comments).toHaveLength(1);
    expect(comments[0].target).toEqual({ section: "experience", entry: 0, bullet: shown[1] });
    expect(comments[0].quote).toBe(fit.doc.experience[0].bullets[1].replace(/\*\*/g, ""));
    expect(comments[0].note).toMatch(/React, TypeScript/);
    expect(retailorNote(focus)).not.toMatch(/[–—]/);
  });

  it("sends at most MAX_RETAILOR", () => {
    const many = Array.from({ length: 10 }, (_, i) => `Bullet ${i}`);
    const pool: ResumeDoc = { ...doc, experience: [{ ...doc.experience[0], bullets: many }] };
    const fit = fitToPage(pool, () => 0.5, { limit: 1 });
    const comments = retailorComments(fit.doc, fit.map, many.map((_, i) => ({ entry: 0, bullet: i })), focus);
    expect(comments).toHaveLength(MAX_RETAILOR);
  });
});

describe("buildRevisionPrompt", () => {
  it("numbers her comments, quoting the selected text, and includes the current resume", () => {
    const p = buildRevisionPrompt("Acme", "We use React.", doc, [
      { id: "a", quote: "Built React app", note: "Mention testing" },
      { id: "b", quote: "", note: "Put Python first in skills" },
    ]);
    expect(p).toContain('1. On "Built React app": Mention testing');
    expect(p).toContain("2. On the whole resume: Put Python first in skills");
    expect(p).toContain('"Built **React** app"');
    expect(p).toContain("Change only what the comments ask for");
  });

  it("names the spot a comment was left on", () => {
    const p = buildRevisionPrompt("Acme", "", doc, [
      { id: "a", quote: "Built React app", note: "Mention testing", target: { section: "experience", entry: 0, bullet: 0 } },
      { id: "b", quote: "", note: "Swap for Taskwise", target: { section: "experience", entry: 0 } },
    ]);
    expect(p).toContain('1. On experience[0] (Acme, bullet 1) "Built React app": Mention testing');
    expect(p).toContain("2. On experience[0] (the Acme role): Swap for Taskwise");
  });

  it("limits a revision to the hard rules and bolding, and to what comments target", () => {
    const p = buildRevisionPrompt("Acme", "", doc, [{ id: "a", quote: "", note: "x" }]);
    expect(p).toMatch(/Only sections 1 \(HARD RULES\) and 2 \(BOLDING RULES\)/);
    expect(p).toMatch(/do not rerun the tailoring algorithm/i);
    expect(p).toMatch(/place the new one by its dates/i);
  });

  it("tells the model the resume may hold more than fits, ranked", () => {
    const p = buildRevisionPrompt("Acme", "", doc, [{ id: "a", quote: "", note: "x" }]);
    expect(p).toMatch(/can hold more than fits on the page/);
    expect(p).toMatch(/most relevant first/);
  });
});

describe("fillPageComment", () => {
  it("asks for more real content with the measured fill, never invented", () => {
    const c = fillPageComment(81);
    expect(c).toContain("about 81%");
    expect(c).toMatch(/only from that role's own lines in the MASTER PROFILE/);
    expect(c).toMatch(/never invent anything/);
  });
});

describe("carryApprovals", () => {
  const flag = (id: string, message: string): Flag => ({ id, kind: "skill", message, target: { section: "skills", line: 0, item: 0 } });

  it("keeps a ticked flag ticked when the revision raises the same message at a new position", () => {
    const before = [flag("skill-0-1", '"Go" isn\'t in your master profile.'), flag("skill-0-2", '"Rust" isn\'t in your master profile.')];
    const after = [flag("skill-1-0", '"Go" isn\'t in your master profile.'), flag("skill-1-1", '"Rust" isn\'t in your master profile.')];
    expect([...carryApprovals(before, new Set(["skill-0-1"]), after)]).toEqual(["skill-1-0"]);
  });
});

describe("findQuote", () => {
  it("finds a quote that spans a bold span across text nodes", () => {
    const texts = ["Built a ", "React", " app with ", "Jest"];
    expect(findQuote(texts, "a React app")).toEqual({ startNode: 0, startOffset: 6, endNode: 2, endOffset: 4 });
  });

  it("treats line breaks and repeated spaces as one space", () => {
    expect(findQuote(["Shipped   6\nfeatures"], "6 features")).toEqual({ startNode: 0, startOffset: 10, endNode: 0, endOffset: 20 });
  });

  it("finds a quote whose line breaks fall between DOM blocks that have no whitespace text", () => {
    // innerText of a clicked role puts "\n" between its blocks; the text nodes have nothing there.
    const texts = ["Software Engineer Intern", "May 2026 - Aug 2026", "Brightloop", "Built it"];
    expect(findQuote(texts, "Software Engineer Intern\nMay 2026 - Aug 2026\nBrightloop")).toEqual({
      startNode: 0,
      startOffset: 0,
      endNode: 2,
      endOffset: 10,
    });
  });

  it("returns null when the text isn't there", () => {
    expect(findQuote(["Built a React app"], "Vue")).toBeNull();
    expect(findQuote(["x"], "  ")).toBeNull();
  });
});
