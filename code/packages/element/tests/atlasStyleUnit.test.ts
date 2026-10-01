// Atlasdraw addition (ADR-0015). An element's pixel-sized details — its
// arrowheads, dashes, rough jitter and adaptive corner radius — are drawn in
// its pixel unit, `customData.atlas.unit`. Without it they are upstream's.

import { pointFrom } from "@atlasdraw/math";
import { ROUNDNESS } from "@atlasdraw/common";

import type { LocalPoint } from "@atlasdraw/math";

import { styleUnit } from "../src/atlasStyleUnit";
import { getArrowheadPoints } from "../src/bounds";
import { newArrowElement, newElement } from "../src/newElement";
import { ShapeCache, generateRoughOptions } from "../src/shape";
import { getCornerRadius } from "../src/utils";

import type { ExcalidrawLinearElement } from "../src/types";

const UNIT = 1024;

const withUnit = (unit?: number) =>
  unit === undefined ? {} : { customData: { atlas: { unit } } };

/** A straight arrow along x, `length` long, drawn at `unit`. */
const arrow = (length: number, unit?: number) =>
  newArrowElement({
    type: "arrow",
    x: 0,
    y: 0,
    points: [pointFrom<LocalPoint>(0, 0), pointFrom<LocalPoint>(length, 0)],
    endArrowhead: "arrow",
    roughness: 0,
    strokeWidth: 2 * (unit ?? 1),
    ...withUnit(unit),
  }) as ExcalidrawLinearElement;

/** Length of the arrowhead's first barb. */
const headLength = (el: ExcalidrawLinearElement): number => {
  const shape = ShapeCache.generateElementShape(el, null);
  const pts = getArrowheadPoints(
    el,
    Array.isArray(shape) ? shape : [shape],
    "end",
    "arrow",
  );
  if (!pts) {
    throw new Error("no arrowhead");
  }
  const [x2, y2, x3, y3] = pts as number[];
  return Math.hypot(x3 - x2, y3 - y2);
};

describe("styleUnit", () => {
  it("is 1 without the field, and for a value that is not a positive number", () => {
    expect(styleUnit(newElement({ type: "rectangle", x: 0, y: 0 }))).toBe(1);
    for (const unit of [0, -2, NaN, "4"]) {
      expect(
        styleUnit(
          newElement({
            type: "rectangle",
            x: 0,
            y: 0,
            customData: { atlas: { unit } },
          }),
        ),
      ).toBe(1);
    }
  });

  it("reads customData.atlas.unit", () => {
    expect(
      styleUnit(newElement({ type: "rectangle", x: 0, y: 0, ...withUnit(8) })),
    ).toBe(8);
  });
});

describe("details drawn in the element's pixel unit", () => {
  it("an arrowhead scales with the unit", () => {
    const plain = headLength(arrow(400));
    const scaled = headLength(arrow(400 * UNIT, UNIT));
    expect(scaled / plain).toBeCloseTo(UNIT, 6);
  });

  it("a dash pattern scales with the unit", () => {
    const dashed = (unit?: number) =>
      generateRoughOptions(
        newElement({
          type: "rectangle",
          x: 0,
          y: 0,
          strokeStyle: "dashed",
          strokeWidth: 2 * (unit ?? 1),
          ...withUnit(unit),
        }),
      ).strokeLineDash!;
    expect(dashed()).toEqual([8, 10]);
    expect(dashed(UNIT)).toEqual([8 * UNIT, 10 * UNIT]);
  });

  it("rough jitter scales with the unit, and is upstream's without it", () => {
    const opts = (unit?: number) =>
      generateRoughOptions(
        newElement({ type: "rectangle", x: 0, y: 0, ...withUnit(unit) }),
      );
    expect(opts().maxRandomnessOffset).toBeUndefined();
    expect(opts().bowing).toBeUndefined();
    expect(opts(UNIT).maxRandomnessOffset).toBe(2 * UNIT);
    // roughjs bows a line by offset × length × bowing / 200.
    expect(opts(UNIT).bowing).toBe(1 / UNIT);
  });

  it("the adaptive corner radius scales with the unit", () => {
    const rounded = (unit?: number) =>
      newElement({
        type: "rectangle",
        x: 0,
        y: 0,
        roundness: { type: ROUNDNESS.ADAPTIVE_RADIUS },
        ...withUnit(unit),
      });
    expect(getCornerRadius(1e9, rounded())).toBe(32);
    expect(getCornerRadius(1e9, rounded(UNIT))).toBe(32 * UNIT);
  });
});
