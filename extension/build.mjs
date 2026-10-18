// Bundles each extension entry point with esbuild, then copies manifest.json + the HTML pages +
// icons into dist/. No framework: content scripts and the popup are plain DOM/TS, kept small.
// Content scripts are classic scripts in Chrome (not modules), so they're built as IIFEs.
import { cp, mkdir } from "node:fs/promises";
import { existsSync } from "node:fs";
import esbuild from "esbuild";

const watch = process.argv.includes("--watch");

const common = { outdir: "dist", bundle: true, target: "chrome110", sourcemap: true, logLevel: "info" };
const builds = [
  { ...common, entryPoints: { background: "src/background.ts", popup: "src/popup.ts", pair: "src/pair.ts" }, format: "esm" },
  { ...common, entryPoints: { "content/capture": "src/content/capture.ts" }, format: "iife" },
];

async function copyStatic() {
  await cp("manifest.json", "dist/manifest.json");
  for (const page of ["popup.html", "pair.html", "privacy.html"]) await cp(page, `dist/${page}`);
  if (existsSync("icons")) await cp("icons", "dist/icons", { recursive: true });
}

async function build() {
  await mkdir("dist", { recursive: true });
  const contexts = await Promise.all(builds.map((b) => esbuild.context(b)));
  if (watch) {
    await Promise.all(contexts.map((c) => c.watch()));
    await copyStatic();
    console.log("Watching for changes...");
    return;
  }
  await Promise.all(contexts.map((c) => c.rebuild()));
  await Promise.all(contexts.map((c) => c.dispose()));
  await copyStatic();
}

build().catch((err) => {
  console.error(err);
  process.exit(1);
});
