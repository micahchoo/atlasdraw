import { describe, expect, it } from "vitest";

import { compareToBaseline } from "./gate";

const run = (p95: number) => [{ label: "parse 10k points", p95_ms: p95 }];

describe("compareToBaseline", () => {
  it("fails a scenario that got slower than the committed baseline allows", () => {
    const [check] = compareToBaseline(run(10), run(13));
    expect(check.pass).toBe(false);
  });

  it("passes a scenario within the slack", () => {
    const [check] = compareToBaseline(run(10), run(11.9));
    expect(check.pass).toBe(true);
  });

  it("skips a scenario the baseline does not know", () => {
    expect(
      compareToBaseline(run(10), [{ label: "new scenario", p95_ms: 99 }]),
    ).toEqual([]);
  });
});
