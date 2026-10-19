// Pass-through to TypeSafe's Jev API. Jev does not allow browser requests from this site's origin
// (CORS), so the browser posts here and this function forwards the call. This relaxes the
// "nothing leaves the browser except to its own provider" rule for Jev only.
//
// Key ownership: there is NO server-side key. The route uses only the key sent with the request,
// which is the user's own key from their own browser. A request without one is refused. Nothing
// here is stored or logged: no console output, no request data kept, and the response is no-store.

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

export const JEV_URL = "https://api.typesafe.ai/v1/systemone";
export const JEV_MODEL = "jev-latest";
export const MAX_STATE_CHARS = 60_000;
export const MAX_QUESTIONS = 20;
const MAX_BODY_CHARS = 200_000;
const TIMEOUT_MS = 10_000;

export type JevErrorKind = "no_key" | "auth" | "rate_limit" | "overloaded" | "bad_request" | "too_long" | "network" | "timeout" | "unknown";

const HEADERS = { "Cache-Control": "no-store", "Content-Type": "application/json" };

function fail(status: number, kind: JevErrorKind, message: string, retryAfterMs?: number): Response {
  const error: { kind: JevErrorKind; message: string; retryAfterMs?: number } = { kind, message };
  if (retryAfterMs !== undefined) error.retryAfterMs = retryAfterMs;
  return new Response(JSON.stringify({ error }), { status, headers: HEADERS });
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

function retryAfterMs(res: Response): number | undefined {
  const h = res.headers.get("retry-after");
  if (!h) return undefined;
  const secs = Number(h);
  if (Number.isFinite(secs) && secs >= 0) return Math.round(secs * 1000);
  return undefined;
}

export async function POST(req: Request): Promise<Response> {
  if (!sameOrigin(req)) return fail(403, "bad_request", "This request did not come from this app.");

  const raw = await req.text().catch(() => "");
  if (raw.length > MAX_BODY_CHARS) return fail(413, "too_long", "The text is too long to send.");
  let body: unknown;
  try {
    body = JSON.parse(raw);
  } catch {
    return fail(400, "bad_request", "The request was not valid JSON.");
  }
  if (!body || typeof body !== "object" || Array.isArray(body)) return fail(400, "bad_request", "The request body is not an object.");
  const { key, state, questions } = body as { key?: unknown; state?: unknown; questions?: unknown };

  if (typeof key !== "string" || key.trim() === "") return fail(401, "no_key", "No Jev key was sent. Add your key in Settings.");
  const k = key.trim();
  if (k.length < 8 || k.length > 512 || /\s/.test(k)) return fail(401, "auth", "That does not look like a valid Jev key.");

  if (typeof state !== "string" && (state === null || typeof state !== "object")) return fail(400, "bad_request", "The state must be text or an object.");
  const stateText = typeof state === "string" ? state : JSON.stringify(state);
  if (stateText.length > MAX_STATE_CHARS) return fail(413, "too_long", "The text is too long to send.");
  if (!questions || typeof questions !== "object" || Array.isArray(questions)) return fail(400, "bad_request", "The questions must be an object.");
  const count = Object.keys(questions).length;
  if (count < 1 || count > MAX_QUESTIONS) return fail(400, "bad_request", `Send between 1 and ${MAX_QUESTIONS} questions.`);

  let res: Response;
  try {
    res = await fetch(JEV_URL, {
      method: "POST",
      headers: { Authorization: `Bearer ${k}`, "Content-Type": "application/json" },
      body: JSON.stringify({ model: JEV_MODEL, state, questions }),
      signal: AbortSignal.timeout(TIMEOUT_MS),
      cache: "no-store",
    });
  } catch (e) {
    const name = e instanceof Error ? e.name : "";
    if (name === "TimeoutError" || name === "AbortError") return fail(504, "timeout", "Jev took too long to answer.");
    return fail(502, "network", "Could not reach Jev.");
  }

  if (res.ok) {
    const text = await res.text().catch(() => "");
    try {
      JSON.parse(text);
    } catch {
      return fail(502, "unknown", "Jev sent an unreadable answer.");
    }
    return new Response(text, { status: 200, headers: HEADERS });
  }

  // Failure: never forward Jev's raw error text, only a clean kind.
  const detail = await res.text().catch(() => "");
  switch (res.status) {
    case 401:
    case 403:
      return fail(res.status, "auth", "Jev did not accept this key. Check it in Settings.");
    case 429:
      return fail(429, "rate_limit", "Jev is rate limiting this key. Try again in a moment.", retryAfterMs(res));
    case 529:
      return fail(529, "overloaded", "Jev is busy. Try again in a moment.", retryAfterMs(res));
    case 413:
      return fail(413, "too_long", "The text is too long for Jev.");
    case 400:
      return /max_tokens_exceeded/.test(detail) ? fail(400, "too_long", "The text is too long for Jev.") : fail(400, "bad_request", "Jev could not use this request.");
    case 422:
      return fail(422, "bad_request", "Jev could not use this request.");
    default:
      return fail(502, "unknown", "Jev returned an unexpected error.");
  }
}

export async function GET(): Promise<Response> {
  return new Response(JSON.stringify({ error: { kind: "bad_request", message: "POST only." } }), { status: 405, headers: { ...HEADERS, Allow: "POST" } });
}
