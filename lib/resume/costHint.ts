import type { ProviderId } from "@/lib/ai/provider";

/** Shown on every "Tailor resume" button. Its own module so a button can show it without loading
 * the tailoring screen's code. */
export const TAILOR_COST_HINT = "about 5 to 10¢";

/** The cost note on the Tailor buttons: Claude's measured cost, or OpenAI's (not measured yet). */
export function tailorCostHint(writer: ProviderId): string {
  return writer === "openai" ? "with OpenAI" : TAILOR_COST_HINT;
}
