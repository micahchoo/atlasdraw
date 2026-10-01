import { describe, expect, it } from "vitest";

import { metersPerPixel } from "../StatusBar";

// MapLibre's zoom counts 512-px tiles: at zoom 0 the whole equator
// (40,075,016.686 m) spans 512 px.
describe("metersPerPixel", () => {
  it("matches MapLibre's 512-px tiles at the equator", () => {
    expect(metersPerPixel(0, 0)).toBeCloseTo(40075016.686 / 512, 3);
  });

  it("halves with every zoom level and shrinks by cos(latitude)", () => {
    expect(metersPerPixel(60, 3)).toBeCloseTo(
      (40075016.686 / 512 / 8) * 0.5,
      6,
    );
  });
});
