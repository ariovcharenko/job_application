import { defineConfig } from "vitest/config";
import { configDefaults } from "vitest/config";

export default defineConfig({
  test: {
    environment: "node",
    setupFiles: ["./vitest.setup.ts"],
    // The Chrome extension (extension/) is a separate package with its own vitest config
    // (jsdom environment, DOM-heavy tests) — exclude it here so it isn't picked up twice.
    exclude: [...configDefaults.exclude, "extension/**", ".claude/**"],
  },
});
