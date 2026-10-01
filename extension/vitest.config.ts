import { fileURLToPath } from "node:url";
import { defineConfig } from "vitest/config";

// Vitest resolves relative setupFiles paths against a discovered workspace root, not this
// config's own directory, which picks up the parent app's node_modules/root in this nested
// package layout — so this uses an absolute path instead.
export default defineConfig({
  test: {
    environment: "jsdom",
    setupFiles: [fileURLToPath(new URL("./vitest.setup.ts", import.meta.url))],
  },
});
