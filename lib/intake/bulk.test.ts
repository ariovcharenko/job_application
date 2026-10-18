import { describe, expect, it, vi } from "vitest";
import { AIError } from "../ai/provider";
import { blankApplication } from "../tracker/blank";
import type { Application } from "../types";
import { estimateBulkCost, formatEstimate, isPerLinkProblem, parseLinks, planBulk, runBulkCheck } from "./bulk";
import type { SavedJob } from "./save";

const saved = (url: string, id: number): SavedJob => ({ ...blankApplication(), url, company: "Taskwise", role: "Engineer", id });

describe("parseLinks", () => {
  it("takes one link per line, adds https, drops non-links and duplicates (tracking params ignored)", () => {
    const text = `
      https://boards.greenhouse.io/taskwise/jobs/1
      jobs.lever.co/demodeck/abc,
      not a link
      https://boards.greenhouse.io/taskwise/jobs/1?utm_source=linkedin
      https://www.brightloop.com/careers/42/
    `;
    expect(parseLinks(text)).toEqual([
      "https://boards.greenhouse.io/taskwise/jobs/1",
      "https://jobs.lever.co/demodeck/abc",
      "https://www.brightloop.com/careers/42/",
    ]);
  });
});

describe("planBulk", () => {
  it("splits fresh links from ones she already checked", () => {
    const apps = [{ ...blankApplication(), id: 7, url: "https://brightloop.com/careers/42", company: "Brightloop", role: "SWE" }] as (Application & { id: number })[];
    const plan = planBulk(["https://www.brightloop.com/careers/42/?ref=x", "https://taskwise.dev/jobs/9"], apps);
    expect(plan.fresh).toEqual(["https://taskwise.dev/jobs/9"]);
    expect(plan.already).toHaveLength(1);
    expect(plan.already[0].app.id).toBe(7);
  });
});

describe("cost estimate", () => {
  it("scales with the count and uses the shared price table", () => {
    const one = estimateBulkCost(1, "claude-haiku-4-5");
    const five = estimateBulkCost(5, "claude-haiku-4-5");
    expect(one.known).toBe(true);
    expect(five.lowUsd).toBeCloseTo(one.lowUsd * 5, 10);
    expect(one.lowUsd).toBeLessThan(one.highUsd);
    // Roughly the 1 to 2 cents a single check is known to cost.
    expect(one.lowUsd).toBeGreaterThan(0.005);
    expect(one.highUsd).toBeLessThan(0.05);
  });

  it("marks an unknown fast model and prices it high", () => {
    const e = estimateBulkCost(2, "some-new-model");
    expect(e.known).toBe(false);
    expect(e.highUsd).toBeGreaterThan(estimateBulkCost(2, "claude-haiku-4-5").highUsd);
  });

  it("formats as a calm range", () => {
    expect(formatEstimate({ lowUsd: 0.02, highUsd: 0.09, known: true })).toBe("about 2 to 9¢");
    expect(formatEstimate({ lowUsd: 0.001, highUsd: 0.004, known: true })).toBe("about 1¢");
    expect(formatEstimate({ lowUsd: 0.4, highUsd: 1.6, known: true })).toBe("about 40¢ to $1.60");
  });
});

describe("runBulkCheck", () => {
  const links = ["https://a.dev/1", "https://b.dev/2", "https://c.dev/3", "https://d.dev/4"];

  it("checks one link at a time and returns every result", async () => {
    const order: string[] = [];
    let running = 0;
    const out = await runBulkCheck(links, async (url) => {
      running++;
      expect(running).toBe(1);
      order.push(url);
      await new Promise((r) => setTimeout(r, 1));
      running--;
      return saved(url, order.length);
    });
    expect(order).toEqual(links);
    expect(out.checked).toHaveLength(4);
    expect(out.stoppedBy).toBeUndefined();
  });

  it("lists JavaScript pages for pasting and skips other per-link problems", async () => {
    const out = await runBulkCheck(links, async (url) => {
      if (url.includes("b.dev")) throw new AIError("fetch_failed", "loads with JavaScript");
      if (url.includes("c.dev")) throw new AIError("invalid_output", "bad JSON");
      return saved(url, 1);
    });
    expect(out.checked.map((j) => j.url)).toEqual(["https://a.dev/1", "https://d.dev/4"]);
    expect(out.needsPaste).toEqual([{ url: "https://b.dev/2", message: "loads with JavaScript" }]);
    expect(out.failed.map((f) => f.url)).toEqual(["https://c.dev/3"]);
  });

  it.each(["no_key", "auth", "billing", "rate_limit", "network", "overloaded"] as const)("stops at the first %s error, which every later link would repeat", async (kind) => {
    const check = vi.fn(async (url: string) => {
      if (url.includes("b.dev")) throw new AIError(kind, "stop");
      return saved(url, 1);
    });
    const out = await runBulkCheck(links, check);
    expect(check).toHaveBeenCalledTimes(2);
    expect(out.checked).toHaveLength(1);
    expect((out.stoppedBy as AIError).kind).toBe(kind);
    expect(out.notTried).toEqual(["https://b.dev/2", "https://c.dev/3", "https://d.dev/4"]);
  });

  it("can be cancelled between links (the current one finishes)", async () => {
    let cancel = false;
    const progress: number[] = [];
    const out = await runBulkCheck(
      links,
      async (url) => {
        if (url.includes("b.dev")) cancel = true;
        return saved(url, 1);
      },
      { isCancelled: () => cancel, onProgress: (p) => progress.push(p.index) },
    );
    expect(out.cancelled).toBe(true);
    expect(out.checked).toHaveLength(2);
    expect(out.notTried).toEqual(["https://c.dev/3", "https://d.dev/4"]);
    expect(progress).toEqual([0, 1]);
  });

  it("treats plain errors as per-link problems", () => {
    expect(isPerLinkProblem(new Error("x"))).toBe(true);
    expect(isPerLinkProblem(new AIError("billing", "x"))).toBe(false);
  });
});
