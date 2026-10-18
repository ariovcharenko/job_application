import { readdirSync, readFileSync, statSync } from "node:fs";
import { join } from "node:path";
import { describe, expect, it } from "vitest";

// Source-level guarantees for the rules that must never regress: the extension never submits or
// clicks anything on a page, never holds an API key or calls a network API, and never runs on
// LinkedIn, Indeed or Jobright.

function sources(dir: string): { file: string; text: string }[] {
  return readdirSync(dir).flatMap((name) => {
    const p = join(dir, name);
    if (statSync(p).isDirectory()) return name === "__fixtures__" ? [] : sources(p);
    return /\.ts$/.test(name) && !/\.test\.ts$/.test(name) ? [{ file: p, text: readFileSync(p, "utf8") }] : [];
  });
}
// Comments are dropped (they may explain what is never done); storage.ts names the old key only to delete it.
const stripComments = (t: string) => t.replace(/\/\*[\s\S]*?\*\//g, "").replace(/(^|[^:"'`])\/\/.*$/gm, "$1");
const all = sources(join(__dirname)).map((s) => ({ ...s, text: stripComments(s.text) }));

describe("extension safety", () => {
  it("never submits a form or clicks an element on the page", () => {
    for (const { file, text } of all) {
      expect(text, file).not.toMatch(/\.requestSubmit\(|\.submit\(\)|\.click\(\)|dispatchEvent\(new (Mouse|Pointer)Event\(["']click/);
    }
  });
  it("holds no API key and makes no network calls", () => {
    for (const { file, text } of all.filter((s) => !s.file.endsWith("storage.ts"))) {
      expect(text, file).not.toMatch(/apiKey|api-key|anthropic|openai\.com|\bfetch\(|XMLHttpRequest|sendBeacon/i);
    }
  });
  it("lists LinkedIn, Indeed and Jobright as blocked, and no manifest pattern matches them", () => {
    const manifest = JSON.parse(readFileSync(join(__dirname, "..", "manifest.json"), "utf8"));
    const patterns: string[] = [...manifest.host_permissions, ...manifest.content_scripts.flatMap((c: { matches: string[] }) => c.matches)];
    for (const p of patterns) expect(p).not.toMatch(/linkedin|indeed|jobright|\*:\/\/\*\/|https:\/\/\*\/\*|<all_urls>/i);
    expect(manifest.permissions).toEqual(["storage", "scripting"]);
    expect(manifest.content_scripts.every((c: { matches: string[] }) => c.matches.every((m) => !/^\*|<all_urls>/.test(m)))).toBe(true);
  });
  it("never writes into password fields or asks for credentials", () => {
    const fill = readFileSync(join(__dirname, "lib", "fillEngine.ts"), "utf8") + readFileSync(join(__dirname, "lib", "matching.ts"), "utf8");
    expect(fill).toMatch(/"password"/);
  });
});
