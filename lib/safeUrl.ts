/**
 * A user-typed link made safe for an <a href>: http(s) links pass through, a bare host
 * ("acme.com/jobs", "localhost:3000") gets https://, and any other scheme (javascript:, data:,
 * vbscript:) becomes "" so it is never rendered as a clickable link.
 */
export function safeHttpUrl(url: string): string {
  const u = url.trim();
  if (!u) return "";
  if (/^https?:\/\//i.test(u)) return u;
  const hasScheme = /^[a-z][a-z0-9+.-]*:/i.test(u);
  const isHostPort = /^[^/:\s]+:\d+(\/|$)/.test(u);
  if (hasScheme && !isHostPort) return "";
  return `https://${u}`;
}
