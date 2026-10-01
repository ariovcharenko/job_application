import { createRequire } from "node:module";
import { describe, expect, it } from "vitest";

// next.config.js is CommonJS (Next loads it directly), so load it the same way.
const require = createRequire(import.meta.url);
type Header = { key: string; value: string };
type NextConfigFn = ((phase: string) => { headers: () => Promise<{ source: string; headers: Header[] }[]> }) & {
  buildCsp: (dev: boolean) => string;
};
const config = require("../next.config.js") as NextConfigFn;

async function headersFor(phase: string) {
  const rules = await config(phase).headers();
  expect(rules).toHaveLength(1);
  expect(rules[0].source).toBe("/:path*");
  return Object.fromEntries(rules[0].headers.map((h) => [h.key, h.value]));
}

const directives = (csp: string) =>
  Object.fromEntries(
    csp.split(";").map((d) => {
      const [name, ...values] = d.trim().split(/\s+/);
      return [name, values];
    }),
  );

describe("security headers", () => {
  it("production CSP only talks to this site and Anthropic, with no eval", async () => {
    const h = await headersFor("phase-production-server");
    const csp = directives(h["Content-Security-Policy"]);
    expect(csp["default-src"]).toEqual(["'self'"]);
    expect(csp["connect-src"]).toEqual(["'self'", "https://api.anthropic.com"]);
    expect(csp["script-src"]).not.toContain("'unsafe-eval'");
    expect(csp["script-src"].filter((s: string) => s.startsWith("http"))).toEqual([]);
    expect(csp["img-src"]).toEqual(["'self'", "data:", "blob:"]);
    expect(csp["frame-src"]).toContain("blob:");
    expect(csp["frame-ancestors"]).toEqual(["'none'"]);
    expect(csp["object-src"]).toEqual(["blob:"]);
    expect(csp["base-uri"]).toEqual(["'self'"]);
    expect(csp["form-action"]).toEqual(["'self'"]);
  });

  it("dev server gets eval and the hot-reload websocket, production doesn't", async () => {
    const dev = directives((await headersFor("phase-development-server"))["Content-Security-Policy"]);
    expect(dev["script-src"]).toContain("'unsafe-eval'");
    expect(dev["connect-src"]).toContain("ws:");
    const prod = directives(config.buildCsp(false));
    expect(prod["connect-src"]).not.toContain("ws:");
  });

  it("sets the other hardening headers", async () => {
    const h = await headersFor("phase-production-build");
    expect(h["Referrer-Policy"]).toBe("no-referrer");
    expect(h["X-Content-Type-Options"]).toBe("nosniff");
    expect(h["X-Frame-Options"]).toBe("DENY");
    for (const feature of ["camera", "microphone", "geolocation"]) {
      expect(h["Permissions-Policy"]).toContain(`${feature}=()`);
    }
  });
});
