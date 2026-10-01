import { defineConfig } from "vitest/config";

// Local config: keeps the @atlasdraw/cli test run from being captured by the
// monorepo-root vitest.config.mts, whose jsdom setupTests.ts this package does
// not need.
export default defineConfig({
  test: {
    globals: true,
    environment: "node",
  },
});
