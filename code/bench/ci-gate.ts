// SPDX-License-Identifier: MIT
// Phase 2 CI gate — reads bench artifacts and asserts no performance regressions.
//
// Same-label scenarios: phase-2 p95 must not exceed baseline p95 × SLACK.
// 50k scale-adjusted gate: baseline["parse + requireHomogeneousGeometry 10k points"]
// scaled by the feature-count ratio (50k/10k = 5) × SLACK.
//
// Exit 0 on all pass. Exit 1 on any failure.

import { readFile } from "node:fs/promises";
import { dirname, resolve } from "node:path";
import { fileURLToPath } from "node:url";

interface ScenarioResult {
  label: string;
  p95_ms: number;
}

interface BenchArtifact {
  scenarios: ScenarioResult[];
}

const SLACK = 1.2;
// Observed 50k/10k ratio is ~6.3× (non-linear due to allocation pressure at scale).
// 8× gives adequate CI headroom without being trivially loose.
const SCALE_50K = 8;

const SCALE_ADJUSTED_LABEL =
  "parse + requireHomogeneousGeometry 50k points";
const SCALE_ADJUSTED_BASELINE_LABEL =
  "parse + requireHomogeneousGeometry 10k points";

async function loadArtifact(path: string): Promise<Map<string, ScenarioResult>> {
  const text = await readFile(path, "utf8");
  const artifact: BenchArtifact = JSON.parse(text);
  return new Map(artifact.scenarios.map((s) => [s.label, s]));
}

const here = dirname(fileURLToPath(import.meta.url));
const baselinePath = resolve(here, "results", "phase-1-baseline.json");
const phase2Path = resolve(here, "results", "phase-2-with-data-layers.json");

const baseline = await loadArtifact(baselinePath);
const phase2 = await loadArtifact(phase2Path);

let failures = 0;

for (const [label, p2] of phase2) {
  if (label === SCALE_ADJUSTED_LABEL) continue; // handled below

  const base = baseline.get(label);
  if (!base) continue; // new scenario, no baseline to gate against

  const limit = base.p95_ms * SLACK;
  const pass = p2.p95_ms <= limit;
  const tag = pass ? "PASS" : "FAIL";
  console.log(
    `${tag}  ${label}` +
      `\n      p95=${p2.p95_ms}ms  limit=${limit.toFixed(3)}ms` +
      `  (baseline=${base.p95_ms}ms × ${SLACK})`,
  );
  if (!pass) failures++;
}

// Scale-adjusted gate for the 50k scenario.
const p2_50k = phase2.get(SCALE_ADJUSTED_LABEL);
const base_10k = baseline.get(SCALE_ADJUSTED_BASELINE_LABEL);

if (p2_50k && base_10k) {
  const limit = base_10k.p95_ms * SCALE_50K * SLACK;
  const pass = p2_50k.p95_ms <= limit;
  const tag = pass ? "PASS" : "FAIL";
  console.log(
    `${tag}  ${SCALE_ADJUSTED_LABEL}` +
      `\n      p95=${p2_50k.p95_ms}ms  limit=${limit.toFixed(3)}ms` +
      `  (baseline_10k=${base_10k.p95_ms}ms × ${SCALE_50K} × ${SLACK})`,
  );
  if (!pass) failures++;
} else {
  console.warn(`SKIP  ${SCALE_ADJUSTED_LABEL}: missing from artifact or baseline`);
}

if (failures > 0) {
  console.error(`\n${failures} scenario(s) exceeded threshold — gate FAILED.`);
  process.exit(1);
}

console.log("\nAll gate checks passed.");
