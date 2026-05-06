// SPDX-License-Identifier: MIT
// Phase 2 bench — data-layers scenarios + Phase 1 regression re-run.
//
// Re-running Phase 1 labels with identical label strings lets ci-gate.ts
// compare this file's output against the baseline and catch regressions.

import { describe, expect, it } from "vitest";
import { mkdir, writeFile } from "node:fs/promises";
import { dirname, resolve } from "node:path";
import { fileURLToPath } from "node:url";
import { performance } from "node:perf_hooks";
import { platform, version as nodeVersion } from "node:process";

import { parse, requireHomogeneousGeometry } from "@atlasdraw/data";
import { isValidZRef } from "@atlasdraw/geo";
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

// 5k annotation objects with valid fractional zRef values in [0, 24).
function annotationsBlob(n: number): Blob {
  const items = Array.from({ length: n }, (_, i) => ({
    id: i,
    zRef: (i % 25) + ((i % 10) * 0.1),
  }));
  return new Blob([JSON.stringify(items)], { type: "application/json" });
}

describe("phase-2 with data layers", () => {
  it("captures phase-2 scenario timings into bench/results", async () => {
    const scenarios: ScenarioResult[] = [];

    // --- Phase 1 regression re-run (identical labels — ci-gate compares these) ---

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

    // --- Phase 2: data-layers scenarios ---

    scenarios.push(
      await timeIt(
        "parse + requireHomogeneousGeometry 50k points",
        () => fcBlob(50_000),
        async (blob) => {
          const fc = await parse(blob);
          requireHomogeneousGeometry(fc);
        },
      ),
    );

    scenarios.push(
      await timeIt(
        "validate 5k geo-anchored annotations",
        () => annotationsBlob(5_000),
        async (blob) => {
          const text = await blob.text();
          const items = JSON.parse(text) as Array<{ id: number; zRef: number }>;
          for (const item of items) {
            isValidZRef(item.zRef);
          }
        },
      ),
    );

    expect(scenarios.length).toBeGreaterThan(0);

    const here = dirname(fileURLToPath(import.meta.url));
    const out = resolve(
      here,
      "..",
      "results",
      "phase-2-with-data-layers.json",
    );
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

    // eslint-disable-next-line no-console
    console.log("[bench] wrote", out);
    // eslint-disable-next-line no-console
    console.log(JSON.stringify(scenarios, null, 2));
  });
});
