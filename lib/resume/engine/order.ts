// Reading the dates people write on a resume, to keep roles and projects newest first. Works on any
// experience's dates, not one format: "Jun 2025 - Sep 2025", "June 2025 – Present", "05/2023 -
// 08/2023", "2022-2024", "Summer 2024".

const MONTHS: Record<string, number> = { jan: 1, feb: 2, mar: 3, apr: 4, may: 5, jun: 6, jul: 7, aug: 8, sep: 9, oct: 10, nov: 11, dec: 12 };
const SEASONS: Record<string, number> = { winter: 1, spring: 4, summer: 7, fall: 10, autumn: 10 };

/**
 * When an entry's date range ends, as a sortable number (year * 12 + month), or null when it can't
 * be read. "Present", "Current", "Now" and "Ongoing" sort last-ending, i.e. newest. Reads the formats
 * people write: "Jun 2025 - Sep 2025", "June 2025 – Present", "05/2023 - 08/2023", "2022 - 2024",
 * "Summer 2024", "Oct 2024".
 */
export function dateRangeEnd(dates: string): number | null {
  const d = dates.toLowerCase();
  if (/\b(present|current|now|ongoing|today)\b/.test(d)) return Number.MAX_SAFE_INTEGER;
  return lastDate(d);
}

/** The last date written in `text` (year * 12 + month; month 12 when only a year is given), or null. */
function lastDate(text: string): number | null {
  const tokens = text.match(/\d{1,2}[/.](?:19|20)\d{2}|(?:19|20)\d{2}|[a-z]+/g) ?? [];
  for (let i = tokens.length - 1; i >= 0; i--) {
    const t = tokens[i];
    const numeric = t.match(/^(\d{1,2})[/.]((?:19|20)\d{2})$/);
    if (numeric) return Number(numeric[2]) * 12 + Number(numeric[1]);
    if (/^(19|20)\d{2}$/.test(t)) {
      const before = tokens[i - 1] ?? "";
      const month = MONTHS[before.slice(0, 3)] ?? SEASONS[before];
      return Number(t) * 12 + (month ?? 12);
    }
  }
  return null;
}

/** When an entry's date range starts, read like dateRangeEnd from the part before the dash. */
function dateRangeStart(dates: string): number | null {
  const first = dates.toLowerCase().split(/\s*(?:-|–|—|\bto\b|\buntil\b)\s*(?=[a-z]*\.?\s*(?:\d|present|current|now|ongoing|today))/)[0] ?? "";
  return lastDate(first);
}

/**
 * Entries ordered newest first by end date (then start date), keeping the model's order for ties.
 * `datesOf` gives the dates to sort by (her experience's own, when the entry is matched). Left exactly
 * as written when any entry's dates can't be read, so an unusual format is never scrambled.
 */
export function sortNewestFirst<T extends { dates: string }>(entries: T[], datesOf: (e: T) => string = (e) => e.dates): { entries: T[]; changed: boolean } {
  const keys = entries.map((e) => ({ end: dateRangeEnd(datesOf(e)), start: dateRangeStart(datesOf(e)) }));
  if (keys.some((k) => k.end === null)) return { entries, changed: false };
  const order = entries.map((e, i) => ({ e, i, ...keys[i] }));
  order.sort((x, y) => y.end! - x.end! || (y.start ?? 0) - (x.start ?? 0) || x.i - y.i);
  return { entries: order.map((o) => o.e), changed: order.some((o, i) => o.i !== i) };
}

