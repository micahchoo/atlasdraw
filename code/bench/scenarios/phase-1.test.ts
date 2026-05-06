// SPDX-License-Identifier: MIT
// Phase 1 baseline bench — pure parse + homogeneity check timings.
//
// Deliberately uses describe + it (not vitest's `bench`) so we control the
// loop ourselves and emit a single deterministic JSON artifact at the end.
// `bench` mode targets micro-benchmark stats with hidden warmup loops; we
// want a small, reproducible, auditable timing record.

import { describe, expect, it } from "vitest";
import { mkdir, writeFile } from "node:fs/promises";
import { dirname, resolve } from "node:path";
import { fileURLToPath } from "node:url";
import { performance } from "node:perf_hooks";
import { platform, version as nodeVersion } from "node:process";

import {
  parse,
  requireHomogeneousGeometry,
} from "@atlasdraw/data";

import { synthPointFC } from "../fixtures/synth.js";

interface ScenarioResult {
  label: string;
  iterations: number;
  mean_ms: number;
  p95_ms: number;
  p99_ms: number;
}

const WARMUP = 3;
const ITERS = 20;

function percentile(sorted: number[], p: number): number {
  if (sorted.length === 0) return 0;
  const idx = Math.min(
    sorted.length - 1,
    Math.max(0, Math.ceil((p / 100) * sorted.length) - 1),
  );
  return sorted[idx];
}

async function timeIt(
  label: string,
  setup: () => Blob,
  body: (blob: Blob) => Promise<void>,
): Promise<ScenarioResult> {
  // Warmup — discard.
  for (let i = 0; i < WARMUP; i++) {
    const blob = setup();
    await body(blob);
  }
  const samples: number[] = [];
  for (let i = 0; i < ITERS; i++) {
    const blob = setup();
    const t0 = performance.now();
    await body(blob);
    samples.push(performance.now() - t0);
  }
  samples.sort((a, b) => a - b);
  const mean = samples.reduce((s, v) => s + v, 0) / samples.length;
  return {
    label,
    iterations: ITERS,
    mean_ms: round(mean),
    p95_ms: round(percentile(samples, 95)),
    p99_ms: round(percentile(samples, 99)),
  };
}

function round(n: number): number {
  return Math.round(n * 1000) / 1000;
}

function fcBlob(n: number): Blob {
  const fc = synthPointFC(n);
  return new Blob([JSON.stringify(fc)], { type: "application/geo+json" });
}

describe("phase-1 baseline", () => {
  it("captures parse and validation timings into bench/results", async () => {
    const scenarios: ScenarioResult[] = [];

    scenarios.push(
      await timeIt(
        "parse 1k points",
        () => fcBlob(1_000),
        async (blob) => {
          await parse(blob);
        },
      ),
    );

    scenarios.push(
      await timeIt(
        "parse 10k points",
        () => fcBlob(10_000),
        async (blob) => {
          await parse(blob);
        },
      ),
    );

    scenarios.push(
      await timeIt(
        "parse + requireHomogeneousGeometry 10k points",
        () => fcBlob(10_000),
        async (blob) => {
          const fc = await parse(blob);
          requireHomogeneousGeometry(fc);
        },
      ),
    );

    expect(scenarios.length).toBeGreaterThan(0);

    const here = dirname(fileURLToPath(import.meta.url));
    // scenarios/ -> bench/ root, then results/phase-1-baseline.json
    const out = resolve(here, "..", "results", "phase-1-baseline.json");
    await mkdir(dirname(out), { recursive: true });

    const payload = {
      runAt: new Date().toISOString(),
      node: nodeVersion,
      platform,
      warmup: WARMUP,
      iterations: ITERS,
      scenarios,
    };
    await writeFile(out, JSON.stringify(payload, null, 2) + "\n", "utf8");

    // Surface the result in the test output so a human reading the run
    // can sanity-check timings without opening the file.
    // eslint-disable-next-line no-console
    console.log("[bench] wrote", out);
    // eslint-disable-next-line no-console
    console.log(JSON.stringify(scenarios, null, 2));
  });
});
