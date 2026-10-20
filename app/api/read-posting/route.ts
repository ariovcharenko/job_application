// Posting reader. Browsers can't download most career sites (CORS), and Claude's web fetch drops
// scripts, so this function downloads the one public page the user typed and returns only the
// schema.org JobPosting fields found in it. This relaxes "nothing leaves the browser except to its
// own provider" for the job link only: the link (nothing else) passes through this server.
//
// Not stored, not logged: no console output, no request data kept, the response is no-store, there
// are no keys and no cookies. SSRF protections live in lib/intake/readerServer.ts.

import { ReaderError, readPostingPage } from "../../../lib/intake/readerServer";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

const MAX_BODY_CHARS = 4096;
const HEADERS = { "Cache-Control": "no-store", "Content-Type": "application/json" };

function json(status: number, body: unknown, extra: Record<string, string> = {}): Response {
  return new Response(JSON.stringify(body), { status, headers: { ...HEADERS, ...extra } });
}

function fail(status: number, kind: string, message: string, closed?: boolean): Response {
  return json(status, { error: { kind, message }, ...(closed !== undefined ? { closed } : {}) });
}

function hostOf(url: string | null): string | null {
  if (!url) return null;
  try {
    return new URL(url).host;
  } catch {
    return null;
  }
}

/** Only this site's own pages may use the route: the Origin (or Referer) host must be the request's own host. */
function sameOrigin(req: Request): boolean {
  const own = [req.headers.get("x-forwarded-host"), req.headers.get("host"), hostOf(req.url)].filter((h): h is string => !!h);
  const from = hostOf(req.headers.get("origin")) ?? hostOf(req.headers.get("referer"));
  return !!from && own.includes(from);
}

const STATUS: Record<string, number> = { bad_url: 400, blocked_host: 403, private_address: 400, not_html: 422, too_large: 413, timeout: 504, network: 502, http_error: 502, no_posting: 404 };

export async function POST(req: Request): Promise<Response> {
  if (!sameOrigin(req)) return fail(403, "bad_url", "This request did not come from this app.");
  const raw = await req.text().catch(() => "");
  if (raw.length > MAX_BODY_CHARS) return fail(413, "bad_url", "That link is too long.");
  let body: unknown;
  try {
    body = JSON.parse(raw);
  } catch {
    return fail(400, "bad_url", "The request was not valid JSON.");
  }
  const url = body && typeof body === "object" && !Array.isArray(body) ? (body as { url?: unknown }).url : undefined;
  try {
    const { posting, closed } = await readPostingPage(url);
    return json(200, { posting, closed });
  } catch (e) {
    if (e instanceof ReaderError) return fail(STATUS[e.kind] ?? 502, e.kind, e.message, e.kind === "no_posting" ? e.closed : undefined);
    return fail(502, "network", "Could not read that page.");
  }
}

export async function GET(): Promise<Response> {
  return json(405, { error: { kind: "bad_url", message: "POST only." } }, { Allow: "POST" });
}
