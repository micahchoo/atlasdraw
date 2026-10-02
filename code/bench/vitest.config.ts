import { defineConfig } from "vitest/config";

// Pure Node, no jsdom. Long timeouts: each scenario runs a warmup and a
// timed loop.
//
// BENCH_DATA_SRC (set by ab.ts) points @atlasdraw/data at another
// checkout's source, so the merge base is timed by this same harness.
export default defineConfig({
  resolve: process.env.BENCH_DATA_SRC
    ? { alias: { "@atlasdraw/data": process.env.BENCH_DATA_SRC } }
    : {},
  test: {
    globals: true,
    environment: "node",
    include: ["scenarios/**/*.test.ts", "gate.test.ts"],
    testTimeout: 120_000,
    hookTimeout: 60_000,
  },
});
