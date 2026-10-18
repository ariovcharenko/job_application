// Cost estimates for AI calls (the Feed's batch tailoring and the eval runner).
//
// Only Anthropic rates are listed. OpenAI models are left out on purpose: their prices weren't
// verified when OpenAI resume writing was added, so any OpenAI model gets the deliberately high
// fallback and `known: false`, which the screens show as a warning. Add a row only from OpenAI's
// own pricing page.

/** US$ per million tokens [input, output], Anthropic first-party rates. */
export const MODEL_PRICES: Record<string, [number, number]> = {
  "claude-haiku-4-5": [1, 5],
  "claude-sonnet-5": [2, 10],
  "claude-sonnet-4-6": [3, 15],
  "claude-opus-5": [5, 25],
  "claude-opus-4-8": [5, 25],
  "claude-fable-5-1": [10, 50],
};

/** Used for a model not in the table above, deliberately on the high side so the estimate errs
 * toward "more expensive than it really is". */
export const UNKNOWN_MODEL_PRICE: [number, number] = [10, 50];

export function priceFor(model: string): { price: [number, number]; known: boolean } {
  const price = MODEL_PRICES[model];
  return price ? { price, known: true } : { price: UNKNOWN_MODEL_PRICE, known: false };
}
