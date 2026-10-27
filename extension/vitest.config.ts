import { fileURLToPath } from "node:url";
import { defineConfig } from "vitest/config";

// Vitest resolves relative setupFiles paths against a discovered workspace root, not this
// config's own directory, which picks up the parent app's node_modules/root in this nested
// package layout — so this uses an absolute path instead.
// An inline (empty) PostCSS config stops Vite from searching upward and loading the parent app's
// postcss.config.js, which needs tailwindcss: not installed in CI, where only this package is.
export default defineConfig({
  css: { postcss: {} },
  test: {
    environment: "jsdom",
    setupFiles: [fileURLToPath(new URL("./vitest.setup.ts", import.meta.url))],
  },
});
