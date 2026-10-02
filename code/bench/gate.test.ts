import { describe, expect, it } from "vitest";

import { compareRuns, relativeSpread } from "./gate";

// Each list is one scenario's median time from each run, in ms.
const steady = [10, 10.2, 9.9, 10.1, 10];

describe("compareRuns", () => {
  it("fails a scenario whose head is clearly slower than its base", () => {
    const [row] = compareRuns(
      { "parse 10k": steady },
      { "parse 10k": [13, 13.1, 12.9, 13.2, 13] },
    );
    expect(row.pass).toBe(false);
  });

  it("passes the same code measured twice", () => {
    const [row] = compareRuns(
      { "parse 10k": steady },
      { "parse 10k": [10.1, 9.8, 10.3, 10, 10.2] },
    );
    expect(row.pass).toBe(true);
  });

  it("widens the limit when the runs are noisy, so noise is not a regression", () => {
    const noisy = [8, 12, 10, 7, 13];
    const [row] = compareRuns(
      { "parse 10k": noisy },
      { "parse 10k": [11, 12, 9, 14, 11.5] },
    );
    expect(row.limitMs).toBeGreaterThan(10 * 1.1);
    expect(row.pass).toBe(true);
  });

  it("compares only scenarios both sides ran", () => {
    expect(
      compareRuns({ old: steady }, { new: steady }).map((r) => r.label),
    ).toEqual([]);
  });
});

describe("relativeSpread", () => {
  it("is zero for identical runs and grows with the scatter", () => {
    expect(relativeSpread([5, 5, 5])).toBe(0);
    expect(relativeSpread([8, 12, 10, 7, 13])).toBeGreaterThan(
      relativeSpread(steady),
    );
  });
});
