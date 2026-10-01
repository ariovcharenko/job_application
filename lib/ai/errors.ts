import { AIError, type AIErrorKind } from "./provider";

// Turns any error from an AI call into what the screen shows: the message, plus the one place
// that fixes it. Pure (no React), so any component can use it; components/resumes/AIErrorNotice
// renders it.

export const CONSOLE_LINKS = {
  billing: "https://console.anthropic.com/settings/billing",
  keys: "https://console.anthropic.com/settings/keys",
  limits: "https://console.anthropic.com/settings/limits",
  status: "https://status.anthropic.com",
} as const;

/** The in-app Settings card for the key (Card anchors are slugify(title): "Anthropic API key"). */
export const API_KEY_SETTINGS_HREF = "/settings#anthropic-api-key";

export interface AIErrorFix {
  label: string;
  href: string;
  /** Opens outside the app (the Anthropic Console or status page), in a new tab. */
  external: boolean;
}

export interface AIErrorDisplay {
  kind: AIErrorKind;
  message: string;
  fix?: AIErrorFix;
  /** Worth simply trying again later (nothing to change first). */
  retryable: boolean;
}

const FIXES: Partial<Record<AIErrorKind, AIErrorFix>> = {
  no_key: { label: "Add your API key", href: API_KEY_SETTINGS_HREF, external: false },
  billing: { label: "Add credit", href: CONSOLE_LINKS.billing, external: true },
  auth: { label: "Check your API keys", href: CONSOLE_LINKS.keys, external: true },
  permission: { label: "Check your API keys", href: CONSOLE_LINKS.keys, external: true },
  workspace: { label: "Open API key settings", href: API_KEY_SETTINGS_HREF, external: false },
  rate_limit: { label: "See your rate limits", href: CONSOLE_LINKS.limits, external: true },
  overloaded: { label: "Anthropic status", href: CONSOLE_LINKS.status, external: true },
};

const RETRYABLE: AIErrorKind[] = ["rate_limit", "overloaded", "network", "truncated", "invalid_output", "unknown"];

export function describeAIError(err: unknown): AIErrorDisplay {
  if (err instanceof AIError) {
    return { kind: err.kind, message: err.message, fix: FIXES[err.kind], retryable: RETRYABLE.includes(err.kind) };
  }
  const message = err instanceof Error ? err.message : String(err);
  return { kind: "unknown", message, retryable: true };
}
