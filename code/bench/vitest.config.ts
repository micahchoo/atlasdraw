import { defineConfig } from "vitest/config";

// Phase 2 bench harness — pure-Node, no jsdom. Long timeout because each
// scenario runs a warmup + N iteration loop.
export default defineConfig({
  test: {
    globals: true,
    environment: "node",
    include: ["scenarios/**/*.test.ts"],
    testTimeout: 60_000,
    hookTimeout: 60_000,
  },
});
