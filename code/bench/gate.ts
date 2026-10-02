// SPDX-License-Identifier: MIT
// The bench regression rule, as a pure function so it can be tested.
//
// It compares two sets of runs made on the SAME machine in the same job:
// the merge base and the head (ab.ts). A committed baseline timed on another
// machine says nothing about a regression; that gate failed 2 runs in 3 on
// an unchanged tree (audit 2, F4).

/** Scenario label -> its median time, in ms, from each run. */
export type Runs = Record<string, readonly number[]>;

export interface RunCheck {
  label: string;
  baseMs: number;
  headMs: number;
  limitMs: number;
  pass: boolean;
}

/** The head may always be this much slower than the base. */
export const MIN_SLACK = 0.1;
/** ... and this many times the measured relative spread, if that is wider. */
export const NOISE_FACTOR = 3;

function median(values: readonly number[]): number {
  const sorted = [...values].sort((a, b) => a - b);
  const mid = Math.floor(sorted.length / 2);
  return sorted.length % 2 ? sorted[mid] : (sorted[mid - 1] + sorted[mid]) / 2;
}

/**
 * The scatter of a set of runs, relative to their median: the median
 * absolute deviation, scaled (x1.4826) to match a standard deviation for
 * normal noise. One slow run moves it little, unlike a standard deviation.
 */
export function relativeSpread(values: readonly number[]): number {
  const m = median(values);
  if (m === 0) {
    return 0;
  }
  const mad = median(values.map((v) => Math.abs(v - m)));
  return (1.4826 * mad) / m;
}

/**
 * For each scenario both sides ran: fail when the head's median is above
 * base * (1 + slack), where slack is MIN_SLACK or NOISE_FACTOR times the
 * wider of the two spreads, whichever is larger.
 */
export function compareRuns(base: Runs, head: Runs): RunCheck[] {
  const checks: RunCheck[] = [];
  for (const [label, headRuns] of Object.entries(head)) {
    const baseRuns = base[label];
    if (!baseRuns) {
      continue;
    }
    const baseMs = median(baseRuns);
    const headMs = median(headRuns);
    const slack = Math.max(
      MIN_SLACK,
      NOISE_FACTOR *
        Math.max(relativeSpread(baseRuns), relativeSpread(headRuns)),
    );
    const limitMs = baseMs * (1 + slack);
    checks.push({ label, baseMs, headMs, limitMs, pass: headMs <= limitMs });
  }
  return checks;
}
