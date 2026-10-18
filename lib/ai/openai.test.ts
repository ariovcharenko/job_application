import { describe, expect, it, vi } from "vitest";
import { RESUME_DOC_JSON_SCHEMA, RESUME_REVISION_JSON_SCHEMA } from "../resume/engine/schema";
import { buildRequest, createOpenAIProvider, isChatModel, OpenAIHttpError, readStream, supportsReasoningEffort, toOpenAIError } from "./openai";
import { AIError } from "./provider";

// Obviously fake: no real key format.
const KEY = "test-openai-key";

type Call = { url: string; init: RequestInit & { body?: string } };

function json(body: unknown, status = 200) {
  return new Response(JSON.stringify(body), { status, headers: { "Content-Type": "application/json" } });
}

function chat(content: string, finish = "stop", extra: Record<string, unknown> = {}) {
  return json({ choices: [{ message: { content, refusal: null, ...extra }, finish_reason: finish }] });
}

function sse(chunks: string[]) {
  const enc = new TextEncoder();
  return new Response(
    new ReadableStream({
      start(c) {
        for (const ch of chunks) c.enqueue(enc.encode(ch));
        c.close();
      },
    }),
    { status: 200, headers: { "Content-Type": "text/event-stream" } },
  );
}

const delta = (content: string, finish: string | null = null) => `data: ${JSON.stringify({ choices: [{ delta: { content }, finish_reason: finish }] })}\n\n`;

function fakeFetch(...responses: (Response | Error)[]) {
  const calls: Call[] = [];
  const fn = vi.fn(async (url: string, init: RequestInit) => {
    calls.push({ url, init: init as Call["init"] });
    const next = responses.shift();
    if (!next) throw new Error("no more fake responses");
    if (next instanceof Error) throw next;
    return next;
  });
  return { fetch: fn as unknown as typeof fetch, calls, body: (i = 0) => JSON.parse(calls[i].init.body as string) };
}

const provider = (f: typeof fetch, model = "gpt-5") => createOpenAIProvider({ apiKey: KEY, model, fetch: f });

describe("openai provider: requests", () => {
  it("sends system + user messages, the token cap and the bearer key to chat completions", async () => {
    const f = fakeFetch(chat("hello"));
    const out = await provider(f.fetch).complete({ prompt: "write", system: "rules", maxTokens: 500 });
    expect(out).toBe("hello");
    expect(f.calls[0].url).toBe("https://api.openai.com/v1/chat/completions");
    expect((f.calls[0].init.headers as Record<string, string>).Authorization).toBe(`Bearer ${KEY}`);
    const body = f.body();
    expect(body.model).toBe("gpt-5");
    expect(body.messages).toEqual([
      { role: "system", content: "rules" },
      { role: "user", content: "write" },
    ]);
    expect(body.max_completion_tokens).toBe(500);
    expect(body).not.toHaveProperty("max_tokens");
    expect(body).not.toHaveProperty("stream");
  });

  it("enforces the JSON contract with a strict json_schema and parses the answer", async () => {
    const f = fakeFetch(chat('{"score":80}'));
    const schema = { type: "object", additionalProperties: false, required: ["score"], properties: { score: { type: "number" } } };
    const out = await provider(f.fetch).completeJson<{ score: number }>({ prompt: "x", schema, parse: (r) => r as { score: number } });
    expect(out.score).toBe(80);
    expect(f.body().response_format).toEqual({ type: "json_schema", json_schema: { name: "response", strict: true, schema } });
  });

  it("maps effort to reasoning_effort only for reasoning models", () => {
    const opts = { prompt: "x", effort: "medium" as const };
    const flags = { effort: true, maxTokens: true, stream: false, strict: true };
    expect(buildRequest("gpt-5", opts, undefined, flags).reasoning_effort).toBe("medium");
    expect(buildRequest("o4-mini", opts, undefined, flags).reasoning_effort).toBe("medium");
    expect(buildRequest("gpt-4.1", opts, undefined, flags)).not.toHaveProperty("reasoning_effort");
    expect(buildRequest("gpt-5-chat-latest", opts, undefined, flags)).not.toHaveProperty("reasoning_effort");
    expect(supportsReasoningEffort("gpt-4o")).toBe(false);
  });

  it("refuses attachments (PDF import stays on Claude) and says so in capabilities", async () => {
    const f = fakeFetch();
    const p = provider(f.fetch);
    expect(p.capabilities).toEqual({ attachments: false, webFetch: false });
    expect(p.fetchUrl).toBeUndefined();
    await expect(p.complete({ prompt: "x", attachments: [{ mediaType: "application/pdf", base64: "AA==" }] })).rejects.toMatchObject({
      kind: "bad_request",
      provider: "openai",
    });
    expect(f.calls).toHaveLength(0);
  });

  it("passes the abort signal and reports a cancel as a cancelled request", async () => {
    const ctrl = new AbortController();
    const abort = Object.assign(new Error("aborted"), { name: "AbortError" });
    const f = fakeFetch(abort);
    const err = await provider(f.fetch).complete({ prompt: "x", signal: ctrl.signal }).catch((e) => e);
    expect(f.calls[0].init.signal).toBe(ctrl.signal);
    expect(err).toBeInstanceOf(AIError);
    expect(err.kind).toBe("cancelled");
  });
});

describe("openai usage for the spend meter", () => {
  it("reports usage from a plain answer, counting cached prompt tokens apart", async () => {
    const f = fakeFetch(
      json({
        choices: [{ message: { content: "ok" }, finish_reason: "stop" }],
        usage: { prompt_tokens: 1000, completion_tokens: 200, prompt_tokens_details: { cached_tokens: 600 } },
      }),
    );
    const seen: unknown[] = [];
    await createOpenAIProvider({ apiKey: KEY, model: "test-model", fetch: f.fetch, onUsage: (u) => seen.push(u) }).complete({ prompt: "x" });
    expect(seen).toEqual([{ provider: "openai", model: "test-model", inputTokens: 400, outputTokens: 200, cacheReadTokens: 600, cacheWriteTokens: 0 }]);
  });

  it("asks for usage in the stream and reads it from the last event", async () => {
    const usage = `data: ${JSON.stringify({ choices: [], usage: { prompt_tokens: 50, completion_tokens: 7 } })}\n\n`;
    const f = fakeFetch(sse([delta("hi", "stop"), usage, "data: [DONE]\n\n"]));
    const seen: { outputTokens: number }[] = [];
    await createOpenAIProvider({ apiKey: KEY, model: "test-model", fetch: f.fetch, onUsage: (u) => seen.push(u) }).complete({ prompt: "x", onProgress: () => {} });
    expect(f.body().stream_options).toEqual({ include_usage: true });
    expect(seen[0].outputTokens).toBe(7);
  });
});

describe("openai provider: streaming", () => {
  it("streams when onProgress is given and reports characters as they arrive", async () => {
    const f = fakeFetch(sse([delta('{"a":'), delta('1}'), delta("", "stop"), "data: [DONE]\n\n"]));
    const seen: number[] = [];
    const out = await provider(f.fetch).completeJson<{ a: number }>({ prompt: "x", schema: { type: "object" }, onProgress: (n) => seen.push(n) });
    expect(out).toEqual({ a: 1 });
    expect(f.body().stream).toBe(true);
    expect(seen).toEqual([0, 5, 7]);
  });

  it("parses events split across network chunks", async () => {
    const whole = delta("Hello ") + delta("world", "stop");
    const enc = new TextEncoder().encode(whole);
    const body = new ReadableStream<Uint8Array>({
      start(c) {
        c.enqueue(enc.slice(0, 13));
        c.enqueue(enc.slice(13, 40));
        c.enqueue(enc.slice(40));
        c.close();
      },
    });
    const out = await readStream(body);
    expect(out).toEqual({ text: "Hello world", refusal: "", finish: "stop" });
  });

  it("turns an error event inside the stream into an error", async () => {
    const f = fakeFetch(sse([delta("{"), `data: ${JSON.stringify({ error: { message: "boom", type: "server_error" } })}\n\n`]));
    await expect(provider(f.fetch).complete({ prompt: "x", onProgress: () => {} })).rejects.toMatchObject({ kind: "overloaded", provider: "openai" });
  });

  it("reports a cut-off stream as truncated and a refusal as refusal", async () => {
    const cut = fakeFetch(sse([delta('{"a":', "length")]));
    await expect(provider(cut.fetch).complete({ prompt: "x", onProgress: () => {} })).rejects.toMatchObject({ kind: "truncated" });
    const refused = fakeFetch(chat("", "stop", { refusal: "I can't help with that." }));
    await expect(provider(refused.fetch).complete({ prompt: "x" })).rejects.toMatchObject({ kind: "refusal" });
  });
});

describe("openai provider: retries a refused parameter once", () => {
  it("drops reasoning_effort when the model rejects it", async () => {
    const f = fakeFetch(json({ error: { message: "Unsupported parameter: 'reasoning_effort'", type: "invalid_request_error", param: "reasoning_effort" } }, 400), chat("ok"));
    expect(await provider(f.fetch).complete({ prompt: "x", effort: "medium" })).toBe("ok");
    expect(f.body(0).reasoning_effort).toBe("medium");
    expect(f.body(1)).not.toHaveProperty("reasoning_effort");
  });

  it("drops the token cap when it is above the model's limit", async () => {
    const f = fakeFetch(json({ error: { message: "max_completion_tokens is too large: 20000.", param: "max_completion_tokens" } }, 400), chat("ok"));
    expect(await provider(f.fetch, "gpt-4o").complete({ prompt: "x", maxTokens: 20000 })).toBe("ok");
    expect(f.body(1)).not.toHaveProperty("max_completion_tokens");
  });

  it("falls back to a non-streaming call when the organization can't stream this model", async () => {
    const f = fakeFetch(
      json({ error: { message: "Your organization must be verified to stream this model.", param: "stream", code: "unsupported_value" } }, 400),
      chat("done"),
    );
    const seen: number[] = [];
    expect(await provider(f.fetch).complete({ prompt: "x", onProgress: (n) => seen.push(n) })).toBe("done");
    expect(f.body(1)).not.toHaveProperty("stream");
    expect(seen).toEqual([4]);
  });

  it("doesn't retry a plain bad request", async () => {
    const f = fakeFetch(json({ error: { message: "Something else is wrong" } }, 400));
    await expect(provider(f.fetch).complete({ prompt: "x" })).rejects.toMatchObject({ kind: "bad_request" });
    expect(f.calls).toHaveLength(1);
  });
});

describe("openai errors map to the app's kinds", () => {
  const cases: [number, Record<string, string>, string][] = [
    [401, { message: "Incorrect API key provided", code: "invalid_api_key" }, "auth"],
    [429, { message: "You exceeded your current quota", type: "insufficient_quota", code: "insufficient_quota" }, "billing"],
    [429, { message: "Rate limit reached for requests" }, "rate_limit"],
    [404, { message: "The model `nope` does not exist", code: "model_not_found" }, "bad_request"],
    [403, { message: "Project does not have access" }, "permission"],
    [400, { message: "This model's maximum context length is 128000 tokens.", code: "context_length_exceeded" }, "bad_request"],
    [503, { message: "Service unavailable" }, "overloaded"],
    [418, { message: "teapot" }, "unknown"],
  ];
  it.each(cases)("HTTP %i -> %s", async (status, error, kind) => {
    const f = fakeFetch(json({ error }, status));
    const err = await provider(f.fetch).complete({ prompt: "x" }).catch((e) => e);
    expect(err).toBeInstanceOf(AIError);
    expect(err.kind).toBe(kind);
    expect(err.provider).toBe("openai");
  });

  it("names the context-length problem plainly", () => {
    const e = toOpenAIError(new OpenAIHttpError(400, "maximum context length is 8192 tokens", undefined, "context_length_exceeded"));
    expect(e.message).toMatch(/too long for this OpenAI model/);
  });

  it("treats a failed fetch as a network problem naming api.openai.com", async () => {
    const f = fakeFetch(new TypeError("Failed to fetch"));
    const err = await provider(f.fetch).complete({ prompt: "x" }).catch((e) => e);
    expect(err.kind).toBe("network");
    expect(err.message).toContain("api.openai.com");
  });

  it("reports invalid JSON as invalid_output", async () => {
    const f = fakeFetch(chat("not json"));
    await expect(provider(f.fetch).completeJson({ prompt: "x", schema: {} })).rejects.toMatchObject({ kind: "invalid_output", provider: "openai" });
  });
});

describe("models and connection test", () => {
  it("lists only chat-capable models, newest first", async () => {
    const f = fakeFetch(
      json({
        data: [
          { id: "gpt-4o", created: 1 },
          { id: "text-embedding-3-small", created: 5 },
          { id: "gpt-5-mini", created: 9 },
          { id: "dall-e-3", created: 3 },
          { id: "gpt-4o-realtime-preview", created: 4 },
          { id: "whisper-1", created: 2 },
          { id: "o3", created: 7 },
        ],
      }),
    );
    const models = await provider(f.fetch).listModels();
    expect(models.map((m) => m.id)).toEqual(["gpt-5-mini", "o3", "gpt-4o"]);
    expect(f.calls[0].url).toBe("https://api.openai.com/v1/models");
  });

  it("filters out models without structured output support", () => {
    expect(isChatModel("gpt-3.5-turbo")).toBe(false);
    expect(isChatModel("gpt-4")).toBe(false);
    expect(isChatModel("gpt-4-turbo")).toBe(false);
    expect(isChatModel("o1-mini")).toBe(false);
    expect(isChatModel("gpt-4.1")).toBe(true);
    expect(isChatModel("gpt-5")).toBe(true);
    expect(isChatModel("gpt-4o-mini-tts")).toBe(false);
  });

  it("tests the connection for free by reading the chosen model, never spending tokens", async () => {
    const ok = fakeFetch(json({ id: "gpt-5" }));
    expect(await provider(ok.fetch).testConnection()).toEqual({ ok: true, message: "Connected. The key works with gpt-5." });
    expect(ok.calls[0].url).toBe("https://api.openai.com/v1/models/gpt-5");
    expect(ok.calls[0].init.method).toBeUndefined();
    const bad = fakeFetch(json({ error: { message: "Incorrect API key" } }, 401));
    const r = await provider(bad.fetch).testConnection();
    expect(r.ok).toBe(false);
    expect(r.message).toMatch(/OpenAI rejected this API key/);
  });
});

describe("resume schemas work with OpenAI strict structured outputs", () => {
  // Strict mode needs every object closed (additionalProperties: false) with every key required.
  function checkStrict(node: unknown, path = "$"): string[] {
    if (!node || typeof node !== "object") return [];
    const n = node as Record<string, unknown>;
    const problems: string[] = [];
    if (n.type === "object") {
      const keys = Object.keys((n.properties as object) ?? {});
      if (n.additionalProperties !== false) problems.push(`${path}: additionalProperties`);
      const req = (n.required as string[]) ?? [];
      if (keys.some((k) => !req.includes(k))) problems.push(`${path}: required`);
      for (const k of keys) problems.push(...checkStrict((n.properties as Record<string, unknown>)[k], `${path}.${k}`));
    }
    if (n.type === "array") problems.push(...checkStrict(n.items, `${path}[]`));
    return problems;
  }
  it("the tailored resume and revision schemas are strict-compatible", () => {
    expect(checkStrict(RESUME_DOC_JSON_SCHEMA)).toEqual([]);
    expect(checkStrict(RESUME_REVISION_JSON_SCHEMA)).toEqual([]);
  });
});
