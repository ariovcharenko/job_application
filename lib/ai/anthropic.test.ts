import Anthropic from "@anthropic-ai/sdk";
import { describe, expect, it, vi } from "vitest";
import { createAnthropicProvider } from "./anthropic";
import { AIError } from "./provider";

const cfg = { apiKey: "test", fastModel: "fast-model", smartModel: "smart-model" };

function fakeClient(reply: { text?: string; stop_reason?: string } | Error) {
  const create = vi.fn(async (_args: Record<string, unknown>) => {
    if (reply instanceof Error) throw reply;
    return {
      stop_reason: reply.stop_reason ?? "end_turn",
      content: [{ type: "text", text: reply.text ?? "" }],
    };
  });
  return { client: { messages: { create } } as unknown as Anthropic, create };
}

describe("anthropic provider", () => {
  it("routes the fast tier to the fast model and omits sampling params", async () => {
    const { client, create } = fakeClient({ text: "hi" });
    const out = await createAnthropicProvider(cfg, client).complete({ prompt: "x", tier: "fast" });
    expect(out).toBe("hi");
    const args = create.mock.calls[0][0];
    expect(args.model).toBe("fast-model");
    expect(args).not.toHaveProperty("temperature");
  });

  it("defaults to the smart model and caches the system prompt on request", async () => {
    const { client, create } = fakeClient({ text: "ok" });
    await createAnthropicProvider(cfg, client).complete({ prompt: "x", system: "resume", cacheSystem: true });
    const args = create.mock.calls[0][0] as { model: string; system: unknown };
    expect(args.model).toBe("smart-model");
    expect(args.system).toEqual([{ type: "text", text: "resume", cache_control: { type: "ephemeral" } }]);
  });

  it("sends the JSON schema through output_config.format and parses the result", async () => {
    const { client, create } = fakeClient({ text: '{"score":80}' });
    const schema = { type: "object", properties: { score: { type: "number" } }, required: ["score"] };
    const out = await createAnthropicProvider(cfg, client).completeJson<{ score: number }>({ prompt: "x", schema });
    expect(out.score).toBe(80);
    expect((create.mock.calls[0][0] as { output_config: unknown }).output_config).toEqual({
      format: { type: "json_schema", schema },
    });
  });

  it("sends effort to the smart model with the schema, and never to the fast model", async () => {
    const smart = fakeClient({ text: "{}" });
    await createAnthropicProvider(cfg, smart.client).completeJson({ prompt: "x", schema: { type: "object" }, effort: "medium" });
    expect((smart.create.mock.calls[0][0] as { output_config: unknown }).output_config).toEqual({
      format: { type: "json_schema", schema: { type: "object" } },
      effort: "medium",
    });
    const fast = fakeClient({ text: "hi" });
    await createAnthropicProvider(cfg, fast.client).complete({ prompt: "x", tier: "fast", effort: "medium" });
    expect((fast.create.mock.calls[0][0] as { output_config?: unknown }).output_config).toBeUndefined();
  });

  it("reports invalid JSON and failed validation as invalid_output", async () => {
    const bad = fakeClient({ text: "not json" });
    await expect(
      createAnthropicProvider(cfg, bad.client).completeJson({ prompt: "x", schema: {} }),
    ).rejects.toMatchObject({ kind: "invalid_output" });

    const wrongShape = fakeClient({ text: '{"a":1}' });
    await expect(
      createAnthropicProvider(cfg, wrongShape.client).completeJson({
        prompt: "x",
        schema: {},
        parse: () => {
          throw new Error("missing score");
        },
      }),
    ).rejects.toMatchObject({ kind: "invalid_output" });
  });

  it("maps refusals and truncation to typed errors", async () => {
    await expect(
      createAnthropicProvider(cfg, fakeClient({ stop_reason: "refusal" }).client).complete({ prompt: "x" }),
    ).rejects.toMatchObject({ kind: "refusal" });
    await expect(
      createAnthropicProvider(cfg, fakeClient({ stop_reason: "max_tokens" }).client).complete({ prompt: "x" }),
    ).rejects.toMatchObject({ kind: "truncated" });
  });

  it("maps SDK errors and reports them from testConnection", async () => {
    const auth = new Anthropic.AuthenticationError(401, {}, "bad key", new Headers());
    const provider = createAnthropicProvider(cfg, fakeClient(auth).client);
    await expect(provider.complete({ prompt: "x" })).rejects.toBeInstanceOf(AIError);
    const result = await provider.testConnection();
    expect(result.ok).toBe(false);
    expect(result.message).toMatch(/rejected this API key/);
  });

  it("turns the 'not scoped to a workspace' 400 into a plain instruction", async () => {
    const body = {
      type: "error",
      error: {
        type: "invalid_request_error",
        message: "This API key is not scoped to a workspace, so this request must include the anthropic-workspace-id header.",
      },
    };
    const err = new Anthropic.BadRequestError(400, body, "400 " + JSON.stringify(body), new Headers());
    const result = await createAnthropicProvider(cfg, fakeClient(err).client).testConnection();
    expect(result.ok).toBe(false);
    expect(result.message).toMatch(/Workspace ID/);
    expect(result.message).not.toContain("{");
  });

  it("says the Workspace ID is wrong (not missing) when the API rejects the value", async () => {
    const body = {
      type: "error",
      error: { type: "invalid_request_error", message: "anthropic-workspace-id header must be a valid workspace ID." },
    };
    const err = new Anthropic.BadRequestError(400, body, "400 " + JSON.stringify(body), new Headers());
    const result = await createAnthropicProvider(cfg, fakeClient(err).client).testConnection();
    expect(result.message).toMatch(/was not accepted/);
    expect(result.message).not.toMatch(/not tied to a workspace/);
  });

  it("shows the API's own message for other 400s instead of raw JSON", async () => {
    const body = { type: "error", error: { type: "invalid_request_error", message: "max_tokens too large" } };
    const err = new Anthropic.BadRequestError(400, body, "400 " + JSON.stringify(body), new Headers());
    await expect(createAnthropicProvider(cfg, fakeClient(err).client).complete({ prompt: "x" })).rejects.toMatchObject({
      message: "Anthropic rejected the request: max_tokens too large",
    });
  });
});

describe("workspace header and model list", () => {
  describe("request headers", () => {
    const okResponse = () =>
      new Response(
        JSON.stringify({
          id: "msg_1",
          type: "message",
          role: "assistant",
          model: "m",
          content: [{ type: "text", text: "OK" }],
          stop_reason: "end_turn",
          stop_sequence: null,
          usage: { input_tokens: 1, output_tokens: 1 },
        }),
        { status: 200, headers: { "content-type": "application/json" } },
      );

    async function sentHeaders(workspaceId?: string) {
      const fetchMock = vi.fn(async (_url: unknown, _init?: RequestInit) => okResponse());
      vi.stubGlobal("fetch", fetchMock);
      try {
        await createAnthropicProvider({ ...cfg, workspaceId }).complete({ prompt: "x" });
        return new Headers(fetchMock.mock.calls[0][1]?.headers as HeadersInit);
      } finally {
        vi.unstubAllGlobals();
      }
    }

    it("sends anthropic-workspace-id when a workspace ID is set", async () => {
      const h = await sentHeaders("  wrkspc_123 ");
      expect(h.get("anthropic-workspace-id")).toBe("wrkspc_123");
      expect(h.get("anthropic-dangerous-direct-browser-access")).toBe("true");
    });

    it("omits the header when the workspace ID is empty", async () => {
      expect((await sentHeaders("")).has("anthropic-workspace-id")).toBe(false);
      expect((await sentHeaders(undefined)).has("anthropic-workspace-id")).toBe(false);
    });
  });

  it("lists only Claude models, using display names", async () => {
    const list = () =>
      (async function* () {
        yield { id: "claude-sonnet-5", display_name: "Claude Sonnet 5" };
        yield { id: "some-other-model", display_name: "Other" };
        yield { id: "claude-haiku-4-5", display_name: "" };
      })();
    const client = { models: { list } } as unknown as Anthropic;
    const models = await createAnthropicProvider(cfg, client).listModels();
    expect(models).toEqual([
      { id: "claude-sonnet-5", label: "Claude Sonnet 5" },
      { id: "claude-haiku-4-5", label: "claude-haiku-4-5" },
    ]);
  });
});

describe("readFetchResult", () => {
  const msg = (content: unknown[]) => ({ content, stop_reason: "end_turn" }) as unknown as Anthropic.Message;
  const page = (data: string) =>
    msg([
      {
        type: "web_fetch_tool_result",
        tool_use_id: "t",
        content: {
          type: "web_fetch_result",
          url: "https://x.co/job",
          retrieved_at: null,
          content: { type: "document", title: "SWE at X", citations: null, source: { type: "text", media_type: "text/plain", data } },
        },
      },
    ]);

  it("returns the page text and title", async () => {
    const { readFetchResult } = await import("./anthropic");
    const text = "We are hiring a software engineer. ".repeat(20);
    expect(readFetchResult(page(text), "https://x.co/job")).toEqual({ url: "https://x.co/job", title: "SWE at X", text: text.trim() });
  });

  it("explains a JavaScript-only page and suggests pasting", async () => {
    const { readFetchResult } = await import("./anthropic");
    expect(() => readFetchResult(page("Loading..."), "u")).toThrow(/JavaScript.*Paste the job description/);
  });

  it("turns fetch error codes into plain messages", async () => {
    const { readFetchResult } = await import("./anthropic");
    const err = msg([{ type: "web_fetch_tool_result", tool_use_id: "t", content: { type: "web_fetch_tool_result_error", error_code: "url_not_accessible" } }]);
    expect(() => readFetchResult(err, "u")).toThrow(/couldn't be opened/);
    expect(() => readFetchResult(msg([{ type: "text", text: "DONE" }]), "u")).toThrow(AIError);
  });
});

describe("actionable error kinds", () => {
  const apiErr = (status: number, message: string, type = "invalid_request_error") => {
    const body = { type: "error", error: { type, message } };
    return Anthropic.APIError.generate(status, body, `${status} ${JSON.stringify(body)}`, new Headers());
  };
  const errorFrom = async (err: unknown): Promise<AIError> => {
    try {
      await createAnthropicProvider(cfg, fakeClient(err as Error).client).complete({ prompt: "x" });
    } catch (e) {
      return e as AIError;
    }
    throw new Error("expected a rejection");
  };

  it("400 'credit balance is too low' is billing, with the billing page in the message", async () => {
    const e = await errorFrom(
      apiErr(400, "Your credit balance is too low to access the Anthropic API. Please go to Plans & Billing to upgrade or purchase credits."),
    );
    expect(e.kind).toBe("billing");
    expect(e.message).toContain("console.anthropic.com/settings/billing");
  });

  it("401 is auth", async () => {
    expect((await errorFrom(apiErr(401, "invalid x-api-key", "authentication_error"))).kind).toBe("auth");
  });

  it("403 is permission, and keeps the API's reason", async () => {
    const e = await errorFrom(apiErr(403, "Your API key does not have permission to use the specified resource", "permission_error"));
    expect(e.kind).toBe("permission");
    expect(e.message).toContain("does not have permission");
  });

  it("429 is rate_limit and 529 is overloaded, both saying to try again in a minute", async () => {
    const rl = await errorFrom(apiErr(429, "rate limited", "rate_limit_error"));
    expect(rl.kind).toBe("rate_limit");
    expect(rl.message).toMatch(/in a minute/);
    const ov = await errorFrom(apiErr(529, "Overloaded", "overloaded_error"));
    expect(ov.kind).toBe("overloaded");
    expect(ov.message).toMatch(/in a minute/);
  });

  it("a connection failure or a blocked fetch is network, mentioning ad blockers", async () => {
    const conn = await errorFrom(new Anthropic.APIConnectionError({ message: "Connection error." }));
    expect(conn.kind).toBe("network");
    expect(conn.message).toMatch(/ad blocker/);
    expect((await errorFrom(new TypeError("Failed to fetch"))).kind).toBe("network");
  });

  it("keeps the workspace handling ahead of other 400s", async () => {
    const e = await errorFrom(apiErr(400, "This API key is not scoped to a workspace, so this request must include the anthropic-workspace-id header."));
    expect(e.kind).toBe("workspace");
  });

  it("a web fetch refused by both models becomes fetch_failed (so the dialog switches to paste)", async () => {
    const create = vi.fn(async () => {
      throw apiErr(400, "web_fetch tool is not enabled for this organization");
    });
    const client = { messages: { create } } as unknown as Anthropic;
    await expect(createAnthropicProvider(cfg, client).fetchUrl!("https://x.co/job")).rejects.toMatchObject({ kind: "fetch_failed" });
    expect(create).toHaveBeenCalledTimes(2); // fast model, then the smart one
  });

  it("a web fetch that fails for billing stays billing, not fetch_failed", async () => {
    const create = vi.fn(async () => {
      throw apiErr(400, "Your credit balance is too low to access the Anthropic API.");
    });
    const client = { messages: { create } } as unknown as Anthropic;
    await expect(createAnthropicProvider(cfg, client).fetchUrl!("https://x.co/job")).rejects.toMatchObject({ kind: "billing" });
  });
});
