// SPDX-License-Identifier: MIT
// Scene geometry of one element, and the lng/lat bounds of many.

import fc from "fast-check";
import { describe, expect, it } from "vitest";

import { computeSceneBounds } from "./bounds";
import { shapeCenter, shapeOutline } from "./sceneGeometry";
import { documentFrame, toLngLat, toScene } from "./world";

const near = (a: number, b: number) => expect(a).toBeCloseTo(b, 9);

describe("shapeOutline", () => {
  it("is the box corners NW, NE, SE, SW for an unturned shape", () => {
    expect(
      shapeOutline({ type: "rectangle", x: 10, y: 20, width: 30, height: 40 }),
    ).toEqual([
      { x: 10, y: 20 },
      { x: 40, y: 20 },
      { x: 40, y: 60 },
      { x: 10, y: 60 },
    ]);
  });

  it("turns the corners about the centre, y-down, as Excalidraw does", () => {
    const [nw, ne] = shapeOutline({
      type: "rectangle",
      x: 0,
      y: 0,
      width: 20,
      height: 10,
      angle: Math.PI / 2,
    });
    // Centre (10, 5). A quarter turn clockwise on screen takes NW (-10,-5)
    // to (5,-10) about the centre.
    near(nw.x, 15);
    near(nw.y, -5);
    near(ne.x, 15);
    near(ne.y, 15);
  });

  it("is a linear element's points, offset by x/y", () => {
    expect(
      shapeOutline({
        type: "line",
        x: 100,
        y: 50,
        width: 30,
        height: 10,
        points: [
          [0, 0],
          [30, 10],
        ],
      }),
    ).toEqual([
      { x: 100, y: 50 },
      { x: 130, y: 60 },
    ]);
  });

  it("turns a linear element about the centre of its points", () => {
    const out = shapeOutline({
      type: "line",
      x: 0,
      y: 0,
      width: 20,
      height: 0,
      angle: Math.PI,
      points: [
        [0, 0],
        [20, 0],
      ],
    });
    near(out[0].x, 20);
    near(out[0].y, 0);
    near(out[1].x, 0);
    near(out[1].y, 0);
  });

  it("has the centre of its unturned box as a fixed point of turning", () => {
    fc.assert(
      fc.property(
        fc.double({ min: -1e9, max: 1e9, noNaN: true }),
        fc.double({ min: -1e9, max: 1e9, noNaN: true }),
        fc.double({ min: 1, max: 1e6, noNaN: true }),
        fc.double({ min: 1, max: 1e6, noNaN: true }),
        fc.double({ min: -Math.PI, max: Math.PI, noNaN: true }),
        (x, y, width, height, angle) => {
          const el = { type: "rectangle", x, y, width, height, angle };
          const pts = shapeOutline(el);
          const mx = (pts[0].x + pts[2].x) / 2;
          const my = (pts[0].y + pts[2].y) / 2;
          const c = shapeCenter(el);
          const tol = 1e-6 * Math.max(1, Math.abs(x), Math.abs(y));
          expect(Math.abs(mx - c.x)).toBeLessThan(tol);
          expect(Math.abs(my - c.y)).toBeLessThan(tol);
        },
      ),
    );
  });
});

describe("computeSceneBounds", () => {
  const frame = documentFrame(76.6, 24.3);

  it("is null with nothing to frame", () => {
    expect(computeSceneBounds([], frame)).toBe(null);
  });

  it("skips deleted elements", () => {
    const p = toScene(frame, 76.6, 24.3);
    expect(
      computeSceneBounds(
        [
          {
            type: "rectangle",
            x: p.x,
            y: p.y,
            width: 1,
            height: 1,
            isDeleted: true,
          },
        ],
        frame,
      ),
    ).toBe(null);
  });

  it("is the lng/lat box of every element's outline", () => {
    const nw = toScene(frame, 76.5, 24.4);
    const se = toScene(frame, 76.7, 24.2);
    const box = computeSceneBounds(
      [
        {
          type: "rectangle",
          x: nw.x,
          y: nw.y,
          width: (se.x - nw.x) / 2,
          height: (se.y - nw.y) / 2,
        },
        {
          type: "line",
          x: nw.x,
          y: nw.y,
          width: se.x - nw.x,
          height: se.y - nw.y,
          points: [
            [0, 0],
            [se.x - nw.x, se.y - nw.y],
          ],
        },
      ],
      frame,
    );
    expect(box).not.toBe(null);
    near(box!.west, 76.5);
    near(box!.north, 24.4);
    near(box!.east, 76.7);
    near(box!.south, 24.2);
  });

  it("grows to hold a turned shape's corners", () => {
    const c = toScene(frame, 76.6, 24.3);
    const flat = computeSceneBounds(
      [{ type: "rectangle", x: c.x, y: c.y, width: 1000, height: 10 }],
      frame,
    )!;
    const turned = computeSceneBounds(
      [
        {
          type: "rectangle",
          x: c.x,
          y: c.y,
          width: 1000,
          height: 10,
          angle: Math.PI / 4,
        },
      ],
      frame,
    )!;
    expect(turned.north).toBeGreaterThan(flat.north);
    expect(turned.south).toBeLessThan(flat.south);
    const centre = toLngLat(frame, { x: c.x + 500, y: c.y + 5 });
    expect(turned.west).toBeLessThan(centre.lng);
    expect(turned.east).toBeGreaterThan(centre.lng);
  });
});
