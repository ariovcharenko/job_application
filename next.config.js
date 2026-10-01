const { PHASE_DEVELOPMENT_SERVER } = require("next/constants");

/**
 * Security headers for every route. The app has no backend: the browser talks to this site (static
 * files) and to api.anthropic.com with the user's own key, and nothing else. Verified against a
 * production build (`next build && next start`).
 *
 * Why 'unsafe-inline' for scripts: Next.js 14's App Router writes the page's React Server Component
 * payload into inline `<script>self.__next_f.push(...)</script>` tags on every page. The only
 * alternatives are a per-request nonce (needs middleware, turns every static page into a
 * server-rendered one, and has broken static export/caching) or hashes (change on every build and
 * every page). The risk 'unsafe-inline' leaves is injected markup, and this app never renders
 * untrusted HTML: posting text is shown as text, and the resume preview HTML is fully escaped
 * (lib/resume/engine/html.ts). Everything else stays locked down: no eval, no third-party scripts,
 * no plugins, no framing, and connections only to this site and Anthropic.
 *
 * If the job Feed (FEATURES.jobFeed) is turned back on, add https://jsearch.p.rapidapi.com to
 * connect-src or its searches will be blocked.
 */
function buildCsp(dev) {
  const directives = {
    "default-src": ["'self'"],
    // Dev only: React Refresh needs eval.
    "script-src": ["'self'", "'unsafe-inline'", ...(dev ? ["'unsafe-eval'"] : [])],
    // Next.js and next/font inject <style> tags and style attributes.
    "style-src": ["'self'", "'unsafe-inline'"],
    "img-src": ["'self'", "data:", "blob:"],
    "font-src": ["'self'", "data:"],
    // Dev only: hot reload uses a websocket back to the dev server.
    "connect-src": ["'self'", "https://api.anthropic.com", ...(dev ? ["ws:", "wss:"] : [])],
    // Resume PDFs are previewed from a blob: URL in an iframe.
    "frame-src": ["'self'", "blob:"],
    "worker-src": ["'self'", "blob:"],
    // Chrome shows a PDF in an iframe with its built-in viewer, which object-src governs; the resume
    // import previews PDFs from blob: URLs. Every other plugin source stays blocked.
    "object-src": ["blob:"],
    "base-uri": ["'self'"],
    "form-action": ["'self'"],
    "frame-ancestors": ["'none'"],
  };
  return Object.entries(directives)
    .map(([k, v]) => `${k} ${v.join(" ")}`)
    .join("; ");
}

function securityHeaders(dev) {
  return [
    { key: "Content-Security-Policy", value: buildCsp(dev) },
    { key: "Referrer-Policy", value: "no-referrer" },
    { key: "X-Content-Type-Options", value: "nosniff" },
    // Older browsers that don't read frame-ancestors.
    { key: "X-Frame-Options", value: "DENY" },
    { key: "Cross-Origin-Opener-Policy", value: "same-origin" },
    {
      key: "Permissions-Policy",
      value: [
        "camera=()",
        "microphone=()",
        "geolocation=()",
        "payment=()",
        "usb=()",
        "serial=()",
        "hid=()",
        "bluetooth=()",
        "midi=()",
        "magnetometer=()",
        "gyroscope=()",
        "accelerometer=()",
        "display-capture=()",
        "browsing-topics=()",
      ].join(", "),
    },
  ];
}

/** @type {(phase: string) => import('next').NextConfig} */
module.exports = (phase) => {
  const dev = phase === PHASE_DEVELOPMENT_SERVER;
  return {
    poweredByHeader: false,
    async headers() {
      return [{ source: "/:path*", headers: securityHeaders(dev) }];
    },
  };
};

module.exports.buildCsp = buildCsp;
