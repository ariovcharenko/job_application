import { AIError, type AIProvider, type CompleteOptions, type JsonOptions, type JsonSchema, type ModelInfo, type UsageReport } from "./provider";

// OpenAI, called straight from the browser with fetch (no SDK, so the bundle stays small). The key
// lives in this browser and goes only to api.openai.com (decision #1). Only resume writing and
// revising use it (lib/ai/route.ts); it can't read PDFs or web pages for this app, so those stay
// on Claude (`capabilities` says so).
//
// Uses Chat Completions: system + user message, strict JSON Schema output (response_format
// json_schema), max_completion_tokens, reasoning_effort for reasoning models, and SSE streaming
// for progress. Any parameter a given model refuses (effort, the token cap, streaming for an
// unverified organization, strict schemas) is dropped once and the call retried, so a model
// choice never turns into a dead end.

export const OPENAI_API_BASE = "https://api.openai.com/v1";

export interface OpenAIConfig {
  apiKey: string;
  /** The model that writes and revises resumes. */
  model: string;
  /** For tests. Defaults to the browser's fetch. */
  fetch?: typeof fetch;
  baseUrl?: string;
  /** Told the tokens of every response (the local spend meter, lib/ai/usage.ts). Never throws into the call. */
  onUsage?: (u: UsageReport) => void;
}

/** Reads Chat Completions `usage` into a UsageReport (cached prompt tokens counted apart). Exported for tests. */
export function openaiUsage(model: string, usage: unknown): UsageReport {
  const u = (usage ?? {}) as { prompt_tokens?: number; completion_tokens?: number; prompt_tokens_details?: { cached_tokens?: number } };
  const prompt = u.prompt_tokens ?? 0;
  const cached = Math.min(prompt, u.prompt_tokens_details?.cached_tokens ?? 0);
  return { provider: "openai", model, inputTokens: prompt - cached, outputTokens: u.completion_tokens ?? 0, cacheReadTokens: cached, cacheWriteTokens: 0 };
}

/**
 * Reasoning models take `reasoning_effort`; others reject it. o-series and the gpt-5 family do,
 * except the "-chat" variants. A model this misjudges still works: the 400 is caught and the
 * call retried without effort.
 */
/**
 * The app's effort for OpenAI. gpt-5's "low" still thought 25 to 50 seconds before writing a resume
 * (live, 2026-10-25); its "minimal" is the fast setting, and the code checks plus the one follow-up
 * call carry the quality. Other reasoning models (o-series) have no "minimal".
 */
export function openAIEffort(effort: "low" | "medium" | "high", model: string): string {
  return effort === "low" && /^gpt-5/i.test(model) ? "minimal" : effort;
}

export function supportsReasoningEffort(model: string): boolean {
  const m = model.toLowerCase();
  if (/-chat(-|$)/.test(m)) return false;
  return /^(o\d|gpt-5)/.test(m);
}

/**
 * Models from GET /v1/models that can write a resume through Chat Completions with a JSON
 * Schema: GPT-4o and later, o-series (not o1-mini/preview), gpt-5 family. Leaves out audio,
 * image, embedding, search, realtime and older completion models.
 */
export function isChatModel(id: string): boolean {
  const m = id.toLowerCase();
  if (!/^(gpt-|o\d|chatgpt-)/.test(m)) return false;
  if (/^gpt-3\.5|^gpt-4(-|$)|^o1-(mini|preview)/.test(m)) return false;
  return !/(audio|realtime|transcribe|tts|image|search|embedding|moderation|instruct|codex|davinci|babbage|dall-e|whisper|computer-use|deep-research)/.test(m);
}

/** A failed HTTP answer from OpenAI, before it is turned into an AIError. */
export class OpenAIHttpError extends Error {
  constructor(
    public status: number,
    message: string,
    public type?: string,
    public code?: string,
    public param?: string,
  ) {
    super(message);
    this.name = "OpenAIHttpError";
  }
}

interface Flags {
  effort: boolean;
  maxTokens: boolean;
  stream: boolean;
  strict: boolean;
}

type Format = { schema: JsonSchema };

/** The Chat Completions request body. Exported for tests. */
export function buildRequest(model: string, opts: CompleteOptions, format: Format | undefined, flags: Flags): Record<string, unknown> {
  const messages = [
    ...(opts.system ? [{ role: "system", content: opts.system }] : []),
    { role: "user", content: opts.prompt },
  ];
  const body: Record<string, unknown> = { model, messages };
  if (flags.maxTokens) body.max_completion_tokens = opts.maxTokens ?? 16000;
  if (flags.effort && opts.effort && supportsReasoningEffort(model)) body.reasoning_effort = openAIEffort(opts.effort, model);
  if (format) {
    body.response_format = { type: "json_schema", json_schema: { name: "response", strict: flags.strict, schema: format.schema } };
  }
  if (flags.stream) {
    body.stream = true;
    // The last event then carries the token usage, for the spend meter.
    body.stream_options = { include_usage: true };
  }
  return body;
}

/** Which parameter to drop when OpenAI refuses one; null = the error stands. Exported for tests. */
export function adjustFor(err: OpenAIHttpError, flags: Flags, sent: Record<string, unknown>): Flags | null {
  if (err.status !== 400) return null;
  const param = (err.param ?? "").toLowerCase();
  const msg = err.message.toLowerCase();
  if (sent.reasoning_effort !== undefined && (param.includes("reasoning_effort") || msg.includes("reasoning_effort") || msg.includes("reasoning.effort"))) {
    return { ...flags, effort: false };
  }
  if (sent.max_completion_tokens !== undefined && (param.includes("max_completion_tokens") || param.includes("max_tokens") || msg.includes("max_completion_tokens") || msg.includes("max_tokens"))) {
    return { ...flags, maxTokens: false };
  }
  if (sent.stream && (param === "stream" || /verif/.test(msg))) return { ...flags, stream: false };
  if (flags.strict && sent.response_format && (param.includes("response_format") || msg.includes("json_schema") || msg.includes("schema"))) {
    return { ...flags, strict: false };
  }
  return null;
}

async function readError(res: Response): Promise<OpenAIHttpError> {
  let body: { error?: { message?: unknown; type?: unknown; code?: unknown; param?: unknown } } | undefined;
  try {
    body = await res.json();
  } catch {
    // Not JSON (a proxy's HTML page, say); the status alone decides.
  }
  const e = body?.error;
  const str = (v: unknown) => (typeof v === "string" && v ? v : undefined);
  return new OpenAIHttpError(res.status, str(e?.message) ?? `HTTP ${res.status}`, str(e?.type), str(e?.code), str(e?.param));
}

interface Answer {
  text: string;
  refusal: string;
  finish: string | null;
  usage?: unknown;
}

/** Reads a server-sent-events body into the answer, reporting characters as they arrive. Exported for tests. */
export async function readStream(body: ReadableStream<Uint8Array>, onProgress?: (chars: number) => void): Promise<Answer> {
  const reader = body.getReader();
  const decoder = new TextDecoder();
  const out: Answer = { text: "", refusal: "", finish: null };
  let buffer = "";
  const handle = (line: string) => {
    if (!line.startsWith("data:")) return;
    const data = line.slice(5).trim();
    if (!data || data === "[DONE]") return;
    let chunk: {
      usage?: unknown;
      error?: { message?: string; type?: string; code?: string };
      choices?: { delta?: { content?: string | null; refusal?: string | null }; finish_reason?: string | null }[];
    };
    try {
      chunk = JSON.parse(data);
    } catch {
      return;
    }
    if (chunk.error) {
      const status = chunk.error.type === "server_error" ? 500 : 400;
      throw new OpenAIHttpError(status, chunk.error.message ?? "Stream error", chunk.error.type, chunk.error.code);
    }
    if (chunk.usage) out.usage = chunk.usage;
    const choice = chunk.choices?.[0];
    if (!choice) return;
    if (choice.delta?.content) {
      out.text += choice.delta.content;
      onProgress?.(out.text.length);
    }
    if (choice.delta?.refusal) out.refusal += choice.delta.refusal;
    if (choice.finish_reason) out.finish = choice.finish_reason;
  };
  for (;;) {
    const { done, value } = await reader.read();
    if (done) break;
    buffer += decoder.decode(value, { stream: true });
    let nl: number;
    while ((nl = buffer.indexOf("\n")) >= 0) {
      handle(buffer.slice(0, nl).replace(/\r$/, ""));
      buffer = buffer.slice(nl + 1);
    }
  }
  buffer += decoder.decode();
  if (buffer.trim()) handle(buffer.trim());
  return out;
}

export function createOpenAIProvider(cfg: OpenAIConfig): AIProvider {
  const base = (cfg.baseUrl ?? OPENAI_API_BASE).replace(/\/+$/, "");
  const doFetch: typeof fetch = (...args) => (cfg.fetch ?? globalThis.fetch)(...args);
  const headers = { Authorization: `Bearer ${cfg.apiKey}`, "Content-Type": "application/json" };

  async function call(opts: CompleteOptions, format?: Format): Promise<string> {
    if (opts.attachments?.length) {
      throw new AIError("bad_request", "OpenAI can't read attached files in this app. This step uses Claude.", "openai");
    }
    let flags: Flags = { effort: true, maxTokens: true, stream: !!opts.onProgress, strict: true };
    let answer: Answer;
    try {
      for (let attempt = 0; ; attempt++) {
        const body = buildRequest(cfg.model, opts, format, flags);
        const res = await doFetch(`${base}/chat/completions`, {
          method: "POST",
          headers,
          body: JSON.stringify(body),
          signal: opts.signal,
        });
        if (!res.ok) {
          const err = await readError(res);
          const next = attempt < 4 ? adjustFor(err, flags, body) : null;
          if (next) {
            flags = next;
            continue;
          }
          throw err;
        }
        if (flags.stream && res.body) {
          opts.onProgress?.(0);
          answer = await readStream(res.body, opts.onProgress);
        } else {
          const json = (await res.json()) as {
            usage?: unknown;
            choices?: { message?: { content?: string | null; refusal?: string | null }; finish_reason?: string | null }[];
          };
          const c = json.choices?.[0];
          answer = { text: c?.message?.content ?? "", refusal: c?.message?.refusal ?? "", finish: c?.finish_reason ?? null, usage: json.usage };
          opts.onProgress?.(answer.text.length);
        }
        break;
      }
    } catch (err) {
      throw toOpenAIError(err);
    }
    if (answer.usage && cfg.onUsage) {
      try {
        cfg.onUsage(openaiUsage(cfg.model, answer.usage));
      } catch {
        // The meter must never break a call.
      }
    }
    if (answer.refusal || answer.finish === "content_filter") {
      throw new AIError("refusal", "The OpenAI model declined this request.", "openai");
    }
    if (answer.finish === "length") {
      throw new AIError("truncated", "The response was cut off. Try again, or pick an OpenAI model with a larger output limit.", "openai");
    }
    return answer.text;
  }

  async function getJson(path: string): Promise<unknown> {
    let res: Response;
    try {
      res = await doFetch(`${base}${path}`, { headers: { Authorization: headers.Authorization } });
    } catch (err) {
      throw toOpenAIError(err);
    }
    if (!res.ok) throw toOpenAIError(await readError(res));
    return res.json();
  }

  return {
    id: "openai",
    capabilities: { attachments: false, webFetch: false },

    complete: (opts) => call(opts),

    async completeJson<T>(opts: JsonOptions<T>): Promise<T> {
      const text = await call(opts, { schema: opts.schema });
      let raw: unknown;
      try {
        raw = JSON.parse(text);
      } catch {
        throw new AIError("invalid_output", "The OpenAI model returned text that is not valid JSON.", "openai");
      }
      if (!opts.parse) return raw as T;
      try {
        return opts.parse(raw);
      } catch (err) {
        throw new AIError("invalid_output", `The OpenAI model's JSON did not match the expected shape: ${String(err)}`, "openai");
      }
    },

    async listModels(): Promise<ModelInfo[]> {
      const json = (await getJson("/models")) as { data?: { id?: string; created?: number }[] };
      return (json.data ?? [])
        .filter((m): m is { id: string; created?: number } => typeof m.id === "string" && isChatModel(m.id))
        .sort((a, b) => (b.created ?? 0) - (a.created ?? 0))
        .map((m) => ({ id: m.id, label: m.id }));
    },

    // Reads the model's listing (free), then sends one tiny request (a fraction of a cent): the
    // listing works even on an account with no credit, which said "Connected" while every real
    // call failed with 429 insufficient_quota (found live 2026-10-25).
    async testConnection() {
      try {
        await getJson(`/models/${encodeURIComponent(cfg.model)}`);
        let res: Response;
        try {
          res = await doFetch(`${base}/chat/completions`, {
            method: "POST",
            headers,
            body: JSON.stringify({ model: cfg.model, messages: [{ role: "user", content: "Reply with OK." }], max_completion_tokens: 16 }),
          });
        } catch (err) {
          throw toOpenAIError(err);
        }
        if (!res.ok) {
          const e = toOpenAIError(await readError(res));
          // A parameter this model refuses still proves the key and the account work.
          if (e.kind === "auth" || e.kind === "billing" || e.kind === "rate_limit" || e.kind === "permission") throw e;
        }
        return { ok: true, message: `Connected. The key works with ${cfg.model} and the account can run requests.` };
      } catch (err) {
        const e = err instanceof AIError ? err : toOpenAIError(err);
        return { ok: false, message: e.message };
      }
    },
  };
}

const NETWORK_MESSAGE =
  "Couldn't reach OpenAI. Check your connection, or an ad blocker or privacy extension that may block api.openai.com.";

/** Maps anything a call to OpenAI threw into the app's error kinds (lib/ai/errors.ts shows them). */
export function toOpenAIError(err: unknown): AIError {
  if (err instanceof AIError) return err;
  const fail = (kind: AIError["kind"], message: string) => new AIError(kind, message, "openai");
  if (err instanceof OpenAIHttpError) {
    const msg = err.message;
    const code = err.code ?? "";
    if (err.status === 401) {
      return fail("auth", "OpenAI rejected this API key. It may be mistyped or revoked. Copy it again from platform.openai.com/api-keys.");
    }
    if (err.status === 429 && (code === "insufficient_quota" || err.type === "insufficient_quota" || /quota|billing/i.test(msg))) {
      return fail("billing", "Your OpenAI account is out of credit or reached its budget. Add credit in the OpenAI billing settings, then try again.");
    }
    if (err.status === 429) return fail("rate_limit", "OpenAI is limiting how fast this key can make requests. Try again in a minute.");
    if (err.status === 404 || code === "model_not_found") {
      return fail("bad_request", "That OpenAI model wasn't found, or this key can't use it. Pick a different OpenAI model in Settings.");
    }
    if (err.status === 403) {
      return fail("permission", `This OpenAI key isn't allowed to do that: ${msg.replace(/\.?\s*$/, ".")} Check the key's project in the OpenAI dashboard, or choose another model in Settings.`);
    }
    if (code === "context_length_exceeded" || /context length|maximum context/i.test(msg)) {
      return fail("bad_request", "The job description and your experience are too long for this OpenAI model. Pick a model with a larger context in Settings.");
    }
    if (err.status === 400) return fail("bad_request", `OpenAI rejected the request: ${msg}`);
    if (err.status >= 500) return fail("overloaded", "OpenAI is having trouble right now. Nothing is wrong on your side. Try again in a minute.");
    return fail("unknown", `OpenAI error ${err.status}: ${msg}`);
  }
  if (err instanceof Error && err.name === "AbortError") return fail("cancelled", "Stopped.");
  if (err instanceof TypeError && /fetch|network|load failed/i.test(err.message)) return fail("network", NETWORK_MESSAGE);
  return fail("unknown", err instanceof Error ? err.message : String(err));
}
