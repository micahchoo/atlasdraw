// Atlasdraw addition (ADR-0015). Browsers clamp a canvas font to 10000px, and
// the atlas app's text is 20 px × 2^(22 − zoom) scene units. A font above
// MAX_CANVAS_FONT_SIZE is measured at that size and scaled up, so a measured
// width stays linear in the font size.

import { MAX_CANVAS_FONT_SIZE } from "@atlasdraw/common";

import { getLineWidth } from "../src/textMeasurements";

import type { FontString } from "../src/types";

const font = (px: number) => `${px}px Excalifont, sans-serif` as FontString;

describe("canvas text above MAX_CANVAS_FONT_SIZE", () => {
  it("measures 20 × as wide at 20 × the cap", () => {
    const atCap = getLineWidth("Ward 3", font(MAX_CANVAS_FONT_SIZE));
    const big = getLineWidth("Ward 3", font(20 * MAX_CANVAS_FONT_SIZE));
    expect(big / atCap).toBeCloseTo(20, 9);
  });

  it("measures a font at or below the cap as upstream does", () => {
    expect(getLineWidth("Ward 3", font(20))).toBe(
      getLineWidth("Ward 3", font(MAX_CANVAS_FONT_SIZE)),
    );
  });
});
