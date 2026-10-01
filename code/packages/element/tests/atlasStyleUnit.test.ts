// Atlasdraw addition (docs/architecture/adr/0015-world-coordinates-gate.md). An
// element's pixel-sized details — its arrowheads, dashes, rough jitter and
// adaptive corner radius — are drawn in its pixel unit,
// `customData.atlas.unit`. Without it they are upstream's.

import { pointFrom } from "@atlasdraw/math";
import { ROUNDNESS } from "@atlasdraw/common";

import type { LocalPoint } from "@atlasdraw/math";

import { editorUnit, styleUnit } from "../src/atlasStyleUnit";
import { getBindingGap, maxBindingDistance_simple } from "../src/binding";
import { computeContainerDimensionForBoundText } from "../src/textElement";
import { getArrowheadPoints } from "../src/bounds";
import { newArrowElement, newElement } from "../src/newElement";
import {
  ShapeCache,
  generateRoughOptions,
  toggleLinePolygonState,
} from "../src/shape";
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

describe("distances in the element's and the editor's unit", () => {
  const view = (zoom: number, screenSizedStyles: boolean) => ({
    zoom: { value: zoom },
    screenSizedStyles,
  });

  it("the editor's unit is one pixel at its zoom, or 1 upstream", () => {
    expect(editorUnit(view(1 / UNIT, true))).toBe(UNIT);
    expect(editorUnit(view(1 / UNIT, false))).toBe(1);
  });

  it("the binding reach is upstream's at zoom 1, in the editor's unit", () => {
    const atZoom1 = maxBindingDistance_simple(view(1, false));
    expect(maxBindingDistance_simple(view(1 / UNIT, true))).toBe(
      atZoom1 * UNIT,
    );
    // Upstream's zoom rule is kept without the prop.
    expect(maxBindingDistance_simple(view(0.25, false))).toBe(30);
  });

  it("the binding gap is in the arrow's unit; the target's stroke adds", () => {
    const target = newElement({
      type: "rectangle",
      x: 0,
      y: 0,
      strokeWidth: 2 * UNIT,
    }) as Parameters<typeof getBindingGap>[0];
    const plain = getBindingGap(
      { ...target, strokeWidth: 2 },
      {
        elbowed: false,
      },
    );
    expect(getBindingGap(target, { elbowed: false, ...withUnit(UNIT) })).toBe(
      plain * UNIT,
    );
  });

  it("a line's ends 10 px apart merge when it becomes a polygon", () => {
    const pointsAfter = (unit?: number) => {
      const u = unit ?? 1;
      const line = newElement({
        type: "line",
        x: 0,
        y: 0,
        ...withUnit(unit),
      }) as unknown as Parameters<typeof toggleLinePolygonState>[0];
      const points = [
        [0, 0],
        [100 * u, 0],
        [100 * u, 100 * u],
        [10 * u, 0],
      ].map(([x, y]) => pointFrom<LocalPoint>(x, y));
      return toggleLinePolygonState({ ...line, points }, true)!.points.length;
    };
    expect(pointsAfter()).toBe(4);
    expect(pointsAfter(UNIT)).toBe(4);
  });

  it("bound-text padding is in the container's unit", () => {
    expect(
      computeContainerDimensionForBoundText(100 * UNIT, "rectangle", UNIT),
    ).toBe(computeContainerDimensionForBoundText(100, "rectangle") * UNIT);
  });
});
