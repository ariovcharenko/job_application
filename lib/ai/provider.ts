// Provider-neutral AI interface. Anthropic is the first implementation; OpenAI/Gemini can be
// added later without touching callers.

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
  | "unknown";

export class AIError extends Error {
  constructor(
    public kind: AIErrorKind,
    message: string,
  ) {
    super(message);
    this.name = "AIError";
  }
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

export interface AIProvider {
  id: string;
  complete(opts: CompleteOptions): Promise<string>;
  completeJson<T = unknown>(opts: JsonOptions<T>): Promise<T>;
  /** Models this key can use, for the Settings dropdowns. */
  listModels(): Promise<ModelInfo[]>;
  testConnection(): Promise<{ ok: boolean; message: string }>;
  /** Reads a public web page's text. Optional: only providers with a server-side fetch tool. */
  fetchUrl?(url: string): Promise<FetchedPage>;
}
