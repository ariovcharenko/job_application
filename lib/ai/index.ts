import { getSettings } from "../db";
import { buildProvider, type AITask } from "./route";
import type { AIProvider } from "./provider";

export * from "./provider";

/**
 * Claude, built from saved settings. Throws AIError("no_key") when no key is set. `task` labels
 * its spend in the local meter. Tasks that may go to OpenAI (resume writing) use
 * `providerFor(task)` from ./route instead.
 */
export async function getProvider(task: AITask | "other" = "other"): Promise<AIProvider> {
  return buildProvider("anthropic", await getSettings(), task);
}
export * from "./errors";
