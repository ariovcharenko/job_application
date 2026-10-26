import { describe, expect, it } from "vitest";
import { MASTER } from "../engine/__fixtures__/master";
import type { AIProvider, JsonOptions } from "../../ai/provider";
import { reviseResume } from "../engine/revise";
import type { ResumeDoc } from "../engine/schema";
import { lintResume } from "./lint";
import { droppedMessage, droppedMetrics, metricsDroppedBy } from "./metrics";

const doc = (bullets: string[]): ResumeDoc => ({
  education: [],
  experience: [{ title: "Software Engineer Intern", company: "Brightloop", location: "Austin, TX", dates: "May 2026 - Aug 2026", bullets }],
  skills: [{ category: "Languages", items: ["TypeScript"] }],
  leadership: [],
  meta: { matchedKeywords: [], gaps: [], valuesReflected: [] },
});

describe("droppedMetrics", () => {
  it("reports a number the rewrite of a source bullet lost", () => {
    const d = droppedMetrics(doc(["Shipped production features to Brightloop's checkout and payments platform."]), MASTER);
    expect(d.map((x) => x.metric)).toEqual(["6"]);
    expect(d[0].target).toEqual({ section: "experience", entry: 0, bullet: 0 });
    expect(droppedMessage(d[0])).toBe("Dropped '6' from a Brightloop bullet.");
  });

  it("reports nothing when the number is still on the page, bold or moved to another bullet of the role", () => {
    expect(droppedMetrics(doc(["Shipped **6 production features** to Brightloop's checkout and payments platform."]), MASTER)).toEqual([]);
    expect(droppedMetrics(doc(["Shipped production features to the checkout platform.", "Delivered 6 features in all."]), MASTER)).toEqual([]);
  });

  it("does not call a source bullet left off the page 'dropped'", () => {
    expect(droppedMetrics(doc(["Wrote unit and contract tests with Jest and React Testing Library."]), MASTER)).toEqual([]);
  });

  it("compares the number itself, so '80+' reads as shown by 'over 80'", () => {
    const taskwise: ResumeDoc = {
      ...doc([]),
      experience: [{ title: "Founding Software Engineer", company: "Taskwise", location: "Remote", dates: "Oct 2025 - Present", bullets: ["Built and deployed a habit tracking platform for over 80 early users, reducing manual goal planning time."] }],
    };
    expect(droppedMetrics(taskwise, MASTER).map((d) => d.metric)).toEqual(["~35%"]);
  });

  it("metricsDroppedBy reports only what a call removed, not what was already missing", () => {
    const before = doc(["Shipped **6 production features** to Brightloop's checkout and payments platform."]);
    const after = doc(["Shipped production features to Brightloop's checkout and payments platform."]);
    expect(metricsDroppedBy(before, after, MASTER).map((d) => d.metric)).toEqual(["6"]);
    expect(metricsDroppedBy(after, after, MASTER)).toEqual([]);
  });
});

describe("lintResume metric-dropped", () => {
  const lost = doc(["Shipped production features to Brightloop's checkout and payments platform."]);

  it("is a 'consider' issue on the bullet when the master profile is given", () => {
    const issue = lintResume(lost, { master: MASTER }).find((i) => i.rule === "metric-dropped");
    expect(issue?.severity).toBe("consider");
    expect(issue?.message).toBe("Dropped '6' from a Brightloop bullet.");
    expect(issue?.target).toEqual({ section: "experience", entry: 0, bullet: 0 });
  });

  it("is skipped without the master profile", () => {
    expect(lintResume(lost).some((i) => i.rule === "metric-dropped")).toBe(false);
  });
});

describe("reviseResume metric guard", () => {
  it("adds a line to 'What changed' for a number the model's revision removed", async () => {
    const before = doc(["Shipped **6 production features** to Brightloop's checkout and payments platform."]);
    const after = { ...doc(["Shipped production features to Brightloop's checkout and payments platform."]), changes: ["Shortened a bullet."] };
    const provider = { completeJson: async <T,>(_o: JsonOptions<T>) => after as T } as unknown as AIProvider;
    const out = await reviseResume(provider, MASTER, "Acme", "job text", before, []);
    expect(out.changes).toEqual(["Shortened a bullet.", "Dropped '6' from a Brightloop bullet."]);
    const same = { completeJson: async <T,>() => ({ ...before, changes: ["Nothing."] }) as T } as unknown as AIProvider;
    expect((await reviseResume(same, MASTER, "Acme", "job text", before, [])).changes).toEqual(["Nothing."]);
  });
});
