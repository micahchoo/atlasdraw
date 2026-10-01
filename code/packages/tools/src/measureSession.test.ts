import { describe, expect, it } from "vitest";

import { IDLE_MEASURE, measureStep, shownPath } from "./measureSession.js";

import type { MeasureState } from "./measureSession.js";

const A = { lng: 0, lat: 0 };
const B = { lng: 1, lat: 0 };
const C = { lng: 1, lat: 1 };

function run(...events: Parameters<typeof measureStep>[1][]): MeasureState {
  return events.reduce(measureStep, IDLE_MEASURE);
}

describe("measureStep", () => {
  it("adds a point for each click and follows the pointer", () => {
    const s = run(
      { type: "click", at: A, nearLast: false },
      { type: "click", at: B, nearLast: false },
      { type: "move", at: C },
    );
    expect(s.phase).toBe("measuring");
    expect(s.points).toEqual([A, B]);
    expect(shownPath(s)).toEqual([A, B, C]);
  });

  it("ends on a click next to the last point (the second click of a double-click)", () => {
    const s = run(
      { type: "click", at: A, nearLast: false },
      { type: "click", at: B, nearLast: false },
      { type: "click", at: B, nearLast: true },
    );
    expect(s.phase).toBe("done");
    expect(s.points).toEqual([A, B]);
    expect(shownPath(s)).toEqual([A, B]);
  });

  it("ends on Enter only when the path has two points", () => {
    const one = run(
      { type: "click", at: A, nearLast: false },
      { type: "finish" },
    );
    expect(one.phase).toBe("measuring");
    const two = run(
      { type: "click", at: A, nearLast: false },
      { type: "click", at: B, nearLast: false },
      { type: "move", at: C },
      { type: "finish" },
    );
    expect(two.phase).toBe("done");
    expect(two.hover).toBeNull();
  });

  it("starts a new path on the next click after it ends", () => {
    const s = run(
      { type: "click", at: A, nearLast: false },
      { type: "click", at: B, nearLast: false },
      { type: "finish" },
      { type: "click", at: C, nearLast: false },
    );
    expect(s.phase).toBe("measuring");
    expect(s.points).toEqual([C]);
  });

  it("does not follow the pointer once the path has ended", () => {
    const s = run(
      { type: "click", at: A, nearLast: false },
      { type: "click", at: B, nearLast: false },
      { type: "finish" },
      { type: "move", at: C },
    );
    expect(shownPath(s)).toEqual([A, B]);
  });

  it("removes the last point on undo", () => {
    const s = run(
      { type: "click", at: A, nearLast: false },
      { type: "click", at: B, nearLast: false },
      { type: "undo" },
    );
    expect(s.points).toEqual([A]);
  });

  it("clears everything on reset", () => {
    const s = run({ type: "click", at: A, nearLast: false }, { type: "reset" });
    expect(s).toEqual(IDLE_MEASURE);
  });
});
