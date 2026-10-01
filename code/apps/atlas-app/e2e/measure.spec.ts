/**
 * Measuring, in a real browser (W9).
 *
 * The unit tests run MeasureLayer on a fake Mercator map. Three things only a
 * browser settles:
 *
 *   1. The Measure tool takes clicks above the real drawing layer, on a map
 *      turned by real MapLibre, and the path it draws lies on the points that
 *      were clicked. London to Paris is 343.9 km on the ground (GeographicLib);
 *      the readout must say "344 km" whatever the bearing.
 *   2. The keys reach it: `m` turns it on, Escape off, ⌘K finds it.
 *   3. A shape drawn with Excalidraw's own tool shows its area and perimeter
 *      when selected, and the unit switch is remembered.
 */

import { test, expect } from "@playwright/test";

import { drawRectangle, openEditor, rectangleGeography } from "./helpers/atlas";

import type { Page } from "@playwright/test";

interface MeasureHook {
  __atlasdraw__: {
    map: {
      jumpTo: (o: {
        center: [number, number];
        zoom: number;
        bearing: number;
      }) => void;
      project: (lngLat: [number, number]) => { x: number; y: number };
      getContainer: () => HTMLElement;
    };
    excalidrawAPI: {
      getSceneElements: () => ReadonlyArray<{ id: string; type: string }>;
      getAppState: () => { selectedElementIds: Record<string, boolean> };
    };
  };
}

const LONDON: [number, number] = [-0.1278, 51.5074];
const PARIS: [number, number] = [2.3522, 48.8566];

async function jump(
  page: Page,
  lng: number,
  lat: number,
  zoom: number,
  bearing: number,
) {
  await page.evaluate(
    ({ lng, lat, zoom, bearing }) =>
      (window as unknown as MeasureHook).__atlasdraw__.map.jumpTo({
        center: [lng, lat],
        zoom,
        bearing,
      }),
    { lng, lat, zoom, bearing },
  );
  await page.waitForTimeout(300);
}

/** Viewport position of a lng/lat on the live map. */
async function screenOf(page: Page, p: [number, number]) {
  return page.evaluate((p) => {
    const map = (window as unknown as MeasureHook).__atlasdraw__.map;
    const r = map.getContainer().getBoundingClientRect();
    const s = map.project(p);
    return { x: s.x + r.left, y: s.y + r.top };
  }, p);
}

// Metric by locale: en-US would start in imperial units, as it should.
test.use({ locale: "en-GB" });

test.describe("Measuring", () => {
  test.beforeEach(async ({ page }) => {
    await openEditor(page);
  });

  test("the Measure tool measures London to Paris on a turned map and keeps it as a line", async ({
    page,
  }) => {
    await jump(page, 1, 50.2, 6.5, 30);
    await page.keyboard.press("m");
    await expect(page.getByTestId("measure-tool-button")).toHaveAttribute(
      "aria-pressed",
      "true",
    );
    await expect(page.getByTestId("measure-distance")).toHaveText(
      "Click the map to start",
    );

    const london = await screenOf(page, LONDON);
    const paris = await screenOf(page, PARIS);
    await page.mouse.click(london.x, london.y);
    await page.mouse.move(paris.x, paris.y, { steps: 4 });
    await expect(page.getByTestId("measure-distance")).toHaveText("344 km");
    await page.mouse.dblclick(paris.x, paris.y);
    await expect(page.getByTestId("measure-keep-line")).toBeVisible();
    await expect(page.getByTestId("measure-distance")).toHaveText("344 km");

    // The drawn path lies on the clicked points, on screen.
    const ends = await page.evaluate(() => {
      const line = document.querySelector(
        "[data-testid=measure-overlay] polyline",
      ) as SVGPolylineElement;
      const box = line.ownerSVGElement!.getBoundingClientRect();
      const pts = Array.from(line.points);
      return pts.map((p) => ({ x: p.x + box.left, y: p.y + box.top }));
    });
    expect(ends).toHaveLength(2);
    expect(Math.hypot(ends[0].x - london.x, ends[0].y - london.y)).toBeLessThan(
      2,
    );
    expect(Math.hypot(ends[1].x - paris.x, ends[1].y - paris.y)).toBeLessThan(
      2,
    );

    await page.getByTestId("measure-keep-line").click();
    await expect(page.getByTestId("measure-overlay")).toHaveCount(0);
    const kept = await page.evaluate(() => {
      const api = (window as unknown as MeasureHook).__atlasdraw__
        .excalidrawAPI;
      return {
        types: api.getSceneElements().map((e) => e.type),
        selected: Object.keys(api.getAppState().selectedElementIds),
        id: api.getSceneElements()[0]?.id,
      };
    });
    expect(kept.types).toEqual(["line"]);
    expect(kept.selected).toEqual([kept.id]);
    // Selected, the kept line reads what the tool read.
    await expect(page.getByTestId("measure-length")).toHaveText(
      "Length 344 km",
    );
  });

  test("Escape exits the tool, and ⌘K finds it", async ({ page }) => {
    await page.keyboard.press("m");
    await expect(page.getByTestId("measure-overlay")).toBeVisible();
    await page.keyboard.press("Escape");
    await expect(page.getByTestId("measure-overlay")).toHaveCount(0);

    await page.keyboard.press("ControlOrMeta+k");
    await page.keyboard.type("Measure");
    await page.keyboard.press("Enter");
    await expect(page.getByTestId("measure-tool-button")).toHaveAttribute(
      "aria-pressed",
      "true",
    );
  });

  test("a drawn rectangle shows its area and perimeter, and the unit switch is kept", async ({
    page,
  }) => {
    await jump(page, 2.35, 48.85, 13, 0);
    await drawRectangle(page, { x0: 500, y0: 300, x1: 760, y1: 460 });
    const geo = await rectangleGeography(page);
    expect(geo).toBeDefined();

    // Spherical estimate (R = 6,371,008.8 m); WGS84 differs by under 0.7%.
    const R = 6_371_008.8;
    const rad = Math.PI / 180;
    const want =
      R *
      R *
      (geo!.east - geo!.west) *
      rad *
      (Math.sin(geo!.north * rad) - Math.sin(geo!.south * rad));

    const area = page.getByTestId("measure-area");
    await expect(area).toHaveText(/^Area [\d.,]+ (m²|ha|km²)$/);
    const [, n, unit] = /^Area ([\d.,]+) (m²|ha|km²)$/.exec(
      (await area.textContent()) ?? "",
    )!;
    const got =
      Number(n.replace(/,/g, "")) *
      ({ "m²": 1, ha: 1e4, "km²": 1e6 } as const)[unit as "m²"];
    expect(Math.abs(got - want) / want).toBeLessThan(0.015);
    await expect(page.getByTestId("measure-perimeter")).toHaveText(
      /^Perimeter [\d.,]+ (m|km)$/,
    );

    await page.getByTestId("measure-units-button").click();
    await expect(area).toHaveText(/^Area [\d.,]+ (ft²|ac|mi²)$/);
    const stored = await page.evaluate(() =>
      localStorage.getItem("atlasdraw:measure:units"),
    );
    expect(stored).toBe("imperial");
  });
});
