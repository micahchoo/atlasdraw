// SPDX-License-Identifier: MIT
// Bench CI gate: compare the run in results/current/ against the committed
// baseline in results/phase-1-baseline.json. A bench run never writes the
// baseline; `yarn workspace @atlasdraw/bench rebaseline` does, on purpose.
//
// Exit 0 when every covered scenario is within SLACK of the baseline.

import { readFile } from "node:fs/promises";
import { dirname, resolve } from "node:path";
import { fileURLToPath } from "node:url";

import { compareToBaseline, SLACK } from "./gate";

import type { ScenarioResult } from "./gate";

const here = dirname(fileURLToPath(import.meta.url));

async function scenarios(...path: string[]): Promise<ScenarioResult[]> {
  const text = await readFile(resolve(here, "results", ...path), "utf8");
  return (JSON.parse(text) as { scenarios: ScenarioResult[] }).scenarios;
}

const baseline = await scenarios("phase-1-baseline.json");
const current = [
  ...(await scenarios("current", "phase-1.json")),
  ...(await scenarios("current", "phase-2-with-data-layers.json")),
];

const checks = compareToBaseline(baseline, current);
for (const c of checks) {
  console.log(
    `${c.pass ? "PASS" : "FAIL"}  ${c.label}\n      p95=${
      c.p95_ms
    }ms  limit=${c.limit_ms.toFixed(3)}ms (slack ${SLACK})`,
  );
}
const failures = checks.filter((c) => !c.pass).length;
if (failures > 0) {
  console.error(
    `\n${failures} scenario(s) exceeded the baseline — gate FAILED.`,
  );
  process.exit(1);
}
console.log(`\nAll ${checks.length} gate checks passed.`);
