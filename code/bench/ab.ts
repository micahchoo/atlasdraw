/* SPDX-License-Identifier: MIT */
// Time the merge base and the head on this machine, and compare.
//
//   yarn workspace @atlasdraw/bench ab --base <base checkout's code/> [--runs 5] [--blocking]
//
// Each round runs scenarios/ once for each side, in alternating order, so a
// runner that slows down during the job slows both sides alike. The base is
// timed by THIS harness: BENCH_DATA_SRC points @atlasdraw/data at the base
// checkout's source (which must have its own node_modules). gate.ts decides.
//
// Report only by default: exit 0 whatever the result. --blocking exits 1 on
// a regression. README.md says when CI may pass --blocking.

import { execFileSync } from "node:child_process";
import {
  appendFileSync,
  mkdirSync,
  readFileSync,
  writeFileSync,
} from "node:fs";
import { dirname, join, resolve } from "node:path";
import { fileURLToPath } from "node:url";

import { compareRuns, MIN_SLACK, NOISE_FACTOR } from "./gate";

import type { Runs } from "./gate";

interface RunFile {
  scenarios: { label: string; median_ms: number }[];
}

function arg(name: string): string | undefined {
  const i = process.argv.indexOf(`--${name}`);
  return i === -1 ? undefined : process.argv[i + 1];
}

const here = dirname(fileURLToPath(import.meta.url));
const baseArg = arg("base");
if (!baseArg) {
  console.error(
    "usage: ab.ts --base <base checkout's code/> [--runs N] [--blocking]",
  );
  process.exit(2);
}
const baseData = resolve(baseArg, "packages/data/src/index.ts");
const runs = Number(arg("runs") ?? 5);
const blocking = process.argv.includes("--blocking");
const out = join(here, "results", "current", "ab");
mkdirSync(out, { recursive: true });

const sides = {
  base: { BENCH_DATA_SRC: baseData },
  head: {},
} as const;
type Side = keyof typeof sides;
const collected: Record<Side, Record<string, number[]>> = {
  base: {},
  head: {},
};

for (let round = 0; round < runs; round++) {
  const order: Side[] = round % 2 ? ["base", "head"] : ["head", "base"];
  for (const side of order) {
    const file = join(out, `${side}-${round}.json`);
    execFileSync(
      "yarn",
      [
        "run",
        "-T",
        "vitest",
        "run",
        "--config",
        "./vitest.config.ts",
        "scenarios/",
      ],
      {
        cwd: here,
        stdio: ["ignore", "ignore", "inherit"],
        env: { ...process.env, ...sides[side], BENCH_OUT: file },
      },
    );
    const run = JSON.parse(readFileSync(file, "utf8")) as RunFile;
    for (const s of run.scenarios) {
      (collected[side][s.label] ??= []).push(s.median_ms);
    }
  }
  console.log(`round ${round + 1}/${runs} done`);
}

const checks = compareRuns(collected.base as Runs, collected.head as Runs);
const lines = [
  `### Bench: merge base vs head, ${runs} runs each, same runner`,
  "",
  `Limit: base median x (1 + max(${MIN_SLACK}, ${NOISE_FACTOR} x relative spread)). ${
    blocking ? "Blocking." : "Report only."
  }`,
  "",
  "| scenario | base ms | head ms | limit ms | |",
  "|---|---:|---:|---:|---|",
  ...checks.map(
    (c) =>
      `| ${c.label} | ${c.baseMs.toFixed(3)} | ${c.headMs.toFixed(
        3,
      )} | ${c.limitMs.toFixed(3)} | ${c.pass ? "pass" : "SLOWER"} |`,
  ),
];
const report = lines.join("\n");
console.log(`\n${report}`);
writeFileSync(
  join(out, "summary.json"),
  `${JSON.stringify({ runs, checks, collected }, null, 2)}\n`,
);
if (process.env.GITHUB_STEP_SUMMARY) {
  appendFileSync(process.env.GITHUB_STEP_SUMMARY, `${report}\n`);
}

const slower = checks.filter((c) => !c.pass).length;
if (slower > 0) {
  console.error(`\n${slower} scenario(s) slower than the limit.`);
  if (blocking) {
    process.exit(1);
  }
}
