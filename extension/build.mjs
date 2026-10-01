// Bundles each extension entry point with esbuild, then copies manifest.json + popup.html +
// icons into dist/. No framework — content scripts and the popup are plain DOM/TS, kept small.
import { cp, mkdir } from "node:fs/promises";
import { existsSync } from "node:fs";
import esbuild from "esbuild";

const watch = process.argv.includes("--watch");

const entryPoints = {
  background: "src/background.ts",
  "content/capture": "src/content/capture.ts",
  "content/bridge": "src/content/bridge.ts",
  popup: "src/popup.ts",
};

async function build() {
  await mkdir("dist", { recursive: true });
  const ctx = await esbuild.context({
    entryPoints,
    outdir: "dist",
    bundle: true,
    format: "esm",
    target: "chrome110",
    sourcemap: true,
    logLevel: "info",
  });

  if (watch) {
    await ctx.watch();
    console.log("Watching for changes...");
  } else {
    await ctx.rebuild();
    await ctx.dispose();
  }

  await cp("manifest.json", "dist/manifest.json");
  await cp("popup.html", "dist/popup.html");
  if (existsSync("icons")) await cp("icons", "dist/icons", { recursive: true });
}

build().catch((err) => {
  console.error(err);
  process.exit(1);
});
