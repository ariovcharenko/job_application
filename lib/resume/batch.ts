import { AIError, type AIProvider } from "../ai/provider";
import { db } from "../db";
import type { ResumeStructure } from "../docx/types";
import type { ScoreResult } from "../scoring/score";
import type { BaseResume, FeedItem, Preferences } from "../types";
import { CLASSIFY_JD_CHAR_LIMIT, CLASSIFY_MAX_TOKENS, classifyBaseResume } from "./classify";
import { getResumeStructure } from "./repo";
import { TAILOR_FIXED_PROMPT_CHARS, TAILOR_JD_CHAR_LIMIT, TAILOR_MAX_TOKENS, tailorResume, type TailorResult } from "./tailor";

// Batch tailoring for the feed ("auto-tailor every strong match").
// The batch only *prepares* proposals and stores them as drafts. Nothing is written into a resume
// file until she reviews a draft in the Tailor dialog, so the per-bullet accept and the
// never-auto-applied suggested skills (decision #6) still apply to every draft.

export interface TailorDraft {
  baseResumeId: number;
  result: TailorResult;
  /** Model that produced it, shown in the review dialog. */
  model: string;
  classifyReason?: string;
  createdAt: number;
}

export function parseTailorDraft(raw: string | undefined): TailorDraft | null {
  if (!raw) return null;
  try {
    const d = JSON.parse(raw) as TailorDraft;
    return typeof d.baseResumeId === "number" && d.result ? d : null;
  } catch {
    return null;
  }
}

function verdictOf(item: FeedItem): ScoreResult["verdict"] | null {
  if (!item.fitBreakdown) return null;
  try {
    return (JSON.parse(item.fitBreakdown) as ScoreResult).verdict ?? null;
  } catch {
    return null;
  }
}

/** Feed items worth tailoring for: an "Apply" verdict (or, with no stored breakdown, a score at or
 * above her apply threshold), not dismissed or already started, with a job description, and no
 * draft yet (never pay twice for the same posting). Highest score first. */
export function pickStrongMatches(items: FeedItem[], prefs: Preferences): FeedItem[] {
  return items
    .filter((i) => i.state === "new" || i.state === "saved")
    .filter((i) => !i.tailorDraft && i.jdText.trim().length > 0)
    .filter((i) => {
      const verdict = verdictOf(i);
      if (verdict) return verdict === "Apply";
      return (i.fitScore ?? 0) >= prefs.applyThreshold;
    })
    .sort((a, b) => (b.fitScore ?? 0) - (a.fitScore ?? 0));
}

// ---------------------------------------------------------------------------------------------
// Cost estimate

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
const UNKNOWN_MODEL_PRICE: [number, number] = [10, 50];

function priceFor(model: string): { price: [number, number]; known: boolean } {
  const price = MODEL_PRICES[model];
  return price ? { price, known: true } : { price: UNKNOWN_MODEL_PRICE, known: false };
}

function cost(model: string, inputTokens: number, outputTokens: number): number {
  const [inPrice, outPrice] = priceFor(model).price;
  return (inputTokens * inPrice + outputTokens * outPrice) / 1_000_000;
}

// Characters per token varies by text and tokenizer. 3-4 covers English prose + JSON well, so the
// low end uses 4 and the high end 3.
const charsToTokens = (chars: number, charsPerToken: number) => Math.ceil(chars / charsPerToken);

export interface BatchCostInput {
  /** Job description lengths (characters) of the items to tailor. */
  jdLengths: number[];
  /** Plain-text length of the base resume (the longest one, when she has several). */
  resumeChars: number;
  /** More than one base resume means a cheap classify call per job to pick one. */
  resumeCount: number;
  /** A PDF base resume whose structure isn't cached yet costs one extra call, once. */
  needsPdfParse: boolean;
  smartModel: string;
  fastModel: string;
}

export interface BatchCostEstimate {
  count: number;
  lowUsd: number;
  /** Assumes every call uses its full output limit, so the real cost should land below this. */
  highUsd: number;
  /** False when a model isn't in MODEL_PRICES and a high fallback price was assumed. */
  pricesKnown: boolean;
}

export function estimateBatchCost(input: BatchCostInput): BatchCostEstimate {
  let low = 0;
  let high = 0;
  for (const jdLen of input.jdLengths) {
    const tailorChars = TAILOR_FIXED_PROMPT_CHARS + Math.min(jdLen, TAILOR_JD_CHAR_LIMIT) + input.resumeChars + 300;
    low += cost(input.smartModel, charsToTokens(tailorChars, 4), 800);
    high += cost(input.smartModel, charsToTokens(tailorChars, 3), TAILOR_MAX_TOKENS);

    if (input.resumeCount > 1) {
      const classifyChars = Math.min(jdLen, CLASSIFY_JD_CHAR_LIMIT) + 600;
      low += cost(input.fastModel, charsToTokens(classifyChars, 4), 50);
      high += cost(input.fastModel, charsToTokens(classifyChars, 3), CLASSIFY_MAX_TOKENS);
    }
  }
  if (input.needsPdfParse && input.jdLengths.length > 0) {
    // A 1-2 page PDF is sent as page images + text; a few thousand tokens in, structure JSON out.
    low += cost(input.fastModel, 3000, 1000);
    high += cost(input.fastModel, 8000, 4000);
  }
  return {
    count: input.jdLengths.length,
    lowUsd: low,
    highUsd: high,
    pricesKnown: priceFor(input.smartModel).known && priceFor(input.fastModel).known,
  };
}

export function formatUsd(usd: number): string {
  if (usd > 0 && usd < 0.01) return "<$0.01";
  return `$${usd.toFixed(2)}`;
}

// ---------------------------------------------------------------------------------------------
// Running the batch

export interface BatchProgress {
  done: number;
  total: number;
  current?: string; // "Company — Title"
}

export interface BatchOutcome {
  drafted: number;
  failed: { label: string; message: string }[];
  /** Set when the run stopped early (cancelled, or an error every later call would hit too). */
  stoppedReason: string | null;
}

/** Errors that would fail every remaining call the same way (bad key, no credit, rate limit, wrong
 * model, network down), so the batch stops at the first one instead of repeating it N times.
 * Only problems specific to one posting (unusable output, refusal) move on to the next item. */
function stopsBatch(e: unknown): boolean {
  if (!(e instanceof AIError)) return false;
  return !["invalid_output", "truncated", "refusal"].includes(e.kind);
}

const labelOf = (item: FeedItem) => `${item.company} — ${item.title}`;

/** Tailors each item one at a time (sequential on purpose: easy on rate limits, and cancelling
 * stops spending right away) and saves each proposal as a draft on its feed row. */
export async function runBatchTailor(
  items: FeedItem[],
  resumes: BaseResume[],
  provider: AIProvider,
  opts: { smartModel: string; onProgress?: (p: BatchProgress) => void; isCancelled?: () => boolean },
): Promise<BatchOutcome> {
  if (resumes.length === 0) throw new Error("Import a base resume in Settings first.");
  const outcome: BatchOutcome = { drafted: 0, failed: [], stoppedReason: null };
  // Parsed once per resume for the whole batch. A PDF's structure costs an AI call the first
  // time, and the in-memory BaseResume objects don't see the cached copy written to the DB.
  const structures = new Map<number, ResumeStructure>();

  for (let i = 0; i < items.length; i++) {
    const item = items[i];
    if (opts.isCancelled?.()) {
      outcome.stoppedReason = "Cancelled.";
      break;
    }
    opts.onProgress?.({ done: i, total: items.length, current: labelOf(item) });
    try {
      const choice = await classifyBaseResume(
        provider,
        item.jdText,
        resumes.map((r) => ({ id: r.id!, label: r.label })),
      );
      const resume = resumes.find((r) => r.id === choice.baseResumeId) ?? resumes[0];
      let structure = structures.get(resume.id!);
      if (!structure) {
        structure = await getResumeStructure(provider, resume);
        structures.set(resume.id!, structure);
      }
      const result = await tailorResume(provider, item.jdText, structure);
      const draft: TailorDraft = {
        baseResumeId: resume.id!,
        result,
        model: opts.smartModel,
        classifyReason: resumes.length > 1 ? choice.reason : undefined,
        createdAt: Date.now(),
      };
      if (item.id !== undefined) await db.feed.update(item.id, { tailorDraft: JSON.stringify(draft) });
      outcome.drafted++;
    } catch (e) {
      const message = e instanceof Error ? e.message : String(e);
      if (stopsBatch(e)) {
        outcome.stoppedReason = message;
        break;
      }
      outcome.failed.push({ label: labelOf(item), message });
    }
  }
  opts.onProgress?.({ done: outcome.drafted + outcome.failed.length, total: items.length });
  return outcome;
}
