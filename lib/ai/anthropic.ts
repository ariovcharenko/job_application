import Anthropic from "@anthropic-ai/sdk";
import { AIError, type AIProvider, type CompleteOptions, type FetchedPage, type JsonOptions, type ModelInfo } from "./provider";

export interface AnthropicConfig {
  apiKey: string;
  fastModel: string;
  smartModel: string;
  /** Only for keys that are not tied to a workspace; sent as the `anthropic-workspace-id` header. */
  workspaceId?: string;
}

// The key lives in the user's browser and goes only to Anthropic, so browser use is intended here.
// `dangerouslyAllowBrowser` also makes the SDK send `anthropic-dangerous-direct-browser-access`.
export function createAnthropicProvider(
  cfg: AnthropicConfig,
  client: Anthropic = new Anthropic({
    apiKey: cfg.apiKey,
    dangerouslyAllowBrowser: true,
    defaultHeaders: cfg.workspaceId?.trim() ? { "anthropic-workspace-id": cfg.workspaceId.trim() } : undefined,
  }),
): AIProvider {
  async function run(opts: CompleteOptions, format?: { type: "json_schema"; schema: Record<string, unknown> }) {
    const model = opts.tier === "fast" ? cfg.fastModel : cfg.smartModel;
    const effort = opts.tier === "fast" ? undefined : opts.effort;
    let res: Anthropic.Message;
    try {
      const content: Anthropic.Messages.ContentBlockParam[] = [
        ...(opts.attachments ?? []).map(
          (a): Anthropic.Messages.DocumentBlockParam => ({
            type: "document",
            source: { type: "base64", media_type: a.mediaType, data: a.base64 },
          }),
        ),
        { type: "text", text: opts.prompt },
      ];
      res = await client.messages.create({
        model,
        max_tokens: opts.maxTokens ?? 16000,
        system: opts.system
          ? opts.cacheSystem
            ? [{ type: "text", text: opts.system, cache_control: { type: "ephemeral" } }]
            : opts.system
          : undefined,
        messages: [{ role: "user", content }],
        ...(format || effort ? { output_config: { ...(format ? { format } : {}), ...(effort ? { effort } : {}) } } : {}),
      });
    } catch (err) {
      throw toAIError(err);
    }

    if (res.stop_reason === "refusal") {
      throw new AIError("refusal", "The model declined this request.");
    }
    if (res.stop_reason === "max_tokens") {
      throw new AIError("truncated", "The response was cut off. Try again with a shorter input.");
    }
    return res.content.map((b) => (b.type === "text" ? b.text : "")).join("");
  }

  async function fetchWith(model: string, url: string): Promise<FetchedPage> {
    let res: Anthropic.Message;
    try {
      res = await client.messages.create({
        model,
        max_tokens: 1024,
        tools: [{ type: "web_fetch_20250910", name: "web_fetch", max_uses: 1, max_content_tokens: MAX_PAGE_TOKENS }],
        messages: [
          {
            role: "user",
            content: `Fetch this job posting with the web_fetch tool: ${url}\nAfter fetching it, reply with the single word DONE.`,
          },
        ],
      });
    } catch (err) {
      throw toAIError(err);
    }
    return readFetchResult(res, url);
  }

  return {
    id: "anthropic",

    complete: (opts) => run(opts),

    async completeJson<T>(opts: JsonOptions<T>): Promise<T> {
      const text = await run(opts, { type: "json_schema", schema: opts.schema });
      let raw: unknown;
      try {
        raw = JSON.parse(text);
      } catch {
        throw new AIError("invalid_output", "The model returned text that is not valid JSON.");
      }
      if (!opts.parse) return raw as T;
      try {
        return opts.parse(raw);
      } catch (err) {
        throw new AIError("invalid_output", `The model's JSON did not match the expected shape: ${String(err)}`);
      }
    },

    async listModels(): Promise<ModelInfo[]> {
      const models: ModelInfo[] = [];
      try {
        for await (const m of client.models.list({ limit: 100 })) {
          if (m.id.startsWith("claude-")) models.push({ id: m.id, label: m.display_name || m.id });
        }
      } catch (err) {
        throw toAIError(err);
      }
      return models;
    },

    async fetchUrl(url: string): Promise<FetchedPage> {
      // The fast model is enough to call the tool; the page text comes back in the tool result
      // block, so the model never has to repeat it (which would cost output tokens). If the fast
      // model can't use web fetch, fall back to the smart one once.
      try {
        try {
          return await fetchWith(cfg.fastModel, url);
        } catch (err) {
          if (err instanceof AIError && err.kind === "bad_request" && cfg.smartModel !== cfg.fastModel) {
            return await fetchWith(cfg.smartModel, url);
          }
          throw err;
        }
      } catch (err) {
        // Still refused by both models: web fetch is turned off for this key or organization (or
        // the request was malformed). Either way the fix is the same, so the dialog switches to paste.
        if (err instanceof AIError && err.kind === "bad_request") {
          throw new AIError(
            "fetch_failed",
            `Links can't be read with this API key (Anthropic refused its web fetch tool). Paste the job description instead. ${err.message}`,
          );
        }
        throw err;
      }
    },

    async testConnection() {
      try {
        await run({ prompt: "Reply with the single word OK.", tier: "fast", maxTokens: 16 });
        return { ok: true, message: "Connected. The key works." };
      } catch (err) {
        const e = err instanceof AIError ? err : toAIError(err);
        return { ok: false, message: e.message };
      }
    },
  };
}

/** Caps what one job page can cost: ~12k tokens is far more than any real posting's text. */
const MAX_PAGE_TOKENS = 12000;
/** Less text than this means the page is built by JavaScript and web fetch only saw a shell. */
const MIN_POSTING_CHARS = 400;

const FETCH_ERRORS: Record<string, string> = {
  url_not_accessible: "That page couldn't be opened (it may need a login, or the site blocks automated reading).",
  url_not_allowed: "That site can't be read automatically (it blocks it, or the address looks private).",
  unsupported_content_type: "That link isn't a web page or PDF.",
  url_too_long: "That link is too long. Try the posting's shorter address.",
  invalid_tool_input: "That doesn't look like a valid web address.",
  too_many_requests: "Too many page reads right now. Wait a minute and try again.",
  content_too_large: "That page is too large to read.",
};

/** Pulls the fetched page's text out of the response. Exported for tests. */
export function readFetchResult(res: Anthropic.Message, url: string): FetchedPage {
  const paste = " Paste the job description instead.";
  const block = res.content.find((b): b is Anthropic.Messages.WebFetchToolResultBlock => b.type === "web_fetch_tool_result");
  if (!block) throw new AIError("fetch_failed", `Couldn't read that page.${paste}`);
  if (block.content.type === "web_fetch_tool_result_error") {
    const msg = FETCH_ERRORS[block.content.error_code] ?? "Couldn't read that page.";
    throw new AIError("fetch_failed", `${msg}${paste}`);
  }
  const doc = block.content.content;
  if (doc.source.type !== "text") {
    throw new AIError("fetch_failed", `That link is a PDF, which can't be read as a posting yet.${paste}`);
  }
  const text = doc.source.data.trim();
  if (text.length < MIN_POSTING_CHARS) {
    throw new AIError(
      "fetch_failed",
      `That page loads its content with JavaScript (common on Workday, Ashby and LinkedIn), so only an empty shell could be read.${paste}`,
    );
  }
  return { url: block.content.url || url, title: doc.title ?? "", text };
}

/** The human-readable message inside an Anthropic error body, falling back to the SDK's message. */
function apiMessage(err: InstanceType<typeof Anthropic.APIError>): string {
  const body = err.error as { error?: { message?: unknown } } | undefined;
  const inner = body?.error?.message;
  return typeof inner === "string" && inner ? inner : err.message;
}

const NETWORK_MESSAGE =
  "Couldn't reach Anthropic. Check your connection, or an ad blocker or privacy extension that may block api.anthropic.com.";

export function toAIError(err: unknown): AIError {
  if (err instanceof AIError) return err;
  if (err instanceof Anthropic.AuthenticationError) {
    return new AIError(
      "auth",
      "Anthropic rejected this API key. It may be mistyped or revoked. Copy it again from console.anthropic.com/settings/keys.",
    );
  }
  if (err instanceof Anthropic.PermissionDeniedError) {
    return new AIError(
      "permission",
      `This API key isn't allowed to do that: ${apiMessage(err).replace(/\.?\s*$/, ".")} Check the key's workspace in the Anthropic Console, or choose another model in Settings.`,
    );
  }
  if (err instanceof Anthropic.RateLimitError) {
    return new AIError("rate_limit", "Anthropic is limiting how fast this key can make requests. Try again in a minute.");
  }
  if (err instanceof Anthropic.NotFoundError) {
    return new AIError("bad_request", "Model not found. Pick a different model in Settings.");
  }
  if (err instanceof Anthropic.APIError && (err.status === 402 || /credit balance/i.test(apiMessage(err)))) {
    return new AIError(
      "billing",
      "Your Anthropic account is out of credit. Add credit at console.anthropic.com/settings/billing, then try again.",
    );
  }
  if (err instanceof Anthropic.BadRequestError) {
    const msg = apiMessage(err);
    if (/not scoped to a workspace|must include the anthropic-workspace-id/i.test(msg)) {
      return new AIError(
        "workspace",
        "This key is not tied to a workspace. Enter your Workspace ID below (it starts with wrkspc_), or create a new API key inside a workspace in the Anthropic Console.",
      );
    }
    if (/valid workspace/i.test(msg)) {
      return new AIError(
        "workspace",
        "That Workspace ID was not accepted. Copy it again from the Anthropic Console (it starts with wrkspc_), or clear the field if your key already belongs to a workspace.",
      );
    }
    return new AIError("bad_request", `Anthropic rejected the request: ${msg}`);
  }
  if (err instanceof Anthropic.APIUserAbortError) {
    return new AIError("unknown", "The request was cancelled.");
  }
  if (err instanceof Anthropic.APIConnectionError) {
    return new AIError("network", NETWORK_MESSAGE);
  }
  if (err instanceof Anthropic.APIError && (err.status === 529 || err.status === 503 || err.type === "overloaded_error")) {
    return new AIError("overloaded", "Anthropic is overloaded right now. Nothing is wrong on your side. Try again in a minute.");
  }
  if (err instanceof Anthropic.APIError) {
    return new AIError("unknown", `Anthropic error ${err.status ?? ""}: ${apiMessage(err)}`);
  }
  // fetch() failing outside the SDK: offline, CORS, or blocked by a browser extension.
  if (err instanceof TypeError && /fetch|network|load failed/i.test(err.message)) {
    return new AIError("network", NETWORK_MESSAGE);
  }
  return new AIError("unknown", err instanceof Error ? err.message : String(err));
}
