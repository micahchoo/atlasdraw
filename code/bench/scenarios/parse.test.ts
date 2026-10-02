// SPDX-License-Identifier: MIT
// Parse and validation timings for @atlasdraw/data.
//
// A plain test with its own loop, not vitest's `bench`: we want the raw
// samples of each scenario and one JSON file per run. ab.ts runs this file
// several times against the merge base and the head and compares medians.
//
//   BENCH_OUT       where the run's JSON goes (default results/current/parse.json)
//   BENCH_DATA_SRC  set by ab.ts: time another checkout's @atlasdraw/data
//                   (vitest.config.ts), with this same harness

import { mkdir, writeFile } from "node:fs/promises";
import { dirname, resolve } from "node:path";
import { fileURLToPath } from "node:url";
import { performance } from "node:perf_hooks";
import { platform, version as nodeVersion } from "node:process";

import { describe, expect, it } from "vitest";

import { parse, requireHomogeneousGeometry } from "@atlasdraw/data";

import { synthPointFC } from "../fixtures/synth.js";

export interface ScenarioResult {
  label: string;
  iterations: number;
  median_ms: number;
  p95_ms: number;
}

const WARMUP = 3;
const ITERS = 20;

function at(sorted: readonly number[], p: number): number {
  const idx = Math.min(
    sorted.length - 1,
    Math.max(0, Math.ceil((p / 100) * sorted.length) - 1),
  );
  return Math.round(sorted[idx] * 1000) / 1000;
}

async function timeIt(
  label: string,
  points: number,
  body: (blob: Blob) => Promise<void>,
): Promise<ScenarioResult> {
  const blob = () =>
    new Blob([JSON.stringify(synthPointFC(points))], {
      type: "application/geo+json",
    });
  for (let i = 0; i < WARMUP; i++) {
    await body(blob());
  }
  const samples: number[] = [];
  for (let i = 0; i < ITERS; i++) {
    const input = blob();
    const t0 = performance.now();
    await body(input);
    samples.push(performance.now() - t0);
  }
  samples.sort((a, b) => a - b);
  return {
    label,
    iterations: ITERS,
    median_ms: at(samples, 50),
    p95_ms: at(samples, 95),
  };
}

const parseOnly = async (blob: Blob) => {
  await parse(blob);
};
const parseAndCheck = async (blob: Blob) => {
  requireHomogeneousGeometry(await parse(blob));
};

describe("parse timings", () => {
  it("times each scenario and writes one JSON file", async () => {
    const scenarios = [
      await timeIt("parse 1k points", 1_000, parseOnly),
      await timeIt("parse 10k points", 10_000, parseOnly),
      await timeIt(
        "parse + requireHomogeneousGeometry 10k points",
        10_000,
        parseAndCheck,
      ),
      await timeIt(
        "parse + requireHomogeneousGeometry 50k points",
        50_000,
        parseAndCheck,
      ),
    ];
    expect(scenarios.every((s) => s.median_ms > 0)).toBe(true);

    const here = dirname(fileURLToPath(import.meta.url));
    const out =
      process.env.BENCH_OUT ??
      resolve(here, "..", "results", "current", "parse.json");
    await mkdir(dirname(out), { recursive: true });
    const payload = {
      runAt: new Date().toISOString(),
      node: nodeVersion,
      platform,
      data: process.env.BENCH_DATA_SRC ?? "this checkout",
      scenarios,
    };
    await writeFile(out, `${JSON.stringify(payload, null, 2)}\n`, "utf8");
  });
});
