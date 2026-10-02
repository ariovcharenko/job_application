import { describe, expect, it } from "vitest";
import { findQuote } from "./highlight";
import { buildRevisionPrompt, carryApprovals, CHANGE_CHIPS, fillComment, placementComment, REVISE_EFFORT, reviseResume } from "./revise";
import type { ResumeDoc } from "./schema";
import type { AIProvider, JsonOptions } from "../../ai/provider";
import type { Flag } from "./validate";

const doc: ResumeDoc = {
  education: [],
  experience: [{ title: "Engineer", company: "Acme", location: "Irvine, CA", dates: "May 2025 - Aug 2025", bullets: ["Built **React** app"] }],
  skills: [{ category: "Languages", items: ["TypeScript"] }],
  leadership: [],
  meta: { matchedKeywords: [], gaps: [], valuesReflected: [] },
};

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
    expect(p).toContain("The candidate asked for these changes");
  });

  it("names the spot a comment was left on", () => {
    const p = buildRevisionPrompt("Acme", "", doc, [
      { id: "a", quote: "Built React app", note: "Mention testing", target: { section: "experience", entry: 0, bullet: 0 } },
      { id: "b", quote: "", note: "Swap for Taskwise", target: { section: "experience", entry: 0 } },
    ]);
    expect(p).toContain('1. On experience[0] (Acme, bullet 1) "Built React app": Mention testing');
    expect(p).toContain("2. On experience[0] (the Acme role): Swap for Taskwise");
  });

  it("keeps every rule in force, limits changes to what is asked, and keeps the page length", () => {
    const p = buildRevisionPrompt("Acme", "", doc, [{ id: "a", quote: "", note: "x" }]);
    expect(p).toMatch(/Every rule in the system prompt still applies/);
    expect(p).toMatch(/every skill kept/);
    expect(p).toMatch(/place the new one by its dates/i);
    expect(p).toMatch(/finished one-page resume: keep it about the same length/);
    expect(p).not.toMatch(/more than fits/);
  });
});

describe("fillComment", () => {
  it("asks for the measured number of lines of real content, never invented", () => {
    const c = fillComment(4);
    expect(c).toContain("about 4 lines short");
    expect(c).toMatch(/only from that role's own text in the MASTER PROFILE/);
    expect(c).toMatch(/never invent anything/);
    expect(fillComment(1)).toContain("about 1 line short");
  });
});

describe("placementComment", () => {
  it("asks to work the skill into that role, with her note, on the role's spot", () => {
    const c = placementComment("Kotlin", "built the Android client", { section: "experience", entry: 2 }, "ShelfLife");
    expect(c.target).toEqual({ section: "experience", entry: 2 });
    expect(c.note).toMatch(/I used Kotlin in this role: built the Android client/);
    expect(c.note).toMatch(/Keep the page the same length/);
  });

  it("names the role when it isn't on the page, and never invents scope without a note", () => {
    const c = placementComment("Rust", "", undefined, "Acme (Engineer)");
    expect(c.target).toBeUndefined();
    expect(c.note).toMatch(/I used Rust in Acme \(Engineer\)/);
    expect(c.note).toMatch(/without inventing any scope, number or result/);
  });
});

describe("CHANGE_CHIPS", () => {
  it("are short labels with notes that never ask to invent, and have no em or en dashes", () => {
    expect(CHANGE_CHIPS.map((c) => c.label)).toEqual(["More backend focus", "Shorter bullets", "Emphasize leadership", "Use the job's keywords"]);
    for (const c of CHANGE_CHIPS) expect(`${c.label} ${c.note}`).not.toMatch(/[\u2013\u2014]/);
    expect(CHANGE_CHIPS.find((c) => c.label === "Use the job's keywords")?.note).toMatch(/Never add a gap/);
  });
});

describe("reviseResume", () => {
  it("makes one cached call at medium effort", async () => {
    const calls: JsonOptions<unknown>[] = [];
    const provider = {
      completeJson: async <T,>(o: JsonOptions<T>) => {
        calls.push(o as JsonOptions<unknown>);
        return { ...doc, changes: ["done"] } as T;
      },
    } as unknown as AIProvider;
    const out = await reviseResume(provider, "MASTER", "Acme", "", doc, [{ id: "a", quote: "", note: "x" }]);
    expect(out.changes).toEqual(["done"]);
    expect(calls).toHaveLength(1);
    expect(calls[0]).toMatchObject({ tier: "smart", effort: REVISE_EFFORT, cacheSystem: true });
    expect(REVISE_EFFORT).toBe("medium");
  });
});

describe("carryApprovals", () => {
  const flag = (id: string, message: string): Flag => ({ id, kind: "skill", severity: "block", message, target: { section: "skills", line: 0, item: 0 } });

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
