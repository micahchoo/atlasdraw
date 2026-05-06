import { defineConfig } from "vitest/config";

// Local config: keeps the @atlasdraw/cli test run from being captured by the
// monorepo-root vitest.config.mts (which assumes excalidraw-app's setupTests).
export default defineConfig({
  test: {
    globals: true,
    environment: "node",
  },
});
