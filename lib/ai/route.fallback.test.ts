import { beforeEach, describe, expect, it, vi } from "vitest";
import type { AnthropicConfig } from "./anthropic";
import { AIError, type AIErrorKind, type AIProvider, type CompleteOptions, type JsonOptions } from "./provider";

// Claude is replaced by a fake that answers and reports usage like the real one, so the
// automatic fallback can be checked end to end with no network and no real AI call.
const claudeCalls: CompleteOptions[] = [];
vi.mock("./anthropic", () => ({
  createAnthropicProvider: (cfg: AnthropicConfig): AIProvider => {
    const answer = async (opts: CompleteOptions) => {
      claudeCalls.push(opts);
      cfg.onUsage?.({ provider: "anthropic", model: "test-claude", inputTokens: 10, outputTokens: 5, cacheReadTokens: 0, cacheWriteTokens: 0 });
      return '{"note":"From Claude","followUp":"Thanks"}';
    };
    return {
      id: "anthropic",
      complete: answer,
      completeJson: async <T,>(opts: JsonOptions<T>) => {
        const raw = JSON.parse(await answer(opts));
        return (opts.parse ? opts.parse(raw) : raw) as T;
      },
      listModels: async () => [],
      testConnection: async () => ({ ok: true, message: "" }),
    };
  },
}));

const { db, saveSettings } = await import("../db");
const { autoFallbackReason, canFallBackToClaude, fallbackMessage, providerFor, withWriterFallback } = await import("./route");

// Obviously fake keys.
const both = { anthropicKey: "test-anthropic-key", openaiKey: "test-openai-key", resumeWriter: "openai" as const };

function fake(id: string, behaviour: () => Promise<string>): AIProvider & { calls: number } {
  const p = {
    id,
    calls: 0,
    complete: async () => {
      p.calls++;
      return behaviour();
    },
    completeJson: async <T,>() => {
      p.calls++;
      return JSON.parse(await behaviour()) as T;
    },
    listModels: async () => [],
    testConnection: async () => ({ ok: true, message: "" }),
  };
  return p;
}

const failing = (kind: AIErrorKind, provider: "openai" | "anthropic" = "openai") => () => Promise.reject(new AIError(kind, "x", provider));

beforeEach(async () => {
  claudeCalls.length = 0;
  vi.unstubAllGlobals();
  await Promise.all(db.tables.map((t) => t.clear()));
});

describe("which OpenAI failures move to Claude on their own", () => {
  it("credit, outage and network do", () => {
    expect(autoFallbackReason(new AIError("billing", "x", "openai"))).toBe("billing");
    expect(autoFallbackReason(new AIError("overloaded", "x", "openai"))).toBe("unavailable");
    expect(autoFallbackReason(new AIError("network", "x", "openai"))).toBe("unavailable");
  });

  it("key, permission, model and request problems don't (she has to fix those), nor her Cancel", () => {
    for (const kind of ["no_key", "auth", "permission", "bad_request", "cancelled", "rate_limit", "refusal", "truncated", "invalid_output", "unknown"] as AIErrorKind[]) {
      expect(autoFallbackReason(new AIError(kind, "x", "openai"))).toBeNull();
    }
    // The manual "fix key / use Claude" notice still covers the ones that need her.
    for (const kind of ["no_key", "auth", "permission", "bad_request"] as AIErrorKind[]) {
      expect(canFallBackToClaude(new AIError(kind, "x", "openai"))).toBe(true);
    }
  });

  it("Claude's own errors and plain errors never trigger it", () => {
    expect(autoFallbackReason(new AIError("billing", "x"))).toBeNull();
    expect(autoFallbackReason(new AIError("overloaded", "x", "anthropic"))).toBeNull();
    expect(autoFallbackReason(new Error("boom"))).toBeNull();
  });

  it("has a quiet line for each reason, with no em dash", () => {
    expect(fallbackMessage("billing")).toBe("Written with Claude: OpenAI was out of credit.");
    expect(fallbackMessage("unavailable")).toBe("Written with Claude: OpenAI was unavailable.");
  });
});

describe("withWriterFallback", () => {
  it.each([
    ["billing", "Written with Claude: OpenAI was out of credit."],
    ["overloaded", "Written with Claude: OpenAI was unavailable."],
    ["network", "Written with Claude: OpenAI was unavailable."],
  ] as const)("retries once on Claude after %s and says so", async (kind, message) => {
    const openai = fake("openai", failing(kind));
    const claude = fake("anthropic", async () => '"claude"');
    const onFallback = vi.fn();
    const p = withWriterFallback(openai, () => claude, onFallback);
    expect(await p.complete({ prompt: "x" })).toBe('"claude"');
    expect(await p.completeJson({ prompt: "x", schema: { type: "string" } })).toBe("claude");
    expect(openai.calls).toBe(2);
    expect(claude.calls).toBe(2);
    expect(onFallback).toHaveBeenCalledWith({ reason: kind === "billing" ? "billing" : "unavailable", message });
  });

  it.each(["auth", "permission", "bad_request", "no_key", "cancelled", "rate_limit"] as const)("does not fall back on %s", async (kind) => {
    const openai = fake("openai", failing(kind));
    const claude = fake("anthropic", async () => "claude");
    const onFallback = vi.fn();
    const p = withWriterFallback(openai, () => claude, onFallback);
    await expect(p.complete({ prompt: "x" })).rejects.toMatchObject({ kind, provider: "openai" });
    expect(claude.calls).toBe(0);
    expect(onFallback).not.toHaveBeenCalled();
  });

  it("does not fall back after she pressed Stop, even if the error looks like a network one", async () => {
    const ctrl = new AbortController();
    ctrl.abort();
    const claude = fake("anthropic", async () => "claude");
    const p = withWriterFallback(fake("openai", failing("network")), () => claude);
    await expect(p.complete({ prompt: "x", signal: ctrl.signal })).rejects.toMatchObject({ kind: "network" });
    expect(claude.calls).toBe(0);
  });

  it("keeps the OpenAI error when no Anthropic key is saved", async () => {
    const p = withWriterFallback(fake("openai", failing("billing")), () => null);
    await expect(p.complete({ prompt: "x" })).rejects.toMatchObject({ kind: "billing", provider: "openai" });
  });

  it("retries only once: if Claude fails too, Claude's error stands and no notice is shown", async () => {
    const claude = fake("anthropic", failing("overloaded", "anthropic"));
    const onFallback = vi.fn();
    const p = withWriterFallback(fake("openai", failing("billing")), () => claude, onFallback);
    await expect(p.complete({ prompt: "x" })).rejects.toMatchObject({ kind: "overloaded", provider: "anthropic" });
    expect(claude.calls).toBe(1);
    expect(onFallback).not.toHaveBeenCalled();
  });

  it("passes a successful OpenAI answer straight through", async () => {
    const claude = fake("anthropic", async () => "claude");
    const onFallback = vi.fn();
    const p = withWriterFallback(fake("openai", async () => "openai"), () => claude, onFallback);
    expect(await p.complete({ prompt: "x" })).toBe("openai");
    expect(claude.calls).toBe(0);
    expect(onFallback).not.toHaveBeenCalled();
  });
});

describe("providerFor with the automatic fallback", () => {
  function stubOpenAI(status: number, body: unknown) {
    const f = vi.fn(async () => new Response(JSON.stringify(body), { status, headers: { "content-type": "application/json" } }));
    vi.stubGlobal("fetch", f);
    return f;
  }
  const outOfCredit = { error: { message: "You exceeded your current quota.", type: "insufficient_quota", code: "insufficient_quota" } };

  it("an outreach draft that OpenAI can't pay for is written by Claude, and spend is logged under Claude", async () => {
    await saveSettings(both);
    const openaiFetch = stubOpenAI(429, outOfCredit);
    const onFallback = vi.fn();
    const p = await providerFor("draft_outreach", { onFallback });
    const out = await p.completeJson<{ note: string }>({ prompt: "x", schema: { type: "object" } });
    expect(out.note).toBe("From Claude");
    expect(openaiFetch).toHaveBeenCalled();
    expect(claudeCalls).toHaveLength(1);
    expect(onFallback).toHaveBeenCalledWith({ reason: "billing", message: "Written with Claude: OpenAI was out of credit." });
    await vi.waitFor(async () => expect(await db.aiUsage.count()).toBe(1));
    expect(await db.aiUsage.toArray()).toMatchObject([{ task: "draft_outreach", provider: "anthropic", model: "test-claude" }]);
  });

  it("an OpenAI outage (5xx) moves a resume revision to Claude", async () => {
    await saveSettings(both);
    stubOpenAI(503, { error: { message: "Service unavailable", type: "server_error" } });
    const onFallback = vi.fn();
    const p = await providerFor("revise_resume", { onFallback });
    await p.complete({ prompt: "x" });
    expect(claudeCalls).toHaveLength(1);
    expect(onFallback).toHaveBeenCalledWith(expect.objectContaining({ reason: "unavailable" }));
  });

  it("OpenAI unreachable (network) moves the recruiter review to Claude", async () => {
    await saveSettings(both);
    vi.stubGlobal("fetch", vi.fn(async () => Promise.reject(new TypeError("Failed to fetch"))));
    const onFallback = vi.fn();
    const p = await providerFor("review_resume", { onFallback });
    await p.complete({ prompt: "x" });
    expect(onFallback).toHaveBeenCalledWith(expect.objectContaining({ reason: "unavailable" }));
  });

  it("a rejected OpenAI key is not hidden: the error comes back for the fix-key notice", async () => {
    await saveSettings(both);
    stubOpenAI(401, { error: { message: "Incorrect API key provided", type: "invalid_request_error", code: "invalid_api_key" } });
    const p = await providerFor("write_resume");
    const err = await p.complete({ prompt: "x" }).catch((e) => e);
    expect(err).toMatchObject({ kind: "auth", provider: "openai" });
    expect(canFallBackToClaude(err)).toBe(true);
    expect(claudeCalls).toHaveLength(0);
  });

  it("an unknown OpenAI model is not hidden either", async () => {
    await saveSettings(both);
    stubOpenAI(404, { error: { message: "The model does not exist", type: "invalid_request_error", code: "model_not_found" } });
    const p = await providerFor("polish_resume");
    await expect(p.complete({ prompt: "x" })).rejects.toMatchObject({ kind: "bad_request", provider: "openai" });
    expect(claudeCalls).toHaveLength(0);
  });

  it("with no Anthropic key, OpenAI's credit error stands", async () => {
    await saveSettings({ openaiKey: "test-openai-key", resumeWriter: "openai" });
    stubOpenAI(429, outOfCredit);
    const p = await providerFor("draft_outreach");
    await expect(p.complete({ prompt: "x" })).rejects.toMatchObject({ kind: "billing", provider: "openai" });
  });

  it("Claude-only tasks and a Claude writer are never wrapped", async () => {
    await saveSettings(both);
    stubOpenAI(429, outOfCredit);
    expect((await providerFor("check_job")).id).toBe("anthropic");
    expect((await providerFor("draft_outreach", { override: "anthropic" })).id).toBe("anthropic");
    await (await providerFor("draft_outreach", { override: "anthropic" })).complete({ prompt: "x" });
    expect(claudeCalls).toHaveLength(1);
  });
});
