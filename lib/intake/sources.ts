import { AIError } from "../ai/provider";

// Reading a job posting from its link without spending anything where that is possible.
//
// Order: (1) planLink decides what a link is, (2) the ATSs below publish their listings as public
// JSON that allows reads from a web page (verified with CORS preflight checks, 2026-10-18), so the
// browser reads them directly: free, instant and never a JavaScript shell, (3) anything else goes
// to the AI provider's web fetch (lib/intake/analyze.ts), (4) otherwise she pastes the text.
// Workday's JSON endpoint sends no CORS headers, so Workday links are not read directly.
// Hosts used here must stay in the CSP connect-src list in next.config.js.

export type DirectSource = "greenhouse" | "lever" | "ashby" | "smartrecruiters";

export const SOURCE_LABEL: Record<DirectSource, string> = {
  greenhouse: "Greenhouse",
  lever: "Lever",
  ashby: "Ashby",
  smartrecruiters: "SmartRecruiters",
};

/** API hosts the direct readers call. next.config.js connect-src must list exactly these. */
export const DIRECT_API_HOSTS = ["https://boards-api.greenhouse.io", "https://api.lever.co", "https://api.eu.lever.co", "https://api.ashbyhq.com", "https://api.smartrecruiters.com"] as const;

export type LinkPlan =
  | { kind: "invalid"; message: string }
  /** A site she should not scrape or that we can't read: no request is made. */
  | { kind: "paste"; site: string; message: string; url: string }
  | { kind: "direct"; source: DirectSource; url: string; org: string; id: string; eu?: boolean }
  | { kind: "fetch"; url: string };

const PASTE = " Paste the description instead.";

// ---------------------------------------------------------------------------------------------
// Link cleanup

/** Hosts that wrap the real link in a query parameter: [host, path prefix, parameter]. */
const REDIRECTORS: [RegExp, RegExp, string][] = [
  [/(^|\.)google\.[a-z.]+$/, /^\/url$/, "q"],
  [/(^|\.)google\.[a-z.]+$/, /^\/url$/, "url"],
  [/^l\.facebook\.com$/, /^\/l\.php$/, "u"],
  [/^l\.instagram\.com$/, /^\/$/, "u"],
  [/(^|\.)linkedin\.com$/, /^\/(safety\/go|redir\/redirect)\/?$/, "url"],
  [/(^|\.)safelinks\.protection\.outlook\.com$/, /./, "url"],
  [/^t\.co$/, /^\/$/, "url"],
  [/^click\.linksynergy\.com$/, /./, "murl"],
];

/** Follows wrapper links ("google.com/url?q=...") to the real address. Leaves other links alone. */
export function unwrapRedirect(raw: string): string {
  let current = raw.trim();
  for (let i = 0; i < 3; i++) {
    let url: URL;
    try {
      url = new URL(/^https?:\/\//i.test(current) ? current : `https://${current}`);
    } catch {
      return current;
    }
    const host = url.hostname.toLowerCase();
    let next: string | null = null;
    for (const [hostRe, pathRe, param] of REDIRECTORS) {
      if (!hostRe.test(host) || !pathRe.test(url.pathname)) continue;
      const target = url.searchParams.get(param);
      if (target && /^https?:\/\//i.test(target)) {
        next = target;
        break;
      }
    }
    if (!next) return current;
    current = next;
  }
  return current;
}

/** Job boards that block automated reading, or whose pages need a login. */
const BOARDS: { re: RegExp; site: string; tip: string }[] = [
  { re: /(^|\.)linkedin\.com$|^lnkd\.in$/, site: "LinkedIn", tip: "LinkedIn needs a login, so the app doesn't read it." },
  { re: /(^|\.)indeed\.[a-z.]+$/, site: "Indeed", tip: "Indeed blocks automated reading." },
  { re: /(^|\.)glassdoor\.[a-z.]+$/, site: "Glassdoor", tip: "Glassdoor needs a login, so the app doesn't read it." },
  { re: /(^|\.)jobright\.ai$/, site: "Jobright", tip: "Jobright isn't read by the app." },
];

/** Whether a hostname is a board the app never reads (LinkedIn, Indeed, Glassdoor, Jobright). */
export function isBlockedBoardHost(host: string): boolean {
  const h = host.toLowerCase().replace(/\.$/, "");
  return BOARDS.some((b) => b.re.test(h));
}

/** Career sites that build the page with JavaScript, so no link reader can see the posting. */
const SCRIPT_ONLY: { re: RegExp; site: string }[] = [
  { re: /\.myworkdayjobs\.com$|\.myworkdaysite\.com$/, site: "Workday" },
  { re: /^jobs\.apple\.com$/, site: "Apple" },
];

const strip = (s: string) => s.replace(/\/+$/, "");

/** Decides how to read a link. Pure. */
export function planLink(raw: string): LinkPlan {
  const cleaned = unwrapRedirect(raw);
  if (/\s/.test(cleaned.trim()) || (/^[a-z][a-z0-9+.-]*:\/\//i.test(cleaned) && !/^https?:\/\//i.test(cleaned))) return { kind: "invalid", message: "Enter the job posting's full link, starting with https://" };
  let url: URL;
  try {
    url = new URL(/^https?:\/\//i.test(cleaned) ? cleaned : `https://${cleaned}`);
  } catch {
    return { kind: "invalid", message: "Enter the job posting's full link, starting with https://" };
  }
  if (!/^https?:$/.test(url.protocol)) return { kind: "invalid", message: "Enter the job posting's full link, starting with https://" };
  const host = url.hostname.toLowerCase();
  const parts = url.pathname.split("/").filter(Boolean).map((p) => decodeURIComponent(p));
  const href = url.toString();

  for (const b of BOARDS) {
    if (b.re.test(host)) {
      return {
        kind: "paste",
        site: b.site,
        url: href,
        message: `${b.tip} Open the posting on the company's own careers page and use that link, or paste the description.`,
      };
    }
  }
  for (const s of SCRIPT_ONLY) {
    if (s.re.test(host)) {
      return { kind: "paste", site: s.site, url: href, message: `${s.site} pages load with JavaScript, so the app can't read them.${PASTE}` };
    }
  }

  // Greenhouse: boards.greenhouse.io/{board}/jobs/{id}, job-boards.greenhouse.io/..., and the embed form.
  if (/^(boards|job-boards)\.greenhouse\.io$/.test(host)) {
    const q = url.searchParams;
    const embedBoard = q.get("for");
    const embedId = q.get("token") || q.get("gh_jid");
    if (parts[0] === "embed" && embedBoard && embedId && /^\d+$/.test(embedId)) {
      return { kind: "direct", source: "greenhouse", url: href, org: embedBoard, id: embedId };
    }
    const i = parts.indexOf("jobs");
    if (parts[0] && i === 1 && /^\d+$/.test(parts[2] ?? "")) return { kind: "direct", source: "greenhouse", url: href, org: parts[0], id: parts[2] };
    const ghJid = q.get("gh_jid");
    if (parts[0] && ghJid && /^\d+$/.test(ghJid)) return { kind: "direct", source: "greenhouse", url: href, org: parts[0], id: ghJid };
  }

  // Lever: jobs.lever.co/{company}/{uuid}[/apply] (jobs.eu.lever.co for the EU data center).
  if (/^jobs(\.eu)?\.lever\.co$/.test(host) && parts[0] && /^[0-9a-f-]{36}$/i.test(parts[1] ?? "")) {
    return { kind: "direct", source: "lever", url: href, org: parts[0], id: parts[1].toLowerCase(), eu: host.includes(".eu.") };
  }

  // Ashby: jobs.ashbyhq.com/{org}/{uuid}[/application]
  if (host === "jobs.ashbyhq.com" && parts[0] && /^[0-9a-f-]{36}$/i.test(parts[1] ?? "")) {
    return { kind: "direct", source: "ashby", url: href, org: parts[0], id: parts[1].toLowerCase() };
  }

  // SmartRecruiters: jobs.smartrecruiters.com/{Company}/{numeric id}-{slug}
  if (/^(jobs|careers)\.smartrecruiters\.com$/.test(host) && parts[0]) {
    const m = /^(\d{6,})(?:-|$)/.exec(parts[1] ?? "");
    if (m) return { kind: "direct", source: "smartrecruiters", url: href, org: parts[0], id: m[1] };
  }

  return { kind: "fetch", url: href };
}

/** A link in its canonical form for comparing postings: redirects unwrapped, /apply suffixes removed. */
export function canonicalPostingUrl(raw: string): string {
  const plan = planLink(raw);
  if (plan.kind === "direct") {
    switch (plan.source) {
      case "greenhouse":
        return `job-boards.greenhouse.io/${plan.org.toLowerCase()}/jobs/${plan.id}`;
      case "lever":
        return `jobs.lever.co/${plan.org.toLowerCase()}/${plan.id}`;
      case "ashby":
        return `jobs.ashbyhq.com/${plan.org.toLowerCase()}/${plan.id}`;
      case "smartrecruiters":
        return `jobs.smartrecruiters.com/${plan.org.toLowerCase()}/${plan.id}`;
    }
  }
  return "";
}

// ---------------------------------------------------------------------------------------------
// HTML to text

const ENTITIES: Record<string, string> = { amp: "&", lt: "<", gt: ">", quot: '"', apos: "'", nbsp: " ", ndash: "-", mdash: "-", rsquo: "'", lsquo: "'", rdquo: '"', ldquo: '"', hellip: "...", bull: "-" };

function decodeEntities(s: string): string {
  return s.replace(/&(#x[0-9a-f]+|#\d+|[a-z]+);/gi, (m, e: string) => {
    if (e[0] === "#") {
      const code = e[1].toLowerCase() === "x" ? parseInt(e.slice(2), 16) : parseInt(e.slice(1), 10);
      return Number.isFinite(code) && code > 0 && code < 0x110000 ? String.fromCodePoint(code) : m;
    }
    return ENTITIES[e.toLowerCase()] ?? m;
  });
}

/** Posting HTML as plain text with paragraph and list breaks kept. Never builds DOM, so nothing in it can run. */
export function htmlToText(input: string): string {
  // Greenhouse sends its HTML entity-escaped ("&lt;p&gt;"): unescape first, so the tags can be removed.
  // JSON-LD descriptions are often escaped, or escaped twice inside real tags: if any escaped tag is
  // present, decode first so every tag can be removed.
  const html = /<[a-z!/]/i.test(input) && !/&lt;\/?[a-z!]/i.test(input) ? input : decodeEntities(input);
  return decodeEntities(
    html
      .replace(/<(script|style)[\s\S]*?<\/\1>/gi, "")
      .replace(/<li[^>]*>/gi, "\n- ")
      .replace(/<\/(p|div|h[1-6]|ul|ol|tr|section)>|<br\s*\/?>/gi, "\n")
      .replace(/<[^>]+>/g, ""),
  )
    .replace(/[ \t ]+/g, " ")
    .replace(/ *\n */g, "\n")
    .replace(/\n{3,}/g, "\n\n")
    .trim();
}

// ---------------------------------------------------------------------------------------------
// Direct readers

export interface DirectPosting {
  source: DirectSource;
  text: string;
}

type FetchLike = (input: string, init?: { signal?: AbortSignal }) => Promise<{ ok: boolean; status: number; json(): Promise<unknown> }>;

const field = (o: unknown, key: string): unknown => (o && typeof o === "object" ? (o as Record<string, unknown>)[key] : undefined);
const str = (v: unknown): string => (typeof v === "string" ? v : "");

function compose(head: (string | undefined)[], body: string[]): string {
  const top = head.map((h) => (h ?? "").trim()).filter(Boolean).join("\n");
  return [top, ...body.map((b) => b.trim()).filter(Boolean)].join("\n\n");
}

/** Plain text of a posting from each ATS's JSON. Exported for tests. */
export function postingText(source: DirectSource, data: unknown): string {
  switch (source) {
    case "greenhouse":
      return compose(
        [str(field(data, "title")), str(field(data, "company_name")), str(field(field(data, "location"), "name"))],
        [htmlToText(str(field(data, "content")))],
      );
    case "lever": {
      const lists = Array.isArray(field(data, "lists")) ? (field(data, "lists") as unknown[]) : [];
      const cats = field(data, "categories");
      return compose(
        [str(field(data, "text")), str(field(cats, "team")), str(field(cats, "location")), str(field(data, "workplaceType"))],
        [
          str(field(data, "descriptionPlain")) || htmlToText(str(field(data, "description"))),
          ...lists.map((l) => `${str(field(l, "text"))}\n${htmlToText(str(field(l, "content")))}`),
          str(field(data, "additionalPlain")) || htmlToText(str(field(data, "additional"))),
        ],
      );
    }
    case "ashby":
      return compose(
        [str(field(data, "title")), str(field(data, "location")), field(data, "isRemote") === true ? "Remote" : "", str(field(data, "workplaceType"))],
        [str(field(data, "descriptionPlain")) || htmlToText(str(field(data, "descriptionHtml")))],
      );
    case "smartrecruiters": {
      const sections = field(field(data, "jobAd"), "sections");
      const order = ["companyDescription", "jobDescription", "qualifications", "additionalInformation"];
      const bodies = order.map((k) => {
        const s = field(sections, k);
        const title = str(field(s, "title"));
        const text = htmlToText(str(field(s, "text")));
        return text ? (title ? `${title}\n${text}` : text) : "";
      });
      return compose([str(field(data, "name")), str(field(field(data, "company"), "name")), str(field(field(data, "location"), "fullLocation"))], bodies);
    }
  }
}

const CLOSED = (label: string) =>
  `${label} says this posting is no longer listed, so it may be closed. If it's still open, paste the description.`;

/** A request that gives up after a few seconds, so a stalled API falls through to the next step. */
function withTimeout(ms: number): AbortSignal | undefined {
  return typeof AbortSignal !== "undefined" && "timeout" in AbortSignal ? AbortSignal.timeout(ms) : undefined;
}

async function getJson(fetchImpl: FetchLike, url: string): Promise<{ status: number; data: unknown } | null> {
  try {
    const res = await fetchImpl(url, { signal: withTimeout(10_000) });
    if (res.status === 404) return { status: 404, data: null };
    if (!res.ok) return null;
    return { status: res.status, data: await res.json() };
  } catch {
    // Network error, blocked by an extension, or not JSON: the next step in the chain decides.
    return null;
  }
}

/** Fewest words a direct posting must have to count as a real description. */
const MIN_DIRECT_WORDS = 40;

/**
 * Reads a posting from its ATS's public API. Returns null when that can't be done (network,
 * server error, unexpected shape): the caller moves on to the next way of reading it. Throws
 * AIError "fetch_failed" only when the ATS confirms the posting no longer exists.
 */
export async function readDirectPosting(plan: Extract<LinkPlan, { kind: "direct" }>, fetchImpl: FetchLike = (u, i) => fetch(u, i)): Promise<DirectPosting | null> {
  const { source, org, id } = plan;
  const label = SOURCE_LABEL[source];
  const enc = encodeURIComponent;
  let res: { status: number; data: unknown } | null;
  let data: unknown;

  switch (source) {
    case "greenhouse":
      res = await getJson(fetchImpl, `https://boards-api.greenhouse.io/v1/boards/${enc(org)}/jobs/${enc(id)}`);
      data = res?.data;
      break;
    case "lever": {
      const host = plan.eu ? "api.eu.lever.co" : "api.lever.co";
      res = await getJson(fetchImpl, `https://${host}/v0/postings/${enc(org)}/${enc(id)}`);
      data = res?.data;
      break;
    }
    case "ashby": {
      res = await getJson(fetchImpl, `https://api.ashbyhq.com/posting-api/job-board/${enc(org)}`);
      const jobs = field(res?.data, "jobs");
      if (res && res.status !== 404 && Array.isArray(jobs)) {
        data = jobs.find((j) => str(field(j, "id")).toLowerCase() === id);
        if (!data) throw new AIError("fetch_failed", CLOSED(label));
      }
      break;
    }
    case "smartrecruiters":
      res = await getJson(fetchImpl, `https://api.smartrecruiters.com/v1/companies/${enc(org)}/postings/${enc(id)}`);
      data = res?.data;
      break;
  }

  if (!res) return null;
  if (res.status === 404) throw new AIError("fetch_failed", CLOSED(label));
  if (!data || typeof data !== "object") return null;
  const text = postingText(source, data);
  if (text.split(/\s+/).filter(Boolean).length < MIN_DIRECT_WORDS) return null;
  return { source, text };
}
