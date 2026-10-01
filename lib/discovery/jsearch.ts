// Client for JSearch (https://rapidapi.com/letscrape-6bRBa3QguO5/api/jsearch), a third-party REST
// API that indexes public job listings (including big companies with no public ATS of their own).
// This is plain fetch against a documented REST endpoint, not an Anthropic SDK call.

export interface RawPosting {
  source: "jsearch";
  externalId: string;
  url: string;
  company: string;
  title: string;
  location: string;
  isRemote: boolean;
  description: string;
  /** Epoch milliseconds, or null if JSearch did not report a posting date. */
  postedAt: number | null;
  salaryMin: number | null;
  salaryMax: number | null;
  salaryCurrency: string;
}

export interface JSearchResult {
  postings: RawPosting[];
  /** From the X-RateLimit-Requests-Remaining response header, when RapidAPI sends it. */
  requestsRemaining: number | null;
}

export class JSearchError extends Error {
  constructor(
    message: string,
    public status?: number,
  ) {
    super(message);
    this.name = "JSearchError";
  }
}

// /search-v2, not /search: as of 2026-09 the original /search route answers 404 "Endpoint '/search'
// does not exist" for RapidAPI keys. v2 wraps results as { data: { jobs, cursor } }; one page of
// 10 per company is plenty for a watchlist run, so the cursor isn't followed.
const ENDPOINT = "https://jsearch.p.rapidapi.com/search-v2";

export async function searchJobs(apiKey: string, query: string): Promise<JSearchResult> {
  if (!apiKey.trim()) throw new JSearchError("Add your JSearch API key in Settings first.");

  const url = new URL(ENDPOINT);
  url.searchParams.set("query", query);

  let res: Response;
  try {
    res = await fetch(url.toString(), {
      headers: { "X-RapidAPI-Key": apiKey.trim(), "X-RapidAPI-Host": "jsearch.p.rapidapi.com" },
    });
  } catch {
    throw new JSearchError("Could not reach JSearch. Check your connection.");
  }

  const remainingHeader = res.headers.get("x-ratelimit-requests-remaining");
  const requestsRemaining = remainingHeader !== null && remainingHeader !== "" ? Number(remainingHeader) : null;

  if (res.status === 401 || res.status === 403) {
    throw new JSearchError(
      "JSearch rejected the key. Check it was copied correctly and that you subscribed to the Basic (free) plan.",
      res.status,
    );
  }
  if (res.status === 404) {
    throw new JSearchError(
      `JSearch returned "not found" (status 404) at ${ENDPOINT}. JSearch has renamed endpoints before ` +
        `(/search became /search-v2); check the endpoint list on its RapidAPI page. ${await bodySnippet(res)}`.trim(),
      res.status,
    );
  }
  if (res.status === 429) {
    throw new JSearchError("JSearch's free-tier monthly request limit has been reached.", res.status);
  }
  if (!res.ok) {
    throw new JSearchError(`JSearch returned an error (status ${res.status}). ${await bodySnippet(res)}`.trim(), res.status);
  }

  let body: unknown;
  try {
    body = await res.json();
  } catch {
    throw new JSearchError("JSearch returned something that was not valid JSON.");
  }

  // v2: { data: { jobs: [...] } }. Also accept the old { data: [...] } shape in case it comes back.
  const data = (body as { data?: unknown } | null)?.data;
  const jobs = Array.isArray(data) ? data : (data as { jobs?: unknown } | null | undefined)?.jobs;
  const postings = Array.isArray(jobs) ? jobs.map(normalize).filter((p): p is RawPosting => p !== null) : [];
  return { postings, requestsRemaining };
}

// RapidAPI's error bodies usually explain *why* (e.g. "You are not subscribed to this API"),
// which is far more actionable than the bare status code.
async function bodySnippet(res: Response): Promise<string> {
  try {
    const text = (await res.text()).trim();
    return text ? `RapidAPI said: "${text.slice(0, 300)}"` : "";
  } catch {
    return "";
  }
}

// Read defensively: JSearch's field set is documented but not contractually guaranteed, so a
// listing that doesn't parse is skipped rather than crashing the whole search.
function normalize(raw: unknown): RawPosting | null {
  if (typeof raw !== "object" || raw === null) return null;
  const r = raw as Record<string, unknown>;
  const str = (v: unknown) => (typeof v === "string" ? v : "");
  const num = (v: unknown) => (typeof v === "number" && Number.isFinite(v) ? v : null);

  const title = str(r.job_title);
  const company = str(r.employer_name);
  if (!title && !company) return null;

  const isRemote = r.job_is_remote === true;
  const city = str(r.job_city);
  const state = str(r.job_state);
  const country = str(r.job_country);
  const location = isRemote ? [city, state].filter(Boolean).join(", ") || "Remote" : [city, state || country].filter(Boolean).join(", ");

  const postedSeconds = num(r.job_posted_at_timestamp);

  return {
    source: "jsearch",
    externalId: str(r.job_id) || `${company}|${title}|${str(r.job_apply_link)}`,
    url: str(r.job_apply_link) || str(r.job_google_link),
    company,
    title,
    location,
    isRemote,
    description: str(r.job_description),
    postedAt: postedSeconds !== null ? postedSeconds * 1000 : null,
    salaryMin: num(r.job_min_salary),
    salaryMax: num(r.job_max_salary),
    salaryCurrency: str(r.job_salary_currency) || "USD",
  };
}
