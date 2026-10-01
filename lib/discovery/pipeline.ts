import type { AIProvider } from "../ai/provider";
import { db } from "../db";
import { scoreJob } from "../scoring/score";
import { extractJobSignals } from "../scoring/signals";
import { normalizeRoleType } from "../tracker/csvMap";
import { todayISO } from "../tracker/stage";
import type { Preferences } from "../types";
import { searchJobs, type RawPosting } from "./jsearch";

export interface DiscoveryProgress {
  company: string;
  status: "searching" | "scoring" | "done" | "error";
  detail?: string;
}

export interface DiscoveryOutcome {
  /** Postings returned by JSearch across all companies searched, before dedupe or filtering. */
  found: number;
  added: number;
  skippedExisting: number;
  skippedIrrelevant: number;
  /** Postings from a different employer than the one searched (JSearch treats "at Google" loosely). */
  skippedOtherCompany: number;
  /** From JSearch's rate-limit header on the last successful call, or null if it wasn't sent. */
  requestsRemaining: number | null;
  errors: { company: string; message: string }[];
}

/** Cheap, free pre-filter before any AI call: keep only titles that look like one of her target roles. */
export function passesPrefilter(title: string, prefs: Preferences): boolean {
  if (prefs.targetRoles.length === 0) return true;
  return prefs.targetRoles.map(normalizeRoleType).includes(normalizeRoleType(title));
}

const LEGAL_SUFFIX = /\b(inc|llc|ltd|corp|corporation|co|company|plc|gmbh)\b\.?/g;

function normalizeCompany(name: string): string {
  return ` ${name
    .toLowerCase()
    .replace(/&/g, " and ")
    .replace(/[^a-z0-9]+/g, " ")
    .replace(LEGAL_SUFFIX, " ")
    .replace(/\s+/g, " ")
    .trim()} `;
}

/**
 * Whether a posting's employer is the watchlist company that was searched. JSearch's query is
 * keyword-based, so "software engineer at Google" also returns other employers; each of those
 * would cost an AI scoring call and show up in the feed under the wrong company. Whole-word match
 * either way round, so "Google LLC" and "Meta Platforms" count but "Blockchain Labs" isn't "Block".
 * An empty employer is kept, since there's nothing to contradict the search.
 */
export function matchesCompany(employer: string, searched: string): boolean {
  const e = normalizeCompany(employer);
  const s = normalizeCompany(searched);
  if (!e.trim() || !s.trim()) return true;
  return e.includes(s) || s.includes(e);
}

async function loadKnownKeys(): Promise<Set<string>> {
  const [feedItems, apps] = await Promise.all([db.feed.toArray(), db.applications.toArray()]);
  const keys = new Set<string>();
  for (const f of feedItems) keys.add(`${f.source}|${f.externalId}`);
  for (const a of apps) if (a.url.trim()) keys.add(`url|${a.url.trim()}`);
  return keys;
}

function buildQuery(company: string, prefs: Preferences): string {
  const roles = prefs.targetRoles.length ? prefs.targetRoles.join(" ") : "software engineer";
  return `${roles} at ${company}`;
}

async function scoreAndSave(posting: RawPosting, company: string, prefs: Preferences, provider: AIProvider, today: string): Promise<void> {
  const jdText = posting.description || `${posting.title} at ${posting.company || company}`;
  const signals = await extractJobSignals(provider, jdText, today);
  const result = scoreJob(signals, prefs);
  await db.feed.add({
    source: posting.source,
    externalId: posting.externalId,
    url: posting.url,
    company: posting.company || company,
    title: posting.title,
    location: posting.location,
    workMode: signals.workMode,
    visa: signals.visaSignal,
    jdText,
    firstSeen: Date.now(),
    fitScore: result.score,
    fitBreakdown: JSON.stringify(result),
    state: "new",
  });
}

/**
 * Searches JSearch for each company on the watchlist, skips postings already in the feed or
 * tracker, drops obviously irrelevant titles for free, then scores the rest with the AI provider
 * and saves them to the `feed` table. Runs only when called — nothing here is scheduled.
 */
export async function runDiscovery(
  companies: string[],
  prefs: Preferences,
  jsearchApiKey: string,
  provider: AIProvider,
  onProgress?: (p: DiscoveryProgress) => void,
): Promise<DiscoveryOutcome> {
  const known = await loadKnownKeys();
  const today = todayISO();
  const outcome: DiscoveryOutcome = {
    found: 0,
    added: 0,
    skippedExisting: 0,
    skippedIrrelevant: 0,
    skippedOtherCompany: 0,
    requestsRemaining: null,
    errors: [],
  };

  for (const company of companies) {
    onProgress?.({ company, status: "searching" });
    let postings: RawPosting[];
    try {
      const result = await searchJobs(jsearchApiKey, buildQuery(company, prefs));
      postings = result.postings;
      if (result.requestsRemaining !== null) outcome.requestsRemaining = result.requestsRemaining;
    } catch (e) {
      const message = e instanceof Error ? e.message : String(e);
      outcome.errors.push({ company, message });
      onProgress?.({ company, status: "error", detail: message });
      continue;
    }
    outcome.found += postings.length;

    for (const posting of postings) {
      const key = `${posting.source}|${posting.externalId}`;
      const urlKey = posting.url ? `url|${posting.url}` : null;
      if (known.has(key) || (urlKey && known.has(urlKey))) {
        outcome.skippedExisting++;
        continue;
      }
      known.add(key);
      if (urlKey) known.add(urlKey);

      if (!matchesCompany(posting.company, company)) {
        outcome.skippedOtherCompany++;
        continue;
      }
      if (!passesPrefilter(posting.title, prefs)) {
        outcome.skippedIrrelevant++;
        continue;
      }

      onProgress?.({ company, status: "scoring", detail: posting.title });
      try {
        await scoreAndSave(posting, company, prefs, provider, today);
        outcome.added++;
      } catch (e) {
        outcome.errors.push({ company, message: `${posting.title || "Untitled posting"}: ${e instanceof Error ? e.message : String(e)}` });
      }
    }
    onProgress?.({ company, status: "done" });
  }

  return outcome;
}
