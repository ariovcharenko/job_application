import type { JobSignals } from "../scoring/signals";

// How old a posting is, from what the job check extracted: the posting's own wording
// ("Posted 3 days ago", "30+ days ago", "Posted Sep 3, 2026") when it was quoted, else the
// freshness bucket. Both describe the posting on the day it was checked, so the days since then
// are added. Unknown stays unknown: no label, no guess.

const DAY = 24 * 60 * 60 * 1000;

export interface PostedAge {
  /** Days between posting and now (a lower bound when `atLeast`). */
  days: number;
  /** True when the source only says "at least" (a "30+ days ago" quote, or a bucket). */
  atLeast: boolean;
}

const UNIT_DAYS: Record<string, number> = { hour: 0, hr: 0, minute: 0, min: 0, day: 1, week: 7, wk: 7, month: 30, mo: 30 };
const MONTH_WORD = /\b(jan|feb|mar|apr|may|jun|jul|aug|sep|sept|oct|nov|dec)[a-z]*\.?\s+\d{1,2}\b/i;
const ISO_DATE = /\b\d{4}-\d{2}-\d{2}\b/;

/** Days old on the day it was checked, read from the quoted wording, or null if it says nothing usable. */
export function daysFromEvidence(evidence: string, checkedAt: number): PostedAge | null {
  const text = evidence.toLowerCase();
  if (!text.trim()) return null;
  if (/\b(just posted|posted today|today|just now)\b/.test(text)) return { days: 0, atLeast: false };
  if (/\byesterday\b/.test(text)) return { days: 1, atLeast: false };
  const rel = text.match(/(\d+)\s*(\+)?\s*(minute|min|hour|hr|day|week|wk|month|mo)s?\b\s*(\+)?\s*ago/);
  if (rel) {
    const unit = UNIT_DAYS[rel[3]];
    return { days: Number(rel[1]) * unit, atLeast: !!(rel[2] || rel[4]) };
  }
  if (MONTH_WORD.test(text) || ISO_DATE.test(text)) {
    const raw = (evidence.match(ISO_DATE)?.[0] ?? evidence.replace(/^.*?(?=\b(jan|feb|mar|apr|may|jun|jul|aug|sep|oct|nov|dec))/i, "")).trim();
    // A date without a year is read as the check's year.
    const withYear = /\b\d{4}\b/.test(raw) ? raw : `${raw} ${new Date(checkedAt).getFullYear()}`;
    const t = Date.parse(withYear);
    if (Number.isFinite(t) && t <= checkedAt + DAY) return { days: Math.max(0, Math.floor((checkedAt - t) / DAY)), atLeast: false };
  }
  return null;
}

/** How old the posting is now, or null when the check couldn't tell. */
export function postedAge(signals: Pick<JobSignals, "freshness" | "freshnessEvidence"> | undefined, checkedAt: number, now: number): PostedAge | null {
  if (!signals) return null;
  const since = Math.max(0, Math.floor((now - checkedAt) / DAY));
  const quoted = daysFromEvidence(signals.freshnessEvidence ?? "", checkedAt);
  if (quoted) return { days: quoted.days + since, atLeast: quoted.atLeast };
  switch (signals.freshness) {
    case "within_24h":
      return { days: since, atLeast: false };
    case "within_week":
      return { days: since + 1, atLeast: true };
    case "older":
      return { days: since + 8, atLeast: true };
    default:
      return null;
  }
}

/** "Posted today", "Posted 3 days ago", "Posted over 2 weeks ago"... */
export function postedLabel(age: PostedAge | null): string | null {
  if (!age) return null;
  const { days, atLeast } = age;
  if (!atLeast && days === 0) return "Posted today";
  if (!atLeast && days === 1) return "Posted yesterday";
  const span =
    days < 14 ? `${days} days` : days < 60 ? `${Math.floor(days / 7)} weeks` : `${Math.floor(days / 30)} months`;
  if (atLeast) return days <= 1 ? "Posted this week" : `Posted over ${span} ago`;
  return `Posted ${span} ago`;
}
