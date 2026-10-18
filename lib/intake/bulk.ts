import { priceFor } from "../ai/prices";
import { AIError } from "../ai/provider";
import type { Application } from "../types";
import { looksLikeUrl } from "./analyze";
import { findMatch, normalizeJobUrl } from "./dedupe";
import type { SavedJob } from "./save";

// Checking several job links in one go, with the same safeguard as batch tailoring (decision #9):
// she sees how many, roughly what it costs and which she already checked before anything is
// spent; the run is one link at a time, cancellable, and stops at the first error every later
// link would hit too.

/** The links in pasted text: one per line (or separated by spaces), each once, in order. */
export function parseLinks(text: string): string[] {
  const seen = new Set<string>();
  const out: string[] = [];
  for (const raw of text.split(/\s+/)) {
    const link = raw.trim().replace(/[),.;]+$/, "");
    // A full link, or one pasted without https:// (host with a dot, then a path).
    if (!link || !(looksLikeUrl(link) || /^[a-z0-9-]+(\.[a-z0-9-]+)+\/\S*$/i.test(link))) continue;
    const key = normalizeJobUrl(link);
    if (!key || seen.has(key)) continue;
    seen.add(key);
    out.push(/^https?:\/\//i.test(link) ? link : `https://${link}`);
  }
  return out;
}

export interface BulkPlan {
  /** Links never checked before. */
  fresh: string[];
  /** Links she already checked, with the row they match. Skipped unless she asks to check them again. */
  already: { url: string; app: Application & { id: number } }[];
}

export function planBulk(links: string[], apps: (Application & { id: number })[]): BulkPlan {
  const plan: BulkPlan = { fresh: [], already: [] };
  for (const url of links) {
    const app = findMatch(apps, { url });
    if (app) plan.already.push({ url, app });
    else plan.fresh.push(url);
  }
  return plan;
}

/**
 * Tokens one link costs on the fast model: reading the page (web fetch, the page counts as input)
 * plus extracting its signals. Low: a short posting. High: a long page near the 12k-token read cap
 * and a long extraction answer.
 */
const PER_LINK = {
  low: { input: 6000, output: 500 },
  high: { input: 26000, output: 2200 },
};

export interface BulkEstimate {
  lowUsd: number;
  highUsd: number;
  /** False when the fast model's price isn't known (the high fallback was used). */
  known: boolean;
}

export function estimateBulkCost(count: number, fastModel: string): BulkEstimate {
  const { price, known } = priceFor(fastModel);
  const usd = (t: { input: number; output: number }) => (t.input * price[0] + t.output * price[1]) / 1_000_000;
  return { lowUsd: count * usd(PER_LINK.low), highUsd: count * usd(PER_LINK.high), known };
}

/** "about 2 to 9¢" or "about $0.10 to $0.40". */
export function formatEstimate(e: BulkEstimate): string {
  const fmt = (usd: number) => (usd < 1 ? `${Math.max(1, Math.round(usd * 100))}¢` : `$${usd.toFixed(2)}`);
  const lo = fmt(e.lowUsd);
  const hi = fmt(e.highUsd);
  if (e.highUsd < 1) return lo === hi ? `about ${hi}` : `about ${lo.replace("¢", "")} to ${hi}`;
  return `about ${lo} to ${hi}`;
}

/**
 * Problems that belong to one link only: its page can't be read (needs pasting), or the model's
 * answer for it was unusable. Anything else (key, credit, rate limit, overload, network) would
 * happen to every later link too, so the run stops.
 */
export function isPerLinkProblem(e: unknown): boolean {
  if (!(e instanceof AIError)) return true;
  return ["fetch_failed", "invalid_output", "truncated", "refusal", "bad_request"].includes(e.kind);
}

export interface BulkProgress {
  index: number;
  total: number;
  url: string;
}

export interface BulkOutcome {
  checked: SavedJob[];
  /** Pages that can't be read from a link (JavaScript sites): she can paste each one. */
  needsPaste: { url: string; message: string }[];
  /** Other per-link problems. */
  failed: { url: string; message: string }[];
  /** The error that stopped the run, if one did. */
  stoppedBy?: unknown;
  cancelled: boolean;
  /** Links never tried (after a stop or cancel). */
  notTried: string[];
}

export async function runBulkCheck(
  links: string[],
  check: (url: string) => Promise<SavedJob>,
  opts: { onProgress?: (p: BulkProgress) => void; isCancelled?: () => boolean } = {},
): Promise<BulkOutcome> {
  const out: BulkOutcome = { checked: [], needsPaste: [], failed: [], cancelled: false, notTried: [] };
  for (let i = 0; i < links.length; i++) {
    const url = links[i];
    if (opts.isCancelled?.()) {
      out.cancelled = true;
      out.notTried = links.slice(i);
      break;
    }
    opts.onProgress?.({ index: i, total: links.length, url });
    try {
      out.checked.push(await check(url));
    } catch (e) {
      const message = e instanceof Error ? e.message : String(e);
      if (e instanceof AIError && e.kind === "fetch_failed") out.needsPaste.push({ url, message });
      else if (isPerLinkProblem(e)) out.failed.push({ url, message });
      else {
        out.stoppedBy = e;
        out.notTried = links.slice(i);
        break;
      }
    }
  }
  return out;
}
