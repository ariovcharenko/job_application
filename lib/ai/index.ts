import { getSettings } from "../db";
import { createAnthropicProvider } from "./anthropic";
import { AIError, type AIProvider } from "./provider";

export * from "./provider";

/** Build the provider from saved settings. Throws AIError("no_key") when no key is set. */
export async function getProvider(): Promise<AIProvider> {
  const s = await getSettings();
  if (!s.anthropicKey.trim()) {
    throw new AIError("no_key", "Add your Anthropic API key in Settings first.");
  }
  return createAnthropicProvider({
    apiKey: s.anthropicKey.trim(),
    workspaceId: s.workspaceId,
    fastModel: s.fastModel,
    smartModel: s.smartModel,
  });
}
export * from "./errors";
