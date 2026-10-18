// Provider-neutral AI interface. Anthropic (lib/ai/anthropic.ts) and OpenAI (lib/ai/openai.ts)
// implement it; lib/ai/route.ts picks which one a task uses.

/** Which company's API answered (or failed). */
export type ProviderId = "anthropic" | "openai";

export type ModelTier = "fast" | "smart";
export type JsonSchema = Record<string, unknown>;

export interface Attachment {
  /** Currently only PDF resumes use this. */
  mediaType: "application/pdf";
  /** Base64-encoded file bytes. */
  base64: string;
}

export interface CompleteOptions {
  prompt: string;
  system?: string;
  /** "fast" = cheap extraction/classification, "smart" = tailoring and writing. Default "smart". */
  tier?: ModelTier;
  maxTokens?: number;
  /** Mark the system prompt cacheable (use for large, repeated context such as a base resume). */
  cacheSystem?: boolean;
  /** Files to send alongside the prompt (e.g. a PDF resume for structure extraction). */
  attachments?: Attachment[];
  /**
   * How hard the smart model thinks. The default (high) made a resume take ~3 minutes; medium is
   * the speed/quality balance for writing tasks. Ignored for the fast tier (Haiku rejects it).
   */
  effort?: "low" | "medium" | "high";
  /**
   * Streams the answer and reports how many characters of it have arrived (0 while the model is
   * still thinking), so a long call can show progress instead of a frozen spinner.
   */
  onProgress?: (charsWritten: number) => void;
  /** Stops the request (her "Cancel"); the call then rejects with AIError("cancelled"). */
  signal?: AbortSignal;
}

export interface JsonOptions<T> extends CompleteOptions {
  /** JSON Schema the response must satisfy (additionalProperties: false, all keys required). */
  schema: JsonSchema;
  /** Validate/convert the parsed JSON, e.g. with a zod schema's `.parse`. */
  parse?: (raw: unknown) => T;
}

export type AIErrorKind =
  | "no_key"
  /** The key was rejected (401): wrong, revoked or mistyped. */
  | "auth"
  /** The key works but may not do this (403), e.g. a workspace without access to the model. */
  | "permission"
  /** The Anthropic account has no credit left. */
  | "billing"
  | "workspace"
  | "rate_limit"
  /** Anthropic is busy (529/503); nothing is wrong on her side. */
  | "overloaded"
  | "bad_request"
  | "refusal"
  | "truncated"
  | "invalid_output"
  | "network"
  | "fetch_failed"
  /** She stopped it (AbortSignal). Nothing to show as an error. */
  | "cancelled"
  | "unknown";

export class AIError extends Error {
  constructor(
    public kind: AIErrorKind,
    message: string,
    /** Whose API this came from, so the fix links to the right console. Absent = Anthropic. */
    public provider?: ProviderId,
    /** A page read that failed in a way one more try may fix (busy, dropped connection). */
    public transient?: boolean,
  ) {
    super(message);
    this.name = "AIError";
  }
}

/** Whether a failed page read is worth one more try: busy provider, rate limit, dropped connection, page not opened this time. */
export function isTransientFetchError(err: unknown): boolean {
  if (!(err instanceof AIError)) return false;
  return err.kind === "rate_limit" || err.kind === "overloaded" || err.kind === "network" || err.transient === true;
}

export interface ModelInfo {
  id: string;
  label: string;
}

/** A web page read on the provider's side (the browser itself can't fetch other sites' pages). */
export interface FetchedPage {
  url: string;
  title: string;
  text: string;
}

/**
 * Tokens one API response used, as the provider reported them. Input excludes cached tokens:
 * cache reads and writes are counted separately (they are priced differently).
 */
export interface UsageReport {
  provider: ProviderId;
  model: string;
  inputTokens: number;
  outputTokens: number;
  cacheReadTokens: number;
  cacheWriteTokens: number;
}

/** What a provider can do beyond plain text and JSON. Absent = everything false. */
export interface ProviderCapabilities {
  /** PDF attachments (resume import). Anthropic only. */
  attachments: boolean;
  /** Reading a web page on the provider's side (job links). Anthropic only. */
  webFetch: boolean;
}

export interface AIProvider {
  id: string;
  capabilities?: ProviderCapabilities;
  complete(opts: CompleteOptions): Promise<string>;
  completeJson<T = unknown>(opts: JsonOptions<T>): Promise<T>;
  /** Models this key can use, for the Settings dropdowns. */
  listModels(): Promise<ModelInfo[]>;
  testConnection(): Promise<{ ok: boolean; message: string }>;
  /** Reads a public web page's text. Optional: only providers with a server-side fetch tool. */
  fetchUrl?(url: string): Promise<FetchedPage>;
}
