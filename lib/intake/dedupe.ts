import { db } from "../db";
import type { Application } from "../types";

// Recognizing a position she already checked, so she isn't charged (or confused) twice.

/** Query parameters that only say where a link was shared from, not which job it is. */
const TRACKING_PARAM = /^(utm_.*|ref|referrer|source|src|gh_src|lever-source.*|lever-origin|trk|trackingid|refid|mode)$/i;

/**
 * A job link in a comparable form: no tracking parameters, no #fragment, no trailing slash,
 * lowercase host, and "www." dropped. Returns "" for text that isn't a link.
 */
export function normalizeJobUrl(raw: string): string {
  const text = raw.trim();
  if (!text) return "";
  let url: URL;
  try {
    url = new URL(/^https?:\/\//i.test(text) ? text : `https://${text}`);
  } catch {
    return "";
  }
  const params = [...url.searchParams.entries()]
    .filter(([k]) => !TRACKING_PARAM.test(k))
    .sort(([a], [b]) => a.localeCompare(b));
  const query = params.length ? `?${new URLSearchParams(params).toString()}` : "";
  const host = url.hostname.toLowerCase().replace(/^www\./, "");
  const path = url.pathname.replace(/\/+$/, "");
  return `${host}${path}${query}`;
}

const norm = (s: string) => s.toLowerCase().replace(/[^a-z0-9]+/g, " ").trim();

/** Same company and same role title, ignoring case and punctuation. Both must be known. */
export function sameCompanyAndRole(a: Pick<Application, "company" | "role">, b: Pick<Application, "company" | "role">): boolean {
  return !!norm(a.company) && !!norm(a.role) && norm(a.company) === norm(b.company) && norm(a.role) === norm(b.role);
}

/** A job she already has: by link, or by company + role when either one has no link. Pure, for tests. */
export function findMatch<T extends Application>(
  apps: T[],
  job: { url?: string; company?: string; role?: string },
): T | undefined {
  const key = normalizeJobUrl(job.url ?? "");
  if (key) {
    const byUrl = apps.find((a) => normalizeJobUrl(a.url) === key);
    if (byUrl) return byUrl;
  }
  // Same company and title only counts when one side has no link: two different postings can
  // share a title ("Software Engineer" on two teams), and their links tell them apart.
  if (job.company && job.role) {
    return apps.find((a) => (!key || !normalizeJobUrl(a.url)) && sameCompanyAndRole(a, { company: job.company!, role: job.role! }));
  }
  return undefined;
}

export async function findExistingJob(job: { url?: string; company?: string; role?: string }): Promise<(Application & { id: number }) | undefined> {
  const apps = (await db.applications.toArray()) as (Application & { id: number })[];
  return findMatch(apps, job);
}
