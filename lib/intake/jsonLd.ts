import { htmlToText } from "./sources";

// Career platforms (Phenom, Workday, iCIMS, SuccessFactors, Oracle, Eightfold, Apple...) put a
// schema.org JobPosting in their HTML for Google for Jobs, even when the visible page is built with
// JavaScript. This reads it out of raw HTML. Pure and isomorphic: no DOM, nothing in the page can run.

export interface JobPostingData {
  title: string;
  company: string;
  /** Places as written, "Remote" first when the posting is a telecommute job. */
  locations: string[];
  employmentType: string;
  datePosted: string;
  validThrough: string;
  salary: string;
  identifier: string;
  descriptionText: string;
}

const str = (v: unknown): string => (typeof v === "string" ? v.trim() : typeof v === "number" ? String(v) : "");
const obj = (v: unknown): Record<string, unknown> | null => (v && typeof v === "object" && !Array.isArray(v) ? (v as Record<string, unknown>) : null);
const list = (v: unknown): unknown[] => (Array.isArray(v) ? v : v === undefined || v === null ? [] : [v]);
const clean = (s: string) => htmlToText(s).replace(/\s*\n\s*/g, " ").trim();

function isJobPosting(o: Record<string, unknown>): boolean {
  return list(o["@type"]).some((t) => typeof t === "string" && /(^|[/#:])JobPosting$/i.test(t.trim()));
}

/** Every JobPosting object in parsed JSON-LD: arrays, @graph and nesting included. */
function findPostings(value: unknown, out: Record<string, unknown>[], depth = 0): void {
  if (depth > 6 || out.length > 20) return;
  if (Array.isArray(value)) {
    for (const v of value) findPostings(v, out, depth + 1);
    return;
  }
  const o = obj(value);
  if (!o) return;
  if (isJobPosting(o)) out.push(o);
  findPostings(o["@graph"], out, depth + 1);
  findPostings(o.mainEntity, out, depth + 1);
  findPostings(o.itemListElement, out, depth + 1);
  findPostings(o.item, out, depth + 1);
}

function parseJson(raw: string): unknown {
  const t = raw
    .trim()
    .replace(/^<!--/, "")
    .replace(/-->$/, "")
    .replace(/^\/\/\s*<!\[CDATA\[|\/\/\s*\]\]>$/g, "")
    .replace(/^<!\[CDATA\[|\]\]>$/g, "")
    .trim();
  if (!t) return undefined;
  // Some platforms put raw line breaks inside strings, which JSON forbids: retry with them as spaces.
  for (const attempt of [t, t.replace(/[\u0000-\u001f]+/g, " ")]) {
    try {
      return JSON.parse(attempt);
    } catch {
      /* try the next form */
    }
  }
  return undefined;
}

function place(p: unknown): string {
  if (typeof p === "string") return clean(p);
  const o = obj(p);
  if (!o) return "";
  if (typeof o.address === "string") return clean(o.address);
  const a = obj(o.address) ?? o;
  const country = obj(a.addressCountry) ? str(obj(a.addressCountry)!.name) : str(a.addressCountry);
  const parts = [str(a.addressLocality), str(a.addressRegion), country].map(clean).filter(Boolean);
  return parts.join(", ") || clean(str(o.name));
}

function salary(v: unknown): string {
  const o = obj(v);
  if (!o) return "";
  const cur = str(o.currency);
  const val = obj(o.value);
  const unit = str(val?.unitText ?? o.unitText).toLowerCase();
  const num = (n: unknown): number | null => (typeof n === "number" || (typeof n === "string" && n.trim() !== "" && Number.isFinite(Number(n))) ? Number(n) : null);
  const min = num(val?.minValue);
  const max = num(val?.maxValue);
  const single = num(val ? val.value : o.value);
  const fmt = (n: number) => n.toLocaleString("en-US");
  let range = "";
  if (min !== null && max !== null && min !== max) range = `${fmt(min)} to ${fmt(max)}`;
  else if (single !== null) range = fmt(single);
  else if (min !== null) range = fmt(min);
  else if (max !== null) range = fmt(max);
  if (!range) return "";
  return [cur, range, unit ? `per ${unit}` : ""].filter(Boolean).join(" ");
}

function employment(v: unknown): string {
  return list(v)
    .map((t) => str(t))
    .filter(Boolean)
    .map((t) => (/^[A-Z_]+$/.test(t) ? t.toLowerCase().replace(/_/g, " ").replace(/^./, (c) => c.toUpperCase()) : t))
    .join(", ");
}

function identifier(v: unknown): string {
  if (typeof v === "string" || typeof v === "number") return String(v).trim();
  const o = obj(v);
  return o ? str(o.value) || str(o.name) : "";
}

function fromObject(o: Record<string, unknown>): JobPostingData {
  const org = o.hiringOrganization;
  const locations = list(o.jobLocation).map(place).filter(Boolean);
  if (/telecommute/i.test(list(o.jobLocationType).map(str).join(" "))) locations.unshift("Remote");
  return {
    title: clean(str(o.title) || str(o.name)),
    company: clean(typeof org === "string" ? org : str(obj(org)?.name)),
    locations: [...new Set(locations)],
    employmentType: employment(o.employmentType),
    datePosted: str(o.datePosted),
    validThrough: str(o.validThrough),
    salary: salary(o.baseSalary),
    identifier: identifier(o.identifier),
    descriptionText: htmlToText(str(o.description)),
  };
}

const LD_RE = /<script\b[^>]*\btype\s*=\s*["']?application\/ld\+json["']?[^>]*>([\s\S]*?)<\/script\s*>/gi;

/** Fallback: schema.org microdata (itemtype=".../JobPosting" with itemprop children). Deliberately simple. */
function microdata(html: string): JobPostingData | null {
  const start = html.search(/itemtype\s*=\s*["']https?:\/\/schema\.org\/JobPosting["']/i);
  if (start < 0) return null;
  const scope = html.slice(start, start + 600_000);
  /** Value of the first itemprop with this name at or after `from`: its content attribute, else its inner HTML. */
  const read = (name: string, from = 0, limit = scope.length): string => {
    const sub = scope.slice(from, limit);
    const m = new RegExp(`<(\\w+)\\b[^>]*\\bitemprop\\s*=\\s*["']${name}["'][^>]*>`, "i").exec(sub);
    if (!m) return "";
    const content = /\bcontent\s*=\s*"([^"]*)"|\bcontent\s*=\s*'([^']*)'/i.exec(m[0]);
    if (content) return content[1] ?? content[2] ?? "";
    const after = sub.slice(m.index + m[0].length);
    const end = after.search(new RegExp(`</${m[1]}\\s*>`, "i"));
    return end < 0 ? "" : after.slice(0, end);
  };
  const nested = (outer: string, inner: string): string => {
    const m = new RegExp(`itemprop\\s*=\\s*["']${outer}["']`, "i").exec(scope);
    return m ? clean(read(inner, m.index, m.index + 3000)) : "";
  };
  const description = read("description");
  const title = clean(read("title"));
  if (!title && !description) return null;
  const loc = [nested("jobLocation", "addressLocality"), nested("jobLocation", "addressRegion"), nested("jobLocation", "addressCountry")].filter(Boolean).join(", ");
  return {
    title,
    company: nested("hiringOrganization", "name"),
    locations: loc ? [loc] : [],
    employmentType: employment(clean(read("employmentType"))),
    datePosted: clean(read("datePosted")),
    validThrough: clean(read("validThrough")),
    salary: "",
    identifier: clean(read("identifier")),
    descriptionText: htmlToText(description),
  };
}

/** The JobPosting embedded in a page's HTML, or null. With several, the one with the longest description. */
export function extractJobPosting(html: string): JobPostingData | null {
  const found: Record<string, unknown>[] = [];
  for (const m of html.matchAll(LD_RE)) {
    const parsed = parseJson(m[1]);
    if (parsed !== undefined) findPostings(parsed, found);
  }
  const candidates = found.map(fromObject).filter((p) => p.title || p.descriptionText);
  if (candidates.length) return candidates.reduce((a, b) => (b.descriptionText.length > a.descriptionText.length ? b : a));
  return microdata(html);
}

/** Visible text of a page, scripts and styles removed. For the closed-page check only. */
export function visibleText(html: string): string {
  return htmlToText(html.replace(/<(script|style|noscript|template|svg)\b[\s\S]*?<\/\1\s*>/gi, " ").replace(/<!--[\s\S]*?-->/g, " "));
}

const CLOSED_PHRASES = [
  /no longer (available|accepting|open|active|listed)/i,
  /\b(job|position|role|posting|requisition|opening|vacancy)\b[^.\n]{0,40}\b(has been|have been|was|is|has)\s+(filled|closed|removed|expired|cancell?ed|withdrawn)/i,
  /\b(position|job|role|posting|opening)\s+(is\s+)?(closed|filled|expired)/i,
  /\b(job|position|posting|role)\s+(has\s+)?expired/i,
  /\b(job|position|posting|role)\s+(you('|’)re|you are)\s+looking for\s+(is|has|was)\b[^.\n]{0,30}\b(closed|filled|removed|expired|no longer)/i,
  /\bnot\s+accepting\s+(any\s+more\s+)?applications/i,
  /\bapplications?\s+(for this (job|position|role)\s+)?(are|is|have)\s+(now\s+)?closed/i,
];

/** Whether a page's visible text says the posting is gone. Pass the page's visible text, not its HTML. */
export function closedSignal(visible: string): boolean {
  // "This posting will remain open until the position is filled" is boilerplate in live postings.
  const text = visible.replace(/\b(until|till|when|once|after|before|unless|if|whenever|as soon as|so long as)\b[^.\n]{0,60}\b(filled|closed|expired|removed|no longer)\b/gi, " ");
  return CLOSED_PHRASES.some((re) => re.test(text));
}

/** The posting as plain text for scoring: heading lines, then the description. */
export function postingToText(p: JobPostingData): string {
  const head = [
    p.title,
    p.company,
    p.locations.length ? `Location: ${p.locations.join("; ")}` : "",
    p.employmentType ? `Employment type: ${p.employmentType}` : "",
    p.datePosted ? `Posted: ${p.datePosted}` : "",
    p.salary ? `Salary: ${p.salary}` : "",
  ].filter(Boolean);
  return [head.join("\n"), p.descriptionText].filter(Boolean).join("\n\n");
}
