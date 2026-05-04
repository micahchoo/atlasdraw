// packages/geo/bench/vitest.config.ts
// Bench-only vitest config — picks up `*.bench.ts` files which the default
// test config (parent vitest.config.ts) does NOT match. Used by the
// `yarn workspace @atlasdraw/geo run bench` script.
import { defineConfig } from "vitest/config";

export default defineConfig({
  test: {
    globals: true,
    environment: "node",
    include: ["bench/**/*.bench.ts"],
    // Bench iterations are deliberately CPU-bound; give it room.
    testTimeout: 60_000,
  },
});
