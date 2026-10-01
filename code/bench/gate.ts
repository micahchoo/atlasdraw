// SPDX-License-Identifier: MIT
// The bench regression rule, as a pure function so it can be tested.

export interface ScenarioResult {
  label: string;
  p95_ms: number;
}

export interface GateCheck {
  label: string;
  p95_ms: number;
  limit_ms: number;
  pass: boolean;
}

/** A run may be this much slower than the baseline before it fails. */
export const SLACK = 1.2;

// The 50k scenario has no 50k baseline; it is held to the 10k baseline
// scaled up. Observed 50k/10k is ~6.3x (allocation pressure); 8x leaves
// headroom without being loose.
const SCALED: Record<string, { from: string; factor: number }> = {
  "parse + requireHomogeneousGeometry 50k points": {
    from: "parse + requireHomogeneousGeometry 10k points",
    factor: 8,
  },
};

/**
 * Compare a fresh run against the COMMITTED baseline. A scenario the
 * baseline does not cover is skipped, not passed.
 */
export function compareToBaseline(
  baseline: readonly ScenarioResult[],
  current: readonly ScenarioResult[],
): GateCheck[] {
  const base = new Map(baseline.map((s) => [s.label, s.p95_ms]));
  const checks: GateCheck[] = [];
  for (const { label, p95_ms } of current) {
    const scaled = SCALED[label];
    const reference = scaled ? base.get(scaled.from) : base.get(label);
    if (reference === undefined) {
      continue;
    }
    const limit_ms = reference * (scaled?.factor ?? 1) * SLACK;
    checks.push({ label, p95_ms, limit_ms, pass: p95_ms <= limit_ms });
  }
  return checks;
}
