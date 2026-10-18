// Where the extension runs. By default only on known applicant tracking systems (manifest.json
// host_permissions and content_scripts); any other site needs her explicit "Use on this site" in
// the popup, which asks Chrome for that one origin (optional_host_permissions).
//
// LinkedIn, Indeed and Jobright are never touched, even if she asks: the app's rule is no scraping
// or automation of those sites.

/** Known ATS hosts, as manifest match patterns. Keep in sync with manifest.json. */
export const ATS_MATCHES = [
  "https://*.greenhouse.io/*",
  "https://*.lever.co/*",
  "https://*.ashbyhq.com/*",
  "https://*.myworkdayjobs.com/*",
  "https://*.myworkdaysite.com/*",
] as const;

const BLOCKED = /(^|\.)(linkedin\.com|indeed\.com|indeed\.[a-z.]+|jobright\.ai)$/i;

/** True for LinkedIn, Indeed (any country site) and Jobright, including their subdomains. */
export function isBlockedHost(hostname: string): boolean {
  return BLOCKED.test(hostname.trim().replace(/\.$/, ""));
}

const ATS_HOST = /(^|\.)(greenhouse\.io|lever\.co|ashbyhq\.com|myworkdayjobs\.com|myworkdaysite\.com)$/i;

export function isKnownAtsHost(hostname: string): boolean {
  return ATS_HOST.test(hostname);
}

/**
 * The permission pattern for "Use on this site": the page's own origin only (never a wildcard over
 * every site), or null for pages it must not run on (blocked hosts, non-web schemes).
 */
export function originPatternFor(url: string): string | null {
  let u: URL;
  try {
    u = new URL(url);
  } catch {
    return null;
  }
  if (u.protocol !== "https:" && u.protocol !== "http:") return null;
  if (isBlockedHost(u.hostname)) return null;
  return `${u.protocol}//${u.hostname}/*`;
}
