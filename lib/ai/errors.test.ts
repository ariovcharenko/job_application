import { describe, expect, it } from "vitest";
import { API_KEY_SETTINGS_HREF, CONSOLE_LINKS, describeAIError, OPENAI_KEY_SETTINGS_HREF, OPENAI_LINKS } from "./errors";
import { AIError } from "./provider";

describe("describeAIError", () => {
  it("points each fixable kind at the one place that fixes it", () => {
    expect(describeAIError(new AIError("billing", "out of credit")).fix).toEqual({ label: "Add credit", href: CONSOLE_LINKS.billing, external: true });
    expect(describeAIError(new AIError("auth", "bad key")).fix?.href).toBe(CONSOLE_LINKS.keys);
    expect(describeAIError(new AIError("permission", "no")).fix?.href).toBe(CONSOLE_LINKS.keys);
    expect(describeAIError(new AIError("no_key", "add a key")).fix).toEqual({ label: "Add your API key", href: API_KEY_SETTINGS_HREF, external: false });
    expect(describeAIError(new AIError("overloaded", "busy")).fix?.href).toBe(CONSOLE_LINKS.status);
  });

  it("says which errors are worth retrying as they are", () => {
    expect(describeAIError(new AIError("overloaded", "busy")).retryable).toBe(true);
    expect(describeAIError(new AIError("rate_limit", "slow down")).retryable).toBe(true);
    expect(describeAIError(new AIError("network", "offline")).retryable).toBe(true);
    expect(describeAIError(new AIError("billing", "out of credit")).retryable).toBe(false);
    expect(describeAIError(new AIError("fetch_failed", "paste it")).retryable).toBe(false);
  });

  it("keeps the message and has no fix for plain errors", () => {
    expect(describeAIError(new Error("boom"))).toEqual({ kind: "unknown", provider: "anthropic", message: "boom", retryable: true });
    expect(describeAIError("text")).toMatchObject({ kind: "unknown", message: "text" });
  });

  it("sends OpenAI errors to OpenAI's pages, not Anthropic's", () => {
    const billing = describeAIError(new AIError("billing", "out", "openai"));
    expect(billing.provider).toBe("openai");
    expect(billing.fix?.href).toBe(OPENAI_LINKS.billing);
    expect(describeAIError(new AIError("auth", "bad", "openai")).fix?.href).toBe(OPENAI_LINKS.keys);
    expect(describeAIError(new AIError("no_key", "add", "openai")).fix?.href).toBe(OPENAI_KEY_SETTINGS_HREF);
    expect(describeAIError(new AIError("workspace", "x", "openai")).fix).toBeUndefined();
  });
});
