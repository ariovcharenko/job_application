// Writes the static logo files from lib/brand.ts:
//   app/icon.svg        favicon (small, pixel-snapped drawing; browsers use it at 16 and 32px)
//   app/apple-icon.png  180x180 Apple touch icon (detailed drawing, full-bleed: iOS rounds it)
//
//   npx vite-node scripts/build-icons.ts
//
// PNGs are rendered by headless Google Chrome (the same engine that shows the SVG in the app), with
// a timeout. Set CHROME=/path/to/chrome if it isn't in the default macOS location.

import { execFileSync } from "node:child_process";
import { mkdtempSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { logoSvg } from "../lib/brand";

const CHROME = process.env.CHROME ?? "/Applications/Google Chrome.app/Contents/MacOS/Google Chrome";
const root = join(__dirname, "..");

function renderPng(svg: string, px: number, out: string) {
  const dir = mkdtempSync(join(tmpdir(), "icon-"));
  const page = join(dir, "page.html");
  writeFileSync(page, `<!doctype html><html><body style="margin:0;background:transparent">${svg}</body></html>`);
  execFileSync(
    CHROME,
    [
      "--headless=new",
      "--disable-gpu",
      "--hide-scrollbars",
      "--force-device-scale-factor=1",
      "--default-background-color=00000000",
      `--user-data-dir=${join(dir, "profile")}`,
      `--window-size=${px},${px}`,
      `--screenshot=${out}`,
      `file://${page}`,
    ],
    { timeout: 60_000, stdio: "ignore" },
  );
}

writeFileSync(join(root, "app/icon.svg"), `${logoSvg("small", { standalone: true, px: 32, id: "i" })}\n`);
renderPng(logoSvg("detailed", { standalone: true, px: 180, fullBleed: true, id: "a" }), 180, join(root, "app/apple-icon.png"));

const extra = process.argv.indexOf("--preview");
if (extra >= 0) {
  // Extra renders for checking by eye, never committed.
  const dir = process.argv[extra + 1];
  for (const px of [16, 24, 32, 72, 180, 512]) {
    renderPng(logoSvg(px <= 32 ? "small" : "detailed", { standalone: true, px, id: `p${px}` }), px, join(dir, `logo-${px}.png`));
  }
}
console.log("Wrote app/icon.svg and app/apple-icon.png");
