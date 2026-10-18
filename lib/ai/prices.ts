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

/** What Anthropic charges for cached prompt tokens, as a share of the input price. */
const ANTHROPIC_CACHE_READ = 0.1;
const ANTHROPIC_CACHE_WRITE = 1.25;

export interface PricedUsage {
  usd: number;
  /** False when the model isn't in MODEL_PRICES and the high fallback was used. */
  known: boolean;
}

/**
 * Dollars for one response's tokens. Anthropic cache reads cost 10% of input and writes 125%.
 * OpenAI's cached-token discount varies by model and wasn't verified, so its cached tokens are
 * priced as full input (errs high).
 */
export function costOf(u: {
  provider: string;
  model: string;
  inputTokens: number;
  outputTokens: number;
  cacheReadTokens: number;
  cacheWriteTokens: number;
}): PricedUsage {
  const { price, known } = priceFor(u.model);
  const [inP, outP] = price;
  const anthropic = u.provider === "anthropic";
  const input = u.inputTokens + u.cacheReadTokens * (anthropic ? ANTHROPIC_CACHE_READ : 1) + u.cacheWriteTokens * (anthropic ? ANTHROPIC_CACHE_WRITE : 1);
  return { usd: (input * inP + u.outputTokens * outP) / 1_000_000, known };
}

export function priceFor(model: string): { price: [number, number]; known: boolean } {
  const price = MODEL_PRICES[model];
  return price ? { price, known: true } : { price: UNKNOWN_MODEL_PRICE, known: false };
}
