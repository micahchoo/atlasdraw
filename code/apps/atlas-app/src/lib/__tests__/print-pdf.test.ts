// SPDX-License-Identifier: AGPL-3.0-only
// print-pdf tests. Every claim is read back out of the PDF that exportPDF
// writes: page sizes, the text drawn on each page, and the embedded map image
// with the size it is drawn at. Nothing here inspects a mock.

import { describe, it, expect } from "vitest";

import {
  PRINT_DPI,
  exportPDF,
  northArrowGeometry,
  pageDimensions,
  printPixelRatio,
  scaleBar,
  scaleRatioLabel,
  scaleUnitsForLocale,
  type LayerLegendEntry,
  type Orientation,
  type PageSize,
  type PrintOptions,
  type PrintView,
} from "../print-pdf";

import { jpegOfSize, readPdf, type ReadPdf } from "./fixtures/print";

// ---------------------------------------------------------------------------
// Fixtures
// ---------------------------------------------------------------------------

/** A 1440 × 720 CSS-px view, 10 m per CSS px: 14.4 km across. */
const VIEW: PrintView = { width: 1440, height: 720, metersPerPixel: 10 };

const LAYERS: LayerLegendEntry[] = [
  { id: "dl:a", name: "Trails", color: "#0aa" },
  { id: "dl:b", name: "Parks", color: "#3a3" },
  { id: "dl:c", name: "Rivers", color: "#48f" },
];

/** Options for a page, with the map image rendered at the ratio the layout asks for. */
function printOptions(overrides: Partial<PrintOptions> = {}): PrintOptions {
  const pageSize = overrides.pageSize ?? "letter";
  const orientation = overrides.orientation ?? "landscape";
  const view = overrides.view ?? VIEW;
  const layers = overrides.layers ?? LAYERS;
  const ratio = printPixelRatio({ pageSize, orientation }, view, layers.length);
  return {
    pageSize,
    orientation,
    title: "Test map",
    view,
    layers,
    attribution: "© Protomaps © OpenStreetMap",
    mapImageDataUrl: jpegOfSize(
      Math.floor(view.width * ratio),
      Math.floor(view.height * ratio),
    ),
    ...overrides,
  };
}

const allTexts = (pdf: ReadPdf) => pdf.pages.flatMap((p) => p.texts);

// ---------------------------------------------------------------------------

describe("pageDimensions", () => {
  it("A4 portrait is 595.28 × 841.89 pt", () => {
    const { width, height } = pageDimensions("a4", "portrait");
    expect(width).toBeCloseTo(595.28, 2);
    expect(height).toBeCloseTo(841.89, 2);
  });

  it("Tabloid landscape swaps width and height (1224 × 792)", () => {
    const { width, height } = pageDimensions("tabloid", "landscape");
    expect(width).toBe(1224);
    expect(height).toBe(792);
  });
});

describe("exportPDF — the map image", () => {
  const pages: [PageSize, Orientation][] = [
    ["letter", "landscape"],
    ["letter", "portrait"],
    ["a4", "landscape"],
    ["a4", "portrait"],
    ["tabloid", "landscape"],
    ["tabloid", "portrait"],
  ];

  for (const [pageSize, orientation] of pages) {
    it(`is embedded at print resolution on ${pageSize} ${orientation}`, async () => {
      const pdf = await readPdf(
        await exportPDF(printOptions({ pageSize, orientation })),
      );
      expect(pdf.pages[0].images).toHaveLength(1);
      const [image] = pdf.pages[0].images;
      const dpiAcross = image.pixelWidth / (image.width / 72);
      const dpiDown = image.pixelHeight / (image.height / 72);
      expect(dpiAcross).toBeGreaterThanOrEqual(200);
      expect(dpiDown).toBeGreaterThanOrEqual(200);
      // The ratio asks for PRINT_DPI; flooring the pixel count loses < 1 px.
      expect(dpiAcross).toBeGreaterThan(PRINT_DPI - 1);
    });
  }

  it("keeps the view's proportions on the page", async () => {
    const pdf = await readPdf(await exportPDF(printOptions()));
    const [image] = pdf.pages[0].images;
    expect(image.width / image.height).toBeCloseTo(VIEW.width / VIEW.height, 3);
  });

  it("refuses to write a page without the map", async () => {
    await expect(
      exportPDF(printOptions({ mapImageDataUrl: "data:," })),
    ).rejects.toThrow(/map image/i);
  });
});

describe("exportPDF — attribution", () => {
  it("credits the basemap it is given, on the page and in the document info", async () => {
    const pdf = await readPdf(
      await exportPDF(
        printOptions({ attribution: "© OpenFreeMap © OpenMapTiles" }),
      ),
    );
    expect(pdf.pages[0].texts).toContain("© OpenFreeMap © OpenMapTiles");
    expect(pdf.subject).toBe("© OpenFreeMap © OpenMapTiles");
  });

  it("does not credit a basemap it was not given", async () => {
    const pdf = await readPdf(
      await exportPDF(printOptions({ attribution: "© Protomaps" })),
    );
    expect(allTexts(pdf)).toContain("© Protomaps");
    expect(allTexts(pdf).join("\n")).not.toMatch(/OpenMapTiles/);
  });
});

describe("exportPDF — legend", () => {
  it("lists every layer on one page when they fit", async () => {
    const pdf = await readPdf(await exportPDF(printOptions()));
    expect(pdf.pages).toHaveLength(1);
    for (const layer of LAYERS) {
      expect(pdf.pages[0].texts).toContain(layer.name);
    }
  });

  it("continues on more pages instead of dropping layers", async () => {
    const many = Array.from({ length: 300 }, (_, i) => ({
      id: `el-${i}`,
      name: `Layer ${i + 1}`,
      color: "#868e96",
    }));
    const pdf = await readPdf(await exportPDF(printOptions({ layers: many })));
    const texts = allTexts(pdf);
    for (const layer of many) {
      expect(texts).toContain(layer.name);
    }
    expect(pdf.pages.length).toBeGreaterThan(1);
    expect(pdf.pages[0].texts.join(" ")).toMatch(/continues on page 2/i);
    // Every page is the chosen page size.
    for (const page of pdf.pages) {
      expect(page.width).toBe(792);
      expect(page.height).toBe(612);
    }
  });

  it("prints a name the standard font cannot encode instead of failing the export", async () => {
    const pdf = await readPdf(
      await exportPDF(
        printOptions({
          title: "東京 survey",
          layers: [{ id: "x", name: "東京 roads", color: "#000" }],
        }),
      ),
    );
    expect(pdf.pages[0].texts).toContain("?? roads");
    expect(pdf.pages[0].texts).toContain("?? survey");
  });

  it("shortens a name too long for its column and marks the cut", async () => {
    const long = "Very long layer name ".repeat(12).trim();
    const pdf = await readPdf(
      await exportPDF(
        printOptions({ layers: [{ id: "x", name: long, color: "#000" }] }),
      ),
    );
    const drawn = pdf.pages[0].texts.find((t) => t.startsWith("Very long"));
    expect(drawn).toBeDefined();
    expect(drawn!.endsWith("…")).toBe(true);
    expect(drawn!.length).toBeLessThan(long.length);
  });
});

describe("scaleBar", () => {
  const isNice = (n: number) => {
    const mantissa = n / 10 ** Math.floor(Math.log10(n));
    return [1, 2, 5].some((m) => Math.abs(mantissa - m) < 1e-9);
  };

  it("gives a 1/2/5 × 10^n distance whose length on the page is that distance", () => {
    for (const metersPerPoint of [0.07, 1, 3.3, 13.9, 250, 4800, 61000]) {
      const bar = scaleBar(metersPerPoint, 100, "metric");
      expect(isNice(bar.meters), `${metersPerPoint} m/pt`).toBe(true);
      expect(bar.lengthPt * metersPerPoint).toBeCloseTo(bar.meters, 6);
      // Largest nice step that fits: within the limit, and the next step up
      // (at most 2.5× larger) would not fit.
      expect(bar.lengthPt).toBeLessThanOrEqual(100);
      expect(bar.lengthPt).toBeGreaterThan(100 / 2.5);
    }
  });

  it("labels metres below a kilometre and kilometres from there up", () => {
    expect(scaleBar(5, 100, "metric").label).toBe("500 m");
    expect(scaleBar(13.9, 100, "metric").label).toBe("1 km");
    expect(scaleBar(250, 100, "metric").label).toBe("20 km");
  });

  it("labels feet below a mile and miles from there up", () => {
    // 100 pt × 13.9 m/pt = 1390 m = 4560 ft: under a mile, so feet.
    const feet = scaleBar(13.9, 100, "imperial");
    expect(feet.label).toBe("2,000 ft");
    expect(feet.lengthPt * 13.9).toBeCloseTo(2000 * 0.3048, 6);
    // 100 pt × 250 m/pt = 25 km = 15.5 mi.
    const miles = scaleBar(250, 100, "imperial");
    expect(miles.label).toBe("10 mi");
    expect(miles.lengthPt * 250).toBeCloseTo(10 * 1609.344, 6);
  });
});

describe("scaleRatioLabel", () => {
  it("states the representative fraction at 100% print size, to 3 figures", () => {
    // 1 pt is 0.0254 / 72 m of paper; 13.888… m of ground per pt is 1:39,370.
    expect(scaleRatioLabel(10_000 / 720)).toBe("1:39,400");
  });
});

describe("scaleUnitsForLocale", () => {
  it("adds feet and miles for the United States only", () => {
    expect(scaleUnitsForLocale("en-US")).toBe("metric+imperial");
    expect(scaleUnitsForLocale("es-US")).toBe("metric+imperial");
    expect(scaleUnitsForLocale("en-GB")).toBe("metric");
    expect(scaleUnitsForLocale("fr")).toBe("metric");
  });
});

describe("exportPDF — scale", () => {
  // VIEW is 14,400 m across. On letter landscape the map is 720 pt wide (the
  // page less two 36 pt margins; the view's 2:1 shape is limited by width), so
  // one point is 20 m and a bar of at most 100 pt shows 2 km.
  it("prints a scale bar measured from the view", async () => {
    const pdf = await readPdf(await exportPDF(printOptions()));
    expect(pdf.pages[0].images[0].width).toBeCloseTo(720, 6);
    const texts = pdf.pages[0].texts;
    expect(texts).toContain("2 km");
    expect(texts).toContain(`${scaleRatioLabel(20)} at 100% print size`);
    expect(texts.join(" ")).not.toMatch(/ ft|mi\b/);
  });

  it("adds a feet-and-miles bar when asked", async () => {
    const pdf = await readPdf(
      await exportPDF(printOptions({ units: "metric+imperial" })),
    );
    // 100 pt × 20 m = 2000 m = 6562 ft: over a mile, so miles; 1 mi fits.
    expect(pdf.pages[0].texts).toContain("1 mi");
  });
});

// ---------------------------------------------------------------------------
// RT-4 — the north arrow turns with the camera.
//
// `cameraRotationDeg` is the screen rotation of geographic EAST, y-down, which
// is what `cameraRotation(map)` measures. The arrow draws NORTH, on a y-up
// page. Two frame flips sit between the input and the output and each one is a
// chance to be off by a sign, so these tests check the direction the arrow
// actually points rather than the rotation it was handed.
// ---------------------------------------------------------------------------

/** Direction from the arrow's centre to its tip, as a unit vector. */
function tipDirection(cameraRotationDeg: number): { x: number; y: number } {
  const { tip } = northArrowGeometry(100, 200, cameraRotationDeg);
  const dx = tip.x - 100;
  const dy = tip.y - 200;
  const len = Math.hypot(dx, dy);
  return { x: dx / len, y: dy / len };
}

describe("northArrowGeometry", () => {
  it("points straight up the page on a north-up export", () => {
    const dir = tipDirection(0);
    expect(dir.x).toBeCloseTo(0, 12);
    expect(dir.y).toBeCloseTo(1, 12);
  });

  it("omitting the rotation is the same as passing 0", () => {
    expect(northArrowGeometry(100, 200)).toEqual(
      northArrowGeometry(100, 200, 0),
    );
  });

  it("points where north actually went, for the rotation the camera measured", () => {
    // With east measured at `r` on screen (y-down), north on screen is
    // `(sin r, -cos r)`, which on a y-up page is `(sin r, cos r)`. Deriving the
    // expectation from `r` independently of the implementation is the point: a
    // flipped sign inside cannot flip the expectation with it.
    for (const deg of [-150, -90, -37, 25, 90, 175]) {
      const r = (deg * Math.PI) / 180;
      const dir = tipDirection(deg);
      expect(dir.x, `east at ${deg} deg`).toBeCloseTo(Math.sin(r), 12);
      expect(dir.y, `east at ${deg} deg`).toBeCloseTo(Math.cos(r), 12);
    }
  });

  it("turns the arrow rigidly — the shaft stays straight and keeps its length", () => {
    const { tail, tip, label } = northArrowGeometry(100, 200, 63);
    // Tail and tip stay on opposite sides of the centre, 18pt apart.
    expect(Math.hypot(tip.x - tail.x, tip.y - tail.y)).toBeCloseTo(18, 12);
    expect((tip.x + tail.x) / 2).toBeCloseTo(100, 12);
    expect((tip.y + tail.y) / 2).toBeCloseTo(200, 12);
    // The "N" rides past the tip along the same line, not back to page-up.
    const shaft = { x: tip.x - tail.x, y: tip.y - tail.y };
    const toLabel = { x: label.x - tip.x, y: label.y - tip.y };
    const cross = shaft.x * toLabel.y - shaft.y * toLabel.x;
    expect(cross).toBeCloseTo(0, 10);
    expect(shaft.x * toLabel.x + shaft.y * toLabel.y).toBeGreaterThan(0);
  });

  it("a full turn comes back to where it started", () => {
    const a = northArrowGeometry(100, 200, 17);
    const b = northArrowGeometry(100, 200, 17 + 360);
    expect(b.tip.x).toBeCloseTo(a.tip.x, 10);
    expect(b.tip.y).toBeCloseTo(a.tip.y, 10);
  });

  it("draws the N on the page whatever the rotation", async () => {
    const pdf = await readPdf(
      await exportPDF(printOptions({ cameraRotationDeg: 47 })),
    );
    expect(pdf.pages[0].texts).toContain("N");
  });
});
