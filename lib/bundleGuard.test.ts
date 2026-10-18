import { existsSync, readFileSync, statSync } from "node:fs";
import path from "node:path";
import { fileURLToPath } from "node:url";
import { describe, expect, it } from "vitest";

// The home page used to ship the .docx writer, JSZip and the Anthropic SDK (~300 kB gzipped)
// before any click, through static imports of the dialogs. Those now load with next/dynamic or
// import(). This walks the static import graph (type-only imports and dynamic imports don't
// count) and fails if one of the heavy packages becomes reachable again.

const ROOT = path.resolve(path.dirname(fileURLToPath(import.meta.url)), "..");
const HEAVY = ["jszip", "docx", "docx-preview", "@anthropic-ai/sdk", "pdfjs-dist"];

function resolve(from: string, spec: string): string | null {
  let base: string;
  if (spec.startsWith("@/")) base = path.join(ROOT, spec.slice(2));
  else if (spec.startsWith(".")) base = path.join(path.dirname(from), spec);
  else return `pkg:${spec}`;
  for (const ext of [".ts", ".tsx", "/index.ts", "/index.tsx", ""]) {
    const f = base + ext;
    if (existsSync(f) && statSync(f).isFile()) return f;
  }
  return null;
}

/** Each reachable module mapped to the module that imported it. */
function staticGraph(entries: string[]): Map<string, string | null> {
  const parent = new Map<string, string | null>();
  const queue = entries.map((e) => path.join(ROOT, e));
  for (const e of queue) parent.set(e, null);
  const re = /^\s*(?:import|export)\s+(?!type\b)[^;]*?from\s+["']([^"']+)["']|^\s*import\s+["']([^"']+)["']/gm;
  while (queue.length) {
    const f = queue.shift()!;
    if (f.startsWith("pkg:")) continue;
    const src = readFileSync(f, "utf8");
    for (const m of src.matchAll(re)) {
      const r = resolve(f, m[1] ?? m[2]);
      if (!r || parent.has(r)) continue;
      parent.set(r, f);
      queue.push(r);
    }
  }
  return parent;
}

function heavyChains(entries: string[]): string[] {
  const parent = staticGraph(entries);
  const out: string[] = [];
  for (const k of parent.keys()) {
    if (!HEAVY.some((p) => k === `pkg:${p}` || k.startsWith(`pkg:${p}/`))) continue;
    const chain: string[] = [];
    for (let c: string | null | undefined = k; c; c = parent.get(c)) chain.push(c.replace(`${ROOT}/`, ""));
    out.push(chain.reverse().join(" -> "));
  }
  return out;
}

describe("home page bundle", () => {
  it("doesn't statically import the .docx writer, JSZip or the Anthropic SDK", () => {
    expect(heavyChains(["app/layout.tsx", "app/page.tsx"])).toEqual([]);
  });
});
