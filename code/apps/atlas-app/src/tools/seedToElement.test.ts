// apps/atlas-app/src/tools/seedToElement.test.ts
// SPDX-License-Identifier: AGPL-3.0-only
//
// seedToElement places a tool's seed in the document's world frame. One test
// per supported (type, customType, geo.kind) tuple: the element has the
// expected type, its vertices sit at `toScene` of the seed's lng/lat, its
// screen-pixel sizes are scene units at the seed's zoom, and tool data
// survives under `_data`.

import { describe, it, expect, beforeAll } from "vitest";

import { documentFrame, sceneUnitsPerPixel, toScene } from "@atlasdraw/geo";

import type { AtlasdrawElementSeed } from "@atlasdraw/tools";

import { seedToElement } from "./seedToElement.js";

// jsdom does not implement canvas. Excalidraw's `newTextElement` calls
// measureText via canvas getContext("2d"). Stub a minimal 2d context so the
// text branch test can run without pulling in the heavy `canvas` package.
beforeAll(() => {
  if (typeof HTMLCanvasElement !== "undefined") {
    (HTMLCanvasElement.prototype as any).getContext = function (
      kind: string,
    ): unknown {
      if (kind !== "2d") {
        return null;
      }
      return {
        font: "",
        measureText: (text: string) => ({
          width: text.length * 8,
          actualBoundingBoxAscent: 16,
          actualBoundingBoxDescent: 4,
        }),
        fillText: () => undefined,
        save: () => undefined,
        restore: () => undefined,
      };
    };
  }
});

// ---------------------------------------------------------------------------
// Test helpers
// ---------------------------------------------------------------------------

const frame = documentFrame(-73.98, 40.75);
const Z_REF = 12;
const UNIT = sceneUnitsPerPixel(frame, Z_REF);

function at(lng: number, lat: number) {
  return toScene(frame, lng, lat);
}

describe("seedToElement: pin", () => {
  const seed: AtlasdrawElementSeed = {
    type: "custom",
    customType: "pin",
    geo: { kind: "point", lng: -73.97, lat: 40.76, zRef: Z_REF },
    data: { label: "NYC" },
  };

  it("is an ellipse centred on the click, 16 screen px wide at its zoom", () => {
    const el = seedToElement(seed, frame);
    expect(el.type).toBe("ellipse");
    const c = at(-73.97, 40.76);
    expect(el.x + el.width / 2).toBeCloseTo(c.x, 6);
    expect(el.y + el.height / 2).toBeCloseTo(c.y, 6);
    expect(el.width).toBeCloseTo(16 * UNIT, 9);
    expect(el.strokeWidth).toBeCloseTo(2 * UNIT, 9);
  });

  it("keeps the tool data and marks the pin", () => {
    const el = seedToElement(seed, frame);
    expect(el.customData).toEqual({
      _data: { label: "NYC" },
      tool: "pin",
      atlas: { unit: UNIT },
    });
  });
});

describe("seedToElement: freedraw", () => {
  it("puts x/y on the first vertex and points relative to it", () => {
    const el = seedToElement(
      {
        type: "freedraw",
        geo: {
          kind: "polyline",
          coordinates: [
            [-73.98, 40.75],
            [-73.97, 40.76],
            [-73.96, 40.74],
            [-73.98, 40.75],
          ],
          zRef: Z_REF,
        },
      },
      frame,
    );
    expect(el.type).toBe("freedraw");
    const first = at(-73.98, 40.75);
    expect(el.x).toBeCloseTo(first.x, 6);
    expect(el.y).toBeCloseTo(first.y, 6);
    const pts = (el as unknown as { points: ReadonlyArray<[number, number]> })
      .points;
    expect(pts[0]).toEqual([0, 0]);
    expect(pts).toHaveLength(4);
    const second = at(-73.97, 40.76);
    expect(pts[1][0]).toBeCloseTo(second.x - first.x, 6);
    expect(pts[1][1]).toBeCloseTo(second.y - first.y, 6);
  });
});

describe("seedToElement: line and arrow", () => {
  const coordinates: Array<[number, number]> = [
    [-73.98, 40.75],
    [-73.97, 40.76],
  ];

  it("a line has relative points", () => {
    const el = seedToElement(
      { type: "line", geo: { kind: "polyline", coordinates, zRef: Z_REF } },
      frame,
    );
    expect(el.type).toBe("line");
    expect(el.width).toBeCloseTo(at(-73.97, 0).x - at(-73.98, 0).x, 6);
  });

  it("an arrow has an end arrowhead", () => {
    const el = seedToElement(
      { type: "arrow", geo: { kind: "polyline", coordinates, zRef: Z_REF } },
      frame,
    );
    expect(el.type).toBe("arrow");
    expect(
      (el as unknown as { endArrowhead: string | null }).endArrowhead,
    ).toBe("arrow");
  });
});

describe("seedToElement: rectangle", () => {
  it("spans the bbox corners", () => {
    const el = seedToElement(
      {
        type: "rectangle",
        geo: {
          kind: "bbox",
          west: -73.99,
          south: 40.74,
          east: -73.97,
          north: 40.76,
          zRef: Z_REF,
        },
      },
      frame,
    );
    expect(el.type).toBe("rectangle");
    const nw = at(-73.99, 40.76);
    const se = at(-73.97, 40.74);
    expect(el.x).toBeCloseTo(nw.x, 6);
    expect(el.y).toBeCloseTo(nw.y, 6);
    expect(el.width).toBeCloseTo(se.x - nw.x, 6);
    expect(el.height).toBeCloseTo(se.y - nw.y, 6);
  });
});

describe("seedToElement: ellipse", () => {
  it("is a circle of the default size, centred on the point", () => {
    const el = seedToElement(
      {
        type: "ellipse",
        geo: { kind: "point", lng: -73.98, lat: 40.75, zRef: Z_REF },
      },
      frame,
    );
    expect(el.type).toBe("ellipse");
    expect(el.width).toBe(el.height);
    expect(el.width).toBeCloseTo(40 * UNIT, 9);
    expect(el.customData).toEqual({ atlas: { unit: UNIT } });
  });
});

describe("seedToElement: text", () => {
  it("starts at the point, 20 screen px high at its zoom", () => {
    const el = seedToElement(
      {
        type: "text",
        geo: { kind: "point", lng: -73.98, lat: 40.75, zRef: Z_REF },
        data: { text: "Hello" },
      },
      frame,
    );
    expect(el.type).toBe("text");
    const p = at(-73.98, 40.75);
    expect(el.x).toBeCloseTo(p.x, 6);
    expect((el as unknown as { fontSize: number }).fontSize).toBeCloseTo(
      20 * UNIT,
      9,
    );
    expect(el.customData).toEqual({
      _data: { text: "Hello" },
      atlas: { unit: UNIT },
    });
  });
});

describe("seedToElement: unsupported tuple", () => {
  it("throws with (type, customType, kind) in the message", () => {
    const badSeed = {
      type: "custom",
      customType: "unknown-thing",
      geo: { kind: "point", lng: 0, lat: 0, zRef: Z_REF },
    } as unknown as AtlasdrawElementSeed;
    expect(() => seedToElement(badSeed, frame)).toThrow(/unsupported/);
  });

  it("throws when geo.kind doesn't match the element type", () => {
    const badSeed = {
      type: "rectangle",
      geo: { kind: "point", lng: 0, lat: 0, zRef: Z_REF },
    } as unknown as AtlasdrawElementSeed;
    expect(() => seedToElement(badSeed, frame)).toThrow(/rectangle requires/);
  });
});
