// SPDX-License-Identifier: AGPL-3.0-only
// A drawing from a plain .excalidraw file lands on the map view, at the size
// it had on screen.

import { describe, expect, it } from "vitest";

import { documentFrame, sceneUnitsPerPixel, toScene } from "@atlasdraw/geo";

import { placeDrawing } from "../placeDrawing";

const frame = documentFrame(77.2, 28.6);

describe("placeDrawing", () => {
  it("centres the drawing on the camera and scales it to one pixel per unit", () => {
    const [rect] = placeDrawing(
      [
        {
          id: "r",
          type: "rectangle",
          x: 100,
          y: 50,
          width: 200,
          height: 100,
          strokeWidth: 2,
        },
      ],
      frame,
      { center: [77.3, 28.7], zoom: 12 },
    );
    const s = sceneUnitsPerPixel(frame, 12);
    const c = toScene(frame, 77.3, 28.7);
    expect(rect.x).toBeCloseTo(c.x - 100 * s, 6);
    expect(rect.y).toBeCloseTo(c.y - 50 * s, 6);
    expect(rect.width).toBeCloseTo(200 * s, 9);
    expect(rect.height).toBeCloseTo(100 * s, 9);
    expect(rect.strokeWidth).toBeCloseTo(2 * s, 9);
  });

  it("scales points and font sizes, and keeps every other field", () => {
    const [line, text] = placeDrawing(
      [
        {
          id: "l",
          type: "line",
          x: 0,
          y: 0,
          width: 10,
          height: 20,
          strokeWidth: 1,
          points: [
            [0, 0],
            [10, 20],
          ],
          strokeColor: "#123456",
        },
        {
          id: "t",
          type: "text",
          x: 0,
          y: 0,
          width: 10,
          height: 20,
          strokeWidth: 1,
          fontSize: 20,
          text: "Ward 3",
        },
      ],
      frame,
      { center: [77.2, 28.6], zoom: 20 },
    );
    expect(line.points).toEqual([
      [0, 0],
      [40, 80],
    ]);
    expect(line.strokeColor).toBe("#123456");
    expect(text.fontSize).toBe(80);
    expect(text.text).toBe("Ward 3");
  });

  it("returns an empty drawing unchanged", () => {
    expect(placeDrawing([], frame, { center: [0, 0], zoom: 4 })).toEqual([]);
  });
});
