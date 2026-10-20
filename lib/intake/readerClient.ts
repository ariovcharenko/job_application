import type { JobPostingData } from "./jsonLd";

// Browser side of the posting reader (app/api/read-posting/route.ts). Sends the job link, and only
// the link, to this app's own server, which downloads the public page and returns its JobPosting
// fields. Free: no AI. Any failure is "none": the caller moves on to the next way of reading.

export type ReaderOutcome =
  | { kind: "posting"; posting: JobPostingData; closed: boolean }
  /** No posting could be read. `closed` is true only when the page said the job is gone. */
  | { kind: "none"; closed: boolean; reason?: string };

type FetchLike = (input: string, init: { method: string; headers: Record<string, string>; body: string; signal?: AbortSignal }) => Promise<{ ok: boolean; json(): Promise<unknown> }>;

// One reader call at a time, so a batch of links doesn't hit the server (and career sites) all at once.
let tail: Promise<unknown> = Promise.resolve();
function exclusive<T>(job: () => Promise<T>): Promise<T> {
  const run = tail.then(job, job);
  tail = run.catch(() => {});
  return run;
}

const CLIENT_TIMEOUT_MS = 15_000;

export function readViaServer(url: string, fetchImpl: FetchLike = (i, init) => fetch(i, init)): Promise<ReaderOutcome> {
  return exclusive(async () => {
    try {
      const signal = typeof AbortSignal !== "undefined" && "timeout" in AbortSignal ? AbortSignal.timeout(CLIENT_TIMEOUT_MS) : undefined;
      const res = await fetchImpl("/api/read-posting", { method: "POST", headers: { "Content-Type": "application/json" }, body: JSON.stringify({ url }), signal });
      const data = (await res.json()) as { posting?: JobPostingData; closed?: boolean; error?: { kind?: string } };
      if (res.ok && data.posting && typeof data.posting === "object") return { kind: "posting", posting: data.posting, closed: data.closed === true };
      return { kind: "none", closed: data.closed === true, reason: data.error?.kind };
    } catch {
      // No route (static hosting), offline, or not JSON.
      return { kind: "none", closed: false, reason: "network" };
    }
  });
}
