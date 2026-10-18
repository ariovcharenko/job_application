// Recognizing which tracker job an application page belongs to, so the right tailored resume is
// uploaded. Pure functions (no chrome.*, no DOM beyond what's passed in), tested on their own.
//
// normalizeJobUrl is a copy of lib/intake/dedupe.ts normalizeJobUrl in the app; a root test
// (lib/intake/dedupe.extension.test.ts) checks the two agree.

import type { SyncedJob } from "../types";

const TRACKING_PARAM = /^(utm_.*|ref|referrer|source|src|gh_src|lever-source.*|lever-origin|trk|trackingid|refid|mode)$/i;

/** A job link in a comparable form: no tracking parameters, #fragment, trailing slash or "www.". */
export function normalizeJobUrl(raw: string): string {
  const text = raw.trim();
  if (!text) return "";
  let url: URL;
  try {
    url = new URL(/^https?:\/\//i.test(text) ? text : `https://${text}`);
  } catch {
    return "";
  }
  const params = [...url.searchParams.entries()].filter(([k]) => !TRACKING_PARAM.test(k)).sort(([a], [b]) => a.localeCompare(b));
  const query = params.length ? `?${new URLSearchParams(params).toString()}` : "";
  const host = url.hostname.toLowerCase().replace(/^www\./, "");
  const path = url.pathname.replace(/\/+$/, "");
  return `${host}${path}${query}`;
}

/** The posting's link without the ATS's "apply" step suffix (Lever /apply, Ashby /application,
 * Workday /apply/..., Greenhouse #app), so the application page matches the saved posting link. */
export function postingKey(raw: string): string {
  const n = normalizeJobUrl(raw);
  if (!n) return "";
  const [pathPart, query = ""] = n.split("?");
  const path = pathPart
    .replace(/\/(apply|application)(\/.*)?$/i, "")
    .replace(/\/(thanks|confirmation|submitted)$/i, "");
  return query ? `${path}?${query}` : path;
}

/** Stable job ids found in ATS links: Greenhouse numeric ids (path or gh_jid), Lever/Ashby UUIDs,
 * Workday requisition ids ("_R12345"). */
export function jobIdTokens(raw: string): string[] {
  const out = new Set<string>();
  let url: URL;
  try {
    url = new URL(/^https?:\/\//i.test(raw.trim()) ? raw.trim() : `https://${raw.trim()}`);
  } catch {
    return [];
  }
  const gh = url.searchParams.get("gh_jid");
  if (gh && /^\d{5,}$/.test(gh)) out.add(`gh:${gh}`);
  const ghPath = url.pathname.match(/\/jobs\/(\d{5,})(?:\/|$)/);
  if (ghPath) out.add(`gh:${ghPath[1]}`);
  for (const m of url.pathname.matchAll(/[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}/gi)) out.add(`uuid:${m[0].toLowerCase()}`);
  const wd = url.pathname.match(/_(R-?\d{3,}|JR-?\d{3,}|REQ-?\d{3,})(?:[/_-]|$)/i);
  if (wd) out.add(`req:${url.hostname.split(".")[0].toLowerCase()}:${wd[1].toUpperCase().replace(/-/g, "")}`);
  return [...out];
}

/** What the page itself says about the job (from the adapter). */
export interface PageJobInfo {
  company: string;
  role: string;
}

export interface JobMatch {
  job: SyncedJob;
  /** "link": same posting link; "id": same ATS job id; "title": same company and role. */
  by: "link" | "id" | "title";
}

const norm = (s: string) =>
  s
    .toLowerCase()
    .replace(/&/g, " and ")
    .replace(/[^a-z0-9]+/g, " ")
    .replace(/\b(inc|llc|ltd|corp|corporation|co|company|the)\b/g, " ")
    .replace(/\s+/g, " ")
    .trim();

const words = (s: string) => new Set(norm(s).split(" ").filter((w) => w.length > 1));

function sameCompany(a: string, b: string): boolean {
  const x = norm(a);
  const y = norm(b);
  if (x.length < 2 || y.length < 2) return false;
  if (x === y) return true;
  // "Acme" vs "Acme Robotics": one is the other's leading words.
  return (x.startsWith(`${y} `) || y.startsWith(`${x} `)) && Math.min(x.length, y.length) >= 3;
}

function sameRole(a: string, b: string): boolean {
  const x = words(a);
  const y = words(b);
  if (x.size === 0 || y.size === 0) return false;
  let shared = 0;
  for (const w of x) if (y.has(w)) shared++;
  return shared / (x.size + y.size - shared) >= 0.75;
}

/**
 * The tracker job this page is for: same link first, then same ATS job id, then same company and
 * role (only when exactly one job fits, so it never guesses between two). Null when unsure.
 */
export function matchJob(jobs: SyncedJob[], pageUrl: string, page: PageJobInfo): JobMatch | null {
  const key = postingKey(pageUrl);
  if (key) {
    const byLink = jobs.find((j) => j.url && postingKey(j.url) === key);
    if (byLink) return { job: byLink, by: "link" };
  }
  const ids = new Set(jobIdTokens(pageUrl));
  if (ids.size) {
    const byId = jobs.find((j) => j.url && jobIdTokens(j.url).some((t) => ids.has(t)));
    if (byId) return { job: byId, by: "id" };
  }
  if (page.company && page.role) {
    const fits = jobs.filter((j) => sameCompany(j.company, page.company) && sameRole(j.role, page.role));
    if (fits.length === 1) return { job: fits[0], by: "title" };
  }
  return null;
}
