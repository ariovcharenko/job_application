import { describe, expect, it } from "vitest";
import type { AIProvider, JsonOptions } from "../../ai/provider";
import { DEMO_EXPERIENCE } from "../../demo/data";
import { demoPool } from "../../demo/seed";
import type { ResumeDoc } from "../engine/schema";
import { baselinePrompt, estimateEvalCost, evalJobs, formatRow, runBaseline, runOurs } from "./run";
import { fillScore, inventoryItems, scoreResume, SCORE_WEIGHTS } from "./score";

const job = evalJobs()[0];
/** Her whole demo experience, as a page: every skill, real bullets, nothing invented. */
const full = (): ResumeDoc => demoPool(DEMO_EXPERIENCE, [...job.must, ...job.nice]);

describe("eval fixtures", () => {
  it("has five varied fictional jobs", () => {
    const jobs = evalJobs();
    expect(jobs).toHaveLength(5);
    expect(new Set(jobs.map((j) => j.must[0])).size).toBeGreaterThan(2);
    for (const j of jobs) expect(j.jd.length).toBeGreaterThan(500);
  });
});

describe("inventoryItems", () => {
  it("reads her skills lines, keeping grouped items whole", () => {
    const items = inventoryItems(DEMO_EXPERIENCE);
    expect(items).toContain("AWS (Lambda, SQS, S3)");
    expect(items).toContain("Go");
    expect(items).toHaveLength(29);
  });
});

describe("fillScore", () => {
  it("is full inside 93 to 99%, falls off outside it, and is 0 past one page", () => {
    expect(fillScore(0.96)).toBe(1);
    expect(fillScore(0.8)).toBeGreaterThan(0);
    expect(fillScore(0.8)).toBeLessThan(fillScore(0.9));
    expect(fillScore(1.02)).toBe(0);
  });
});

describe("scoreResume", () => {
  it("gives a truthful, complete page full marks for skills kept and honesty", () => {
    const s = scoreResume(full(), { master: DEMO_EXPERIENCE, job, fill: 0.96 });
    expect(s.skillsRetained).toBe(1);
    expect(s.droppedSkills).toEqual([]);
    expect(s.blockFlags).toBe(0);
    expect(s.mustCoverage).toBe(1);
    expect(s.total).toBeGreaterThan(80);
    expect(s.total).toBeLessThanOrEqual(Object.values(SCORE_WEIGHTS).reduce((a, b) => a + b, 0));
  });

  it("counts every skill a page drops (her complaint) and lowers the score", () => {
    const d = full();
    d.skills = d.skills.slice(0, 3);
    const s = scoreResume(d, { master: DEMO_EXPERIENCE, job, fill: 0.96 });
    expect(s.droppedSkills.length).toBeGreaterThan(0);
    expect(s.skillsRetained).toBeLessThan(1);
    expect(s.total).toBeLessThan(scoreResume(full(), { master: DEMO_EXPERIENCE, job, fill: 0.96 }).total);
  });

  it("counts an invented number or tool as a blocking flag", () => {
    const d = full();
    d.experience[0].bullets[0] = "Built a **Kubernetes** platform serving **9 million** users";
    const s = scoreResume(d, { master: DEMO_EXPERIENCE, job, fill: 0.96 });
    expect(s.blockFlags).toBe(2);
  });

  it("measures specificity and verb variety from the bullets", () => {
    const d = full();
    const same = d.experience.map((e) => ({ ...e, bullets: e.bullets.map((b) => b.replace(/^\S+/, "Built")) }));
    const s = scoreResume({ ...d, experience: same, projects: [] }, { master: DEMO_EXPERIENCE, job, fill: 0.96 });
    expect(s.verbVariety).toBeLessThan(0.2);
    expect(scoreResume(d, { master: DEMO_EXPERIENCE, job, fill: 0.96 }).specificity).toBeGreaterThan(0);
  });
});

describe("eval runner (fake provider, no API call)", () => {
  const fake = (doc: ResumeDoc) => {
    const calls: JsonOptions<unknown>[] = [];
    const provider = {
      completeJson: async <T,>(o: JsonOptions<T>) => {
        calls.push(o as JsonOptions<unknown>);
        return { ...doc, changes: [] } as T;
      },
    } as unknown as AIProvider;
    return { provider, calls };
  };

  it("runs ours through the app's pipeline and the baseline as one plain prompt", async () => {
    const ours = fake(full());
    const r = await runOurs(ours.provider, job);
    expect(ours.calls[0].prompt).toMatch(/PAGE PLAN/);
    expect(r.score.skillsRetained).toBe(1);
    const base = fake(full());
    const b = await runBaseline(base.provider, job);
    expect(base.calls).toHaveLength(1);
    expect(base.calls[0].system).toBeUndefined();
    expect(base.calls[0].prompt).toBe(baselinePrompt(DEMO_EXPERIENCE, job));
    expect(b.calls).toBe(1);
    expect(formatRow("x", b.score)).toMatch(/^x\s+\d+/);
  });

  it("estimates the cost of a full run before anything is spent", () => {
    const est = estimateEvalCost("claude-sonnet-5");
    expect(est.known).toBe(true);
    expect(est.lowUsd).toBeGreaterThan(0.05);
    expect(est.highUsd).toBeGreaterThan(est.lowUsd);
    expect(est.highUsd).toBeLessThan(3);
    expect(estimateEvalCost("some-new-model").known).toBe(false);
  });
});
