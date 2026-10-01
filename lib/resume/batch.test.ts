import { readFileSync } from "node:fs";
import { join } from "node:path";
import { beforeEach, describe, expect, it } from "vitest";
import { AIError, type AIProvider, type JsonOptions } from "../ai/provider";
import { db } from "../db";
import { DEFAULT_PREFERENCES } from "../defaults";
import { allBullets } from "../docx/types";
import { parseDocx } from "../docx/parse";
import type { BaseResume, FeedItem } from "../types";
import { estimateBatchCost, formatUsd, parseTailorDraft, pickStrongMatches, runBatchTailor } from "./batch";

function loadFixture(): ArrayBuffer {
  const buf = readFileSync(join(__dirname, "../docx/__fixtures__/sample-resume.docx"));
  return buf.buffer.slice(buf.byteOffset, buf.byteOffset + buf.byteLength);
}

function feedItem(overrides: Partial<FeedItem> = {}): FeedItem {
  return {
    source: "jsearch",
    externalId: "x",
    url: "https://acme.example/jobs/1",
    company: "Acme",
    title: "Software Engineer",
    location: "Remote",
    workMode: "Remote",
    visa: "sponsors",
    jdText: "We need React and TypeScript.",
    firstSeen: Date.now(),
    fitScore: 85,
    fitBreakdown: JSON.stringify({ verdict: "Apply" }),
    state: "new",
    ...overrides,
  };
}

/** Provider stub: answers tailor calls with a rewrite of the given bullet, recording each call's tier. */
function stubProvider(bulletId: string, failWith?: (callNo: number) => Error | null) {
  const calls: string[] = [];
  const provider: AIProvider = {
    id: "stub",
    complete: async () => "",
    completeJson: async <T,>(opts: JsonOptions<T>) => {
      calls.push(opts.tier ?? "smart");
      const err = failWith?.(calls.length);
      if (err) throw err;
      const raw = { bulletEdits: [{ id: bulletId, newText: "Rewritten bullet" }], skillReorders: [], suggestedSkills: [] };
      return (opts.parse ? opts.parse(raw) : raw) as T;
    },
    listModels: async () => [],
    testConnection: async () => ({ ok: true, message: "" }),
  };
  return { provider, calls };
}

describe("pickStrongMatches", () => {
  it("keeps only undismissed, not-yet-drafted Apply matches, best first", () => {
    const items = [
      feedItem({ id: 1, fitScore: 80 }),
      feedItem({ id: 2, fitScore: 95 }),
      feedItem({ id: 3, fitBreakdown: JSON.stringify({ verdict: "Maybe" }) }),
      feedItem({ id: 4, state: "dismissed" }),
      feedItem({ id: 5, state: "started" }),
      feedItem({ id: 6, tailorDraft: "{}" }),
      feedItem({ id: 7, jdText: "  " }),
    ];
    expect(pickStrongMatches(items, DEFAULT_PREFERENCES).map((i) => i.id)).toEqual([2, 1]);
  });

  it("falls back to the apply threshold when there is no stored breakdown", () => {
    const items = [
      feedItem({ id: 1, fitBreakdown: undefined, fitScore: DEFAULT_PREFERENCES.applyThreshold }),
      feedItem({ id: 2, fitBreakdown: undefined, fitScore: DEFAULT_PREFERENCES.applyThreshold - 1 }),
    ];
    expect(pickStrongMatches(items, DEFAULT_PREFERENCES).map((i) => i.id)).toEqual([1]);
  });
});

describe("estimateBatchCost", () => {
  const base = { resumeChars: 4000, resumeCount: 1, needsPdfParse: false, smartModel: "claude-sonnet-5", fastModel: "claude-haiku-4-5" };

  it("is zero for no items and scales with the count", () => {
    expect(estimateBatchCost({ ...base, jdLengths: [] }).highUsd).toBe(0);
    const one = estimateBatchCost({ ...base, jdLengths: [5000] });
    const three = estimateBatchCost({ ...base, jdLengths: [5000, 5000, 5000] });
    expect(three.highUsd).toBeCloseTo(one.highUsd * 3, 6);
    expect(one.lowUsd).toBeLessThan(one.highUsd);
  });

  it("gives a plausible Sonnet 5 range for one typical posting (cents, not dollars)", () => {
    const e = estimateBatchCost({ ...base, jdLengths: [6000] });
    expect(e.lowUsd).toBeGreaterThan(0.005);
    expect(e.highUsd).toBeLessThan(0.1);
    expect(e.pricesKnown).toBe(true);
  });

  it("adds classify calls only with several resumes, and the PDF parse once", () => {
    const single = estimateBatchCost({ ...base, jdLengths: [5000, 5000] });
    const multi = estimateBatchCost({ ...base, resumeCount: 3, jdLengths: [5000, 5000] });
    const pdf = estimateBatchCost({ ...base, needsPdfParse: true, jdLengths: [5000, 5000] });
    expect(multi.highUsd).toBeGreaterThan(single.highUsd);
    expect(pdf.highUsd - single.highUsd).toBeCloseTo((8000 * 1 + 4000 * 5) / 1_000_000, 6);
  });

  it("caps the job description at what the tailor call actually sends", () => {
    const capped = estimateBatchCost({ ...base, jdLengths: [20000] });
    const huge = estimateBatchCost({ ...base, jdLengths: [200000] });
    expect(huge.highUsd).toBe(capped.highUsd);
  });

  it("errs high and flags it for a model with no known price", () => {
    const known = estimateBatchCost({ ...base, jdLengths: [5000] });
    const unknown = estimateBatchCost({ ...base, smartModel: "claude-something-new", jdLengths: [5000] });
    expect(unknown.pricesKnown).toBe(false);
    expect(unknown.highUsd).toBeGreaterThan(known.highUsd);
  });

  it("formats tiny amounts readably", () => {
    expect(formatUsd(0.004)).toBe("<$0.01");
    expect(formatUsd(0.237)).toBe("$0.24");
    expect(formatUsd(0)).toBe("$0.00");
  });
});

describe("runBatchTailor", () => {
  let resume: BaseResume;
  let bulletId: string;

  beforeEach(async () => {
    await db.feed.clear();
    await db.baseResumes.clear();
    await db.tailoredResumes.clear();
    const bytes = loadFixture();
    bulletId = allBullets(await parseDocx(bytes)).at(0)!.id;
    resume = { label: "SWE", fileName: "r.docx", format: "docx", bytes, addedAt: 1 };
    resume.id = await db.baseResumes.add(resume);
  });

  async function addItems(n: number): Promise<FeedItem[]> {
    const out: FeedItem[] = [];
    for (let i = 0; i < n; i++) {
      const item = feedItem({ externalId: `x${i}`, company: `Co${i}` });
      item.id = await db.feed.add(item);
      out.push(item);
    }
    return out;
  }

  it("saves a draft per item, never writing a tailored resume or applying suggested skills", async () => {
    const items = await addItems(2);
    const { provider, calls } = stubProvider(bulletId);
    const outcome = await runBatchTailor(items, [resume], provider, { smartModel: "claude-sonnet-5" });

    expect(outcome).toEqual({ drafted: 2, failed: [], stoppedReason: null });
    expect(calls).toEqual(["smart", "smart"]); // one resume: no classify call
    for (const item of items) {
      const draft = parseTailorDraft((await db.feed.get(item.id!))!.tailorDraft);
      expect(draft?.baseResumeId).toBe(resume.id);
      expect(draft?.result.bulletEdits).toEqual([{ id: bulletId, newText: "Rewritten bullet" }]);
      expect(draft?.model).toBe("claude-sonnet-5");
    }
    expect(await db.tailoredResumes.count()).toBe(0);
  });

  it("stops at the first error every later call would repeat (e.g. out of credit)", async () => {
    const items = await addItems(3);
    const { provider, calls } = stubProvider(bulletId, (n) =>
      n === 2 ? new AIError("bad_request", "Anthropic rejected the request: Your credit balance is too low") : null,
    );
    const outcome = await runBatchTailor(items, [resume], provider, { smartModel: "claude-sonnet-5" });

    expect(outcome.drafted).toBe(1);
    expect(outcome.stoppedReason).toMatch(/credit balance/);
    expect(calls).toHaveLength(2); // the third item was never attempted
    expect((await db.feed.get(items[2].id!))!.tailorDraft).toBeUndefined();
  });

  it("skips past a problem specific to one posting and keeps going", async () => {
    const items = await addItems(3);
    const { provider } = stubProvider(bulletId, (n) => (n === 1 ? new AIError("invalid_output", "bad JSON") : null));
    const outcome = await runBatchTailor(items, [resume], provider, { smartModel: "claude-sonnet-5" });

    expect(outcome.drafted).toBe(2);
    expect(outcome.failed).toEqual([{ label: "Co0 — Software Engineer", message: "bad JSON" }]);
    expect(outcome.stoppedReason).toBeNull();
  });

  it("stops spending as soon as it's cancelled", async () => {
    const items = await addItems(3);
    let cancelled = false;
    // She clicks Cancel while the first posting's call is in flight.
    const { provider, calls } = stubProvider(bulletId, () => {
      cancelled = true;
      return null;
    });
    const outcome = await runBatchTailor(items, [resume], provider, {
      smartModel: "claude-sonnet-5",
      isCancelled: () => cancelled,
    });
    expect(outcome.drafted).toBe(1);
    expect(outcome.stoppedReason).toBe("Cancelled.");
    expect(calls).toHaveLength(1);
  });

  it("classifies with the fast model when there are several base resumes", async () => {
    const second: BaseResume = { ...resume, id: undefined, label: "AI" };
    second.id = await db.baseResumes.add(second);
    const items = await addItems(1);
    const calls: string[] = [];
    const provider: AIProvider = {
      ...stubProvider(bulletId).provider,
      completeJson: async <T,>(opts: JsonOptions<T>) => {
        calls.push(opts.tier ?? "smart");
        const raw =
          opts.tier === "fast"
            ? { baseResumeId: second.id, reason: "AI-heavy posting" }
            : { bulletEdits: [], skillReorders: [], suggestedSkills: [] };
        return (opts.parse ? opts.parse(raw) : raw) as T;
      },
    };
    await runBatchTailor(items, [resume, second], provider, { smartModel: "claude-sonnet-5" });
    const draft = parseTailorDraft((await db.feed.get(items[0].id!))!.tailorDraft);
    expect(calls).toEqual(["fast", "smart"]);
    expect(draft?.baseResumeId).toBe(second.id);
    expect(draft?.classifyReason).toBe("AI-heavy posting");
  });
});

describe("parseTailorDraft", () => {
  it("returns null for missing or malformed drafts", () => {
    expect(parseTailorDraft(undefined)).toBeNull();
    expect(parseTailorDraft("not json")).toBeNull();
    expect(parseTailorDraft("{}")).toBeNull();
  });
});
