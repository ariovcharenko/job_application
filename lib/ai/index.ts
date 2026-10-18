import { getSettings } from "../db";
import { buildProvider } from "./route";
import type { AIProvider } from "./provider";

export * from "./provider";

/**
 * Claude, built from saved settings. Throws AIError("no_key") when no key is set. Tasks that may
 * go to OpenAI (resume writing) use `providerFor(task)` from ./route instead.
 */
export async function getProvider(): Promise<AIProvider> {
  return buildProvider("anthropic", await getSettings());
}
export * from "./errors";
