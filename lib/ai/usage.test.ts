import { beforeEach, describe, expect, it } from "vitest";
import { db, saveSettings } from "../db";
import { costOf, UNKNOWN_MODEL_PRICE } from "./prices";
import { buildProvider } from "./route";
import { formatRunCost, formatUsd, monthStart, recordUsage, spendSince, summarize } from "./usage";
import type { AIUsageEntry } from "../types";
import { DEFAULT_SETTINGS } from "../defaults";

beforeEach(async () => {
  await Promise.all(db.tables.map((t) => t.clear()));
});

const entry = (over: Partial<AIUsageEntry>): AIUsageEntry => ({
  at: 0,
  provider: "anthropic",
  model: "claude-sonnet-5",
  task: "write_resume",
  inputTokens: 0,
  outputTokens: 0,
  cacheReadTokens: 0,
  cacheWriteTokens: 0,
  ...over,
});

describe("pricing a response", () => {
  it("prices Anthropic input, output and cache tokens from the shared table", () => {
    // Sonnet 5: $2 in, $10 out per million. Cache read 10%, write 125% of input.
    const c = costOf(entry({ inputTokens: 1_000_000, outputTokens: 100_000, cacheReadTokens: 1_000_000, cacheWriteTokens: 1_000_000 }));
    expect(c.known).toBe(true);
    expect(c.usd).toBeCloseTo(2 + 1 + 0.2 + 2.5, 6);
  });

  it("uses the high fallback for a model without a price, and says so", () => {
    const c = costOf(entry({ provider: "openai", model: "test-openai-model", inputTokens: 1_000_000, cacheReadTokens: 1_000_000 }));
    expect(c.known).toBe(false);
    // OpenAI cached tokens are priced as full input (errs high).
    expect(c.usd).toBeCloseTo(2 * UNKNOWN_MODEL_PRICE[0], 6);
  });
});

describe("summaries", () => {
  it("totals and breaks down by task, most expensive first, marking estimates", () => {
    const s = summarize([
      entry({ task: "check_job", model: "claude-haiku-4-5", inputTokens: 10_000, outputTokens: 1000 }),
      entry({ task: "write_resume", inputTokens: 20_000, outputTokens: 4000 }),
      entry({ task: "write_resume", inputTokens: 20_000, outputTokens: 4000 }),
    ]);
    expect(s.calls).toBe(3);
    expect(s.estimated).toBe(false);
    expect(s.byTask.map((t) => [t.label, t.calls])).toEqual([
      ["Writing resumes", 2],
      ["Checking jobs", 1],
    ]);
    expect(s.usd).toBeCloseTo(0.015 + 2 * 0.08, 6);
    expect(summarize([entry({ model: "mystery" , outputTokens: 1 })]).estimated).toBe(true);
  });

  it("reads only this month's entries, and only the asked tasks", async () => {
    const now = new Date(2026, 9, 17, 12);
    const start = monthStart(now);
    expect(new Date(start).getDate()).toBe(1);
    await recordUsage("check_job", { provider: "anthropic", model: "claude-haiku-4-5", inputTokens: 1000, outputTokens: 100, cacheReadTokens: 0, cacheWriteTokens: 0 }, start - 1);
    await recordUsage("check_job", { provider: "anthropic", model: "claude-haiku-4-5", inputTokens: 1000, outputTokens: 100, cacheReadTokens: 0, cacheWriteTokens: 0 }, start + 1);
    await recordUsage("revise_resume", { provider: "openai", model: "x", inputTokens: 1, outputTokens: 1, cacheReadTokens: 0, cacheWriteTokens: 0 }, start + 2);
    expect((await spendSince(start)).calls).toBe(2);
    expect((await spendSince(start, ["revise_resume"])).calls).toBe(1);
  });

  it("formats month totals in dollars and runs in cents", () => {
    expect(formatUsd(0.8412)).toBe("$0.84");
    expect(formatUsd(0)).toBe("$0.00");
    expect(formatUsd(0.001)).toBe("under $0.01");
    expect(formatRunCost(0.041)).toBe("about 4¢");
    expect(formatRunCost(0.004)).toBe("under 1¢");
    expect(formatRunCost(1.5)).toBe("about $1.50");
  });
});

describe("recording from real providers", () => {
  it("logs each response under the task the provider was built for", async () => {
    await saveSettings({ openaiKey: "test-openai-key" });
    const fetchFake = (async () =>
      new Response(JSON.stringify({ choices: [{ message: { content: "ok" }, finish_reason: "stop" }], usage: { prompt_tokens: 10, completion_tokens: 5 } }), {
        status: 200,
      })) as typeof fetch;
    const original = globalThis.fetch;
    globalThis.fetch = fetchFake;
    try {
      const p = buildProvider("openai", { ...DEFAULT_SETTINGS, openaiKey: "test-openai-key", openaiModel: "test-model" }, "revise_resume");
      await p.complete({ prompt: "x" });
    } finally {
      globalThis.fetch = original;
    }
    // recordUsage is fire-and-forget; give it a tick.
    await new Promise((r) => setTimeout(r, 20));
    const rows = await db.aiUsage.toArray();
    expect(rows).toHaveLength(1);
    expect(rows[0]).toMatchObject({ task: "revise_resume", provider: "openai", model: "test-model", inputTokens: 10, outputTokens: 5 });
  });
});
