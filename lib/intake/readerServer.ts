import dns from "node:dns/promises";
import https from "node:https";
import net from "node:net";
import { Readable } from "node:stream";
import zlib from "node:zlib";
import {
  closedSignal,
  extractJobPosting,
  visibleText,
  type JobPostingData,
} from "./jsonLd";
import { isBlockedBoardHost } from "./sources";

// Server side of the posting reader (app/api/read-posting/route.ts). Fetches one public https page
// for a link the user typed and returns only the JobPosting fields found in it. Because the server
// downloads whatever address it is given, every step here exists to keep that from reaching
// anything but the public internet. Server only: it imports node modules.

export type ReaderErrorKind =
  | "bad_url"
  | "blocked_host"
  | "private_address"
  | "not_html"
  | "too_large"
  | "timeout"
  | "network"
  | "http_error"
  | "no_posting";

export class ReaderError extends Error {
  constructor(
    readonly kind: ReaderErrorKind,
    message: string,
    /** For no_posting: the page said the job is closed. */
    readonly closed = false,
  ) {
    super(message);
  }
}

export const MAX_URL_LENGTH = 2048;
export const MAX_REDIRECTS = 3;
export const MAX_BYTES = 3 * 1024 * 1024;
export const TOTAL_TIMEOUT_MS = 8000;
export const USER_AGENT =
  "Mozilla/5.0 (Macintosh; Intel Mac OS X 10_15_7) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/126.0.0.0 Safari/537.36";

// ---------------------------------------------------------------------------------------------
// Addresses

function ipv4Parts(ip: string): number[] | null {
  const m = /^(\d{1,3})\.(\d{1,3})\.(\d{1,3})\.(\d{1,3})$/.exec(ip);
  if (!m) return null;
  const parts = m.slice(1).map(Number);
  return parts.every((n) => n <= 255) ? parts : null;
}

function privateIpv4(p: number[]): boolean {
  const [a, b, c] = p;
  return (
    a === 0 || // 0.0.0.0/8, unspecified
    a === 10 ||
    a === 127 ||
    (a === 100 && b >= 64 && b <= 127) || // CGNAT
    (a === 169 && b === 254) || // link-local, cloud metadata
    (a === 172 && b >= 16 && b <= 31) ||
    (a === 192 && b === 168) ||
    (a === 192 && b === 0 && c === 0) || // IETF protocol assignments
    (a === 198 && (b === 18 || b === 19)) || // benchmarking
    a >= 224 // multicast 224/4 and reserved 240/4, including broadcast
  );
}

/** Eight 16-bit groups of an IPv6 address, or null if it isn't one. */
function ipv6Groups(ip: string): number[] | null {
  let s = ip.toLowerCase();
  const zone = s.indexOf("%");
  if (zone >= 0) s = s.slice(0, zone);
  const tail = /(\d+\.\d+\.\d+\.\d+)$/.exec(s);
  if (tail) {
    const v4 = ipv4Parts(tail[1]);
    if (!v4) return null;
    s =
      s.slice(0, s.length - tail[1].length) +
      ((v4[0] << 8) | v4[1]).toString(16) +
      ":" +
      ((v4[2] << 8) | v4[3]).toString(16);
  }
  const halves = s.split("::");
  if (halves.length > 2) return null;
  const head = halves[0] ? halves[0].split(":") : [];
  const rest = halves.length === 2 && halves[1] ? halves[1].split(":") : [];
  const fill = halves.length === 2 ? 8 - head.length - rest.length : 0;
  if (fill < 0 || (halves.length === 1 && head.length !== 8)) return null;
  const all = [...head, ...Array<string>(fill).fill("0"), ...rest];
  if (all.length !== 8 || !all.every((g) => /^[0-9a-f]{1,4}$/.test(g)))
    return null;
  return all.map((g) => parseInt(g, 16));
}

/** True for any address that is not a normal public one. Anything unparseable counts as private. */
export function isPrivateAddress(ip: string): boolean {
  const v4 = ipv4Parts(ip);
  if (v4) return privateIpv4(v4);
  const g = ipv6Groups(ip);
  if (!g) return true;
  const embedded = (hi: number, lo: number) =>
    privateIpv4([hi >> 8, hi & 255, lo >> 8, lo & 255]);
  if (g.every((x) => x === 0)) return true; // ::
  if (g.slice(0, 7).every((x) => x === 0) && g[7] === 1) return true; // ::1
  if (g.slice(0, 5).every((x) => x === 0) && g[5] === 0xffff)
    return embedded(g[6], g[7]); // ::ffff:a.b.c.d
  if (g.slice(0, 6).every((x) => x === 0)) return embedded(g[6], g[7]); // ::a.b.c.d (deprecated, compatible)
  if (g[0] === 0x64 && g[1] === 0xff9b && g.slice(2, 6).every((x) => x === 0))
    return embedded(g[6], g[7]); // NAT64
  if (g[0] === 0x2002) return embedded(g[1], g[2]); // 6to4
  if ((g[0] & 0xfe00) === 0xfc00) return true; // fc00::/7 unique local
  if ((g[0] & 0xffc0) === 0xfe80) return true; // fe80::/10 link-local
  if ((g[0] & 0xffc0) === 0xfec0) return true; // fec0::/10 site-local (deprecated)
  if ((g[0] & 0xff00) === 0xff00) return true; // ff00::/8 multicast
  if (g[0] === 0x2001 && g[1] === 0x0db8) return true; // documentation
  return false;
}

// ---------------------------------------------------------------------------------------------
// URL checks

const INTERNAL_SUFFIX =
  /\.(local|localhost|localdomain|internal|intranet|lan|home|corp|private)$/i;

/** Syntax checks that need no network. Throws ReaderError, or returns the parsed URL. */
export function validateUrl(raw: unknown): URL {
  if (
    typeof raw !== "string" ||
    raw.length === 0 ||
    raw.length > MAX_URL_LENGTH
  )
    throw new ReaderError("bad_url", "That link is not usable.");
  let url: URL;
  try {
    url = new URL(raw.trim());
  } catch {
    throw new ReaderError("bad_url", "That link is not usable.");
  }
  if (url.protocol !== "https:")
    throw new ReaderError("bad_url", "Only https links can be read.");
  if (url.username || url.password)
    throw new ReaderError(
      "bad_url",
      "Links with a login in them can't be read.",
    );
  if (url.port !== "" && url.port !== "443")
    throw new ReaderError(
      "bad_url",
      "Only the standard https port can be read.",
    );
  const host = url.hostname.toLowerCase().replace(/\.$/, "");
  const bare = host.replace(/^\[|\]$/g, "");
  if (net.isIP(bare)) {
    throw isPrivateAddress(bare)
      ? new ReaderError("private_address", "That address can't be read.")
      : new ReaderError(
          "bad_url",
          "Use the posting's web address, not an IP number.",
        );
  }
  if (!host.includes("."))
    throw new ReaderError("bad_url", "That link is not usable.");
  if (INTERNAL_SUFFIX.test(host))
    throw new ReaderError("private_address", "That address can't be read.");
  if (isBlockedBoardHost(host))
    throw new ReaderError("blocked_host", "The app doesn't read that site.");
  return url;
}

export type Lookup = (
  hostname: string,
) => Promise<{ address: string; family: number }[]>;

const defaultLookup: Lookup = (hostname) =>
  dns.lookup(hostname, { all: true, verbatim: true });

/** Resolves the host and refuses if ANY of its addresses is not public. Returns the addresses. */
export async function resolvePublic(
  host: string,
  lookup: Lookup,
): Promise<{ address: string; family: number }[]> {
  let addrs: { address: string; family: number }[];
  try {
    addrs = await lookup(host.replace(/^\[|\]$/g, ""));
  } catch {
    throw new ReaderError("network", "Could not find that site.");
  }
  if (!addrs.length)
    throw new ReaderError("network", "Could not find that site.");
  if (addrs.some((a) => isPrivateAddress(a.address)))
    throw new ReaderError("private_address", "That address can't be read.");
  return addrs;
}

// ---------------------------------------------------------------------------------------------
// Transport

/** Does one GET with no redirects, connecting only to the already-checked addresses. Replaceable in tests. */
export type Transport = (
  url: URL,
  addresses: { address: string; family: number }[],
  signal: AbortSignal,
) => Promise<Response>;

/** The real transport: node https with the connection pinned to the addresses that passed the check (no second DNS lookup to swap). */
export const httpsTransport: Transport = (url, addresses, signal) =>
  new Promise<Response>((resolve, reject) => {
    const pinned = addresses[0];
    const req = https.request(
      {
        protocol: "https:",
        hostname: url.hostname.replace(/^\[|\]$/g, ""),
        servername: net.isIP(url.hostname) ? undefined : url.hostname,
        port: 443,
        path: url.pathname + url.search,
        method: "GET",
        headers: {
          "User-Agent": USER_AGENT,
          Accept: "text/html,application/xhtml+xml",
          "Accept-Language": "en-US,en;q=0.9",
          "Accept-Encoding": "gzip, deflate, br",
        },
        lookup: (_h, opts, cb) => {
          const o = opts as { all?: boolean };
          if (o?.all)
            (
              cb as unknown as (
                e: null,
                a: { address: string; family: number }[],
              ) => void
            )(null, [pinned]);
          else cb(null, pinned.address, pinned.family);
        },
        signal,
      },
      (res) => {
        const headers = new Headers();
        for (const [k, v] of Object.entries(res.headers)) {
          if (k.toLowerCase() === "set-cookie" || v === undefined) continue;
          for (const one of Array.isArray(v) ? v : [v]) headers.append(k, one);
        }
        const status = res.statusCode ?? 0;
        let stream: Readable = res;
        const enc = (res.headers["content-encoding"] ?? "").toLowerCase();
        if (enc === "gzip") stream = res.pipe(zlib.createGunzip());
        else if (enc === "deflate") stream = res.pipe(zlib.createInflate());
        else if (enc === "br") stream = res.pipe(zlib.createBrotliDecompress());
        stream.on("error", () => {});
        const noBody =
          status < 200 || status === 204 || status === 205 || status === 304;
        resolve(
          new Response(
            noBody
              ? null
              : (Readable.toWeb(stream) as ReadableStream<Uint8Array>),
            { status: status < 200 ? 502 : status, headers },
          ),
        );
        if (noBody) res.resume();
      },
    );
    req.on("error", reject);
    req.end();
  });

// ---------------------------------------------------------------------------------------------
// Fetch and extract

async function readCapped(
  res: Response,
  max: number,
): Promise<{ text: string; truncated: boolean }> {
  if (!res.body) return { text: "", truncated: false };
  const reader = res.body.getReader();
  const chunks: Uint8Array[] = [];
  let size = 0;
  let truncated = false;
  for (;;) {
    const { done, value } = await reader.read();
    if (done) break;
    if (size + value.length > max) {
      chunks.push(value.slice(0, max - size));
      truncated = true;
      await reader.cancel().catch(() => {});
      break;
    }
    chunks.push(value);
    size += value.length;
  }
  const buf = Buffer.concat(chunks);
  const charset =
    /charset\s*=\s*["']?([\w-]+)/i.exec(
      res.headers.get("content-type") ?? "",
    )?.[1] ?? "utf-8";
  let text: string;
  try {
    text = new TextDecoder(charset).decode(buf);
  } catch {
    text = buf.toString("utf8");
  }
  return { text, truncated };
}

export interface ReaderDeps {
  lookup?: Lookup;
  transport?: Transport;
  timeoutMs?: number;
}

export interface ReaderResult {
  posting: JobPostingData;
  closed: boolean;
}

/**
 * Downloads a public posting page and returns the JobPosting embedded in it. Every hop (the first
 * address and each redirect) goes through the same checks. Never returns the page itself.
 */
export async function readPostingPage(
  rawUrl: unknown,
  deps: ReaderDeps = {},
): Promise<ReaderResult> {
  const lookup = deps.lookup ?? defaultLookup;
  const transport = deps.transport ?? httpsTransport;
  const timeoutMs = deps.timeoutMs ?? TOTAL_TIMEOUT_MS;
  const controller = new AbortController();
  const timer = setTimeout(() => controller.abort(), timeoutMs);
  const timedOut = () => controller.signal.aborted;
  try {
    try {
      return await fetchAndExtract(validateUrl(rawUrl));
    } catch (e) {
      // iCIMS serves the posting inside an iframe page (the same address with in_iframe=1) and the
      // outer page has no data in it. Same checks apply: validateUrl and DNS run again.
      if (e instanceof ReaderError && e.kind === "no_posting" && !e.closed) {
        const first = validateUrl(rawUrl);
        if (
          /\.icims\.com$/i.test(first.hostname) &&
          !first.searchParams.has("in_iframe")
        ) {
          first.searchParams.set("in_iframe", "1");
          return await fetchAndExtract(validateUrl(first.toString()));
        }
      }
      throw e;
    }

    async function fetchAndExtract(start: URL): Promise<ReaderResult> {
      let url = start;
      let res: Response | null = null;
      for (let hop = 0; hop <= MAX_REDIRECTS; hop++) {
        const addresses = await Promise.race([
          resolvePublic(url.hostname, lookup),
          new Promise<never>((_, rej) =>
            controller.signal.addEventListener("abort", () =>
              rej(
                new ReaderError("timeout", "The page took too long to answer."),
              ),
            ),
          ),
        ]);
        try {
          res = await transport(url, addresses, controller.signal);
        } catch (e) {
          if (e instanceof ReaderError) throw e;
          throw timedOut()
            ? new ReaderError("timeout", "The page took too long to answer.")
            : new ReaderError("network", "Could not reach that page.");
        }
        if ([301, 302, 303, 307, 308].includes(res.status)) {
          const loc = res.headers.get("location");
          await res.body?.cancel().catch(() => {});
          if (!loc)
            throw new ReaderError(
              "http_error",
              "The site sent a redirect with nowhere to go.",
            );
          if (hop === MAX_REDIRECTS)
            throw new ReaderError(
              "http_error",
              "The link redirects too many times.",
            );
          let next: string;
          try {
            next = new URL(loc, url).toString();
          } catch {
            throw new ReaderError(
              "bad_url",
              "The site redirected to an unusable address.",
            );
          }
          url = validateUrl(next);
          res = null;
          continue;
        }
        break;
      }
      if (!res)
        throw new ReaderError(
          "http_error",
          "The link redirects too many times.",
        );
      if (!res.ok) {
        await res.body?.cancel().catch(() => {});
        throw new ReaderError(
          "http_error",
          `The site answered with an error (${res.status}).`,
        );
      }
      const type = (res.headers.get("content-type") ?? "").toLowerCase();
      if (!/^(text\/html|application\/xhtml\+xml)\b/.test(type)) {
        await res.body?.cancel().catch(() => {});
        throw new ReaderError("not_html", "That link is not a web page.");
      }
      let page: { text: string; truncated: boolean };
      try {
        page = await readCapped(res, MAX_BYTES);
      } catch {
        throw timedOut()
          ? new ReaderError("timeout", "The page took too long to answer.")
          : new ReaderError("network", "The page stopped loading.");
      }
      const posting = extractJobPosting(page.text);
      const closed = closedSignal(visibleText(page.text));
      if (!posting) {
        if (page.truncated)
          throw new ReaderError("too_large", "That page is too large to read.");
        throw new ReaderError(
          "no_posting",
          "No job posting was found in that page.",
          closed,
        );
      }
      return { posting, closed };
    }
  } finally {
    clearTimeout(timer);
  }
}
