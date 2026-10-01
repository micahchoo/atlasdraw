/* eslint-disable no-console */
/**
 * "Stays glued" smoke.
 *
 * The load-bearing invariant: a drawn element has one place on Earth, and
 * it is drawn there at every camera. Under world coordinates
 * (docs/architecture/adr/0015-world-coordinates-gate.md) the
 * place is the element's scene x/y read through the document's world frame,
 * and a camera move changes only Excalidraw's viewport.
 *
 * Source-of-truth assertion: the element's lng/lat is byte-stable across pan
 * and zoom (its scene coordinates are not rewritten).
 * Position assertion: where the element is drawn on screen
 * ((x + scrollX) * zoom) is where `map.project` puts its lng/lat.
 *
 * Test A (pin) — the Atlas-side PinTool path; a pin is centred on its point.
 * Test B (rectangle) — Excalidraw's stock rectangle. The tool is chosen
 * through the API: a click on the plate does not focus Excalidraw, so a
 * typed `r` would not reach it.
 */

import { test, expect, type Page } from "@playwright/test";

import { skipOnboarding } from "./helpers/onboarding";

interface AtlasdrawWindow {
  __atlasdraw__?: {
    map: {
      isStyleLoaded: () => boolean;
      getZoom: () => number;
      zoomTo: (z: number, opts?: { duration?: number }) => unknown;
      panBy: (
        offset: [number, number],
        opts?: { duration?: number },
      ) => unknown;
      project: (lngLat: [number, number]) => { x: number; y: number };
    };
    excalidrawAPI: {
      getSceneElements: () => ReadonlyArray<SceneElement>;
      getAppState: () => {
        activeTool: { type: string };
        scrollX: number;
        scrollY: number;
        zoom: { value: number };
      };
      setActiveTool: (tool: { type: string }) => void;
    };
    frame: () => unknown;
    toLngLat: (
      frame: unknown,
      p: { x: number; y: number },
    ) => { lng: number; lat: number };
  };
}

interface SceneElement {
  id: string;
  type: string;
  x: number;
  y: number;
  width: number;
  height: number;
  customData?: { tool?: string };
}

/**
 * One element, measured: its place on Earth (the pin's centre, or the box's
 * NW and SE corners) and where those points are drawn on screen now.
 */
interface Measured {
  el: SceneElement;
  /** lng/lat of the measured points, from scene coordinates. */
  geo: Array<{ lng: number; lat: number }>;
  /** The same points on screen, through Excalidraw's viewport. */
  drawn: Array<{ x: number; y: number }>;
  /** The same lng/lats on screen, through the map. */
  projected: Array<{ x: number; y: number }>;
  zoom: number;
}

async function measure(
  page: Page,
  which: "pin" | "rectangle",
): Promise<Measured | undefined> {
  return page.evaluate((kind) => {
    const a = (window as unknown as AtlasdrawWindow).__atlasdraw__!;
    const el = a.excalidrawAPI
      .getSceneElements()
      .find((e) =>
        kind === "pin" ? e.customData?.tool === "pin" : e.type === kind,
      );
    if (!el) {
      return undefined;
    }
    const pts =
      kind === "pin"
        ? [{ x: el.x + el.width / 2, y: el.y + el.height / 2 }]
        : [
            { x: el.x, y: el.y },
            { x: el.x + el.width, y: el.y + el.height },
          ];
    const frame = a.frame();
    const { scrollX, scrollY, zoom } = a.excalidrawAPI.getAppState();
    const geo = pts.map((p) => a.toLngLat(frame, p));
    return {
      el,
      geo,
      drawn: pts.map((p) => ({
        x: (p.x + scrollX) * zoom.value,
        y: (p.y + scrollY) * zoom.value,
      })),
      projected: geo.map((g) => a.map.project([g.lng, g.lat])),
      zoom: a.map.getZoom(),
    };
  }, which);
}

/** Largest distance between where a point is drawn and where the map puts it. */
function drift(m: Measured): number {
  return Math.max(
    ...m.drawn.map((d, i) =>
      Math.hypot(d.x - m.projected[i].x, d.y - m.projected[i].y),
    ),
  );
}

/** Wait until the dev-only window expose is populated AND the map style loads. */
async function waitForAtlasdrawReady(page: Page): Promise<void> {
  await page.waitForFunction(
    () => {
      const w = window as unknown as AtlasdrawWindow;
      return Boolean(
        w.__atlasdraw__?.map &&
          w.__atlasdraw__.excalidrawAPI &&
          w.__atlasdraw__.map.isStyleLoaded(),
      );
    },
    undefined,
    { timeout: 15_000 },
  );
  // Small settle for first render frame after style-loaded.
  await page.waitForTimeout(250);
}

async function panBy(page: Page, dx: number, dy: number): Promise<void> {
  await page.evaluate(
    ([x, y]) => {
      const w = window as unknown as AtlasdrawWindow;
      w.__atlasdraw__?.map.panBy([x, y], { duration: 0 });
    },
    [dx, dy] as const,
  );
  await page.waitForTimeout(200);
}

async function zoomInOneLevel(page: Page): Promise<void> {
  await page.evaluate(() => {
    const m = (window as unknown as AtlasdrawWindow).__atlasdraw__!.map;
    m.zoomTo(m.getZoom() + 1, { duration: 0 });
  });
  await page.waitForTimeout(300);
}

async function placePin(page: Page, x: number, y: number): Promise<void> {
  await page.getByTestId("pin-tool-button").click();
  await expect(page.getByTestId("atlas-tool-overlay")).toBeVisible();
  await page.mouse.move(x, y);
  await page.mouse.down();
  await page.mouse.up();
  await expect(page.getByTestId("atlas-tool-overlay")).toBeHidden();
}

async function selectRectangleTool(page: Page): Promise<void> {
  await page.evaluate(() => {
    const w = window as unknown as AtlasdrawWindow;
    w.__atlasdraw__?.excalidrawAPI.setActiveTool({ type: "rectangle" });
  });
  await page.waitForTimeout(50);
}

async function dragRectangle(page: Page): Promise<void> {
  const startX = 500;
  const startY = 300;
  const endX = 700;
  const endY = 450;
  await page.mouse.move(startX, startY);
  await page.mouse.down();
  await page.mouse.move((startX + endX) / 2, (startY + endY) / 2, {
    steps: 5,
  });
  await page.mouse.move(endX, endY, { steps: 5 });
  await page.mouse.up();
  await page.waitForTimeout(300);
}

test.describe("geo foundation stays glued", () => {
  test.beforeEach(async ({ page }) => {
    await skipOnboarding(page);
  });

  test("pin stays glued during pan", async ({ page }) => {
    await page.goto("/");

    // The Pin button is one of the first pieces of MapEditor to render.
    await expect(page.getByTestId("pin-tool-button")).toBeVisible();
    await waitForAtlasdrawReady(page);

    await placePin(page, 640, 400);

    const pin1 = await measure(page, "pin");
    expect(pin1, "pin element should exist after click").toBeDefined();
    const geo1 = pin1!.geo[0];
    expect(Number.isFinite(geo1.lng)).toBe(true);
    expect(Number.isFinite(geo1.lat)).toBe(true);
    // The pin marks the clicked point: it is drawn where the map puts it.
    expect(drift(pin1!), "pin drawn on its lng/lat").toBeLessThan(1);

    // Pan east by 200px → the pin moves ~−200px on screen, geo unchanged.
    await panBy(page, 200, 0);

    const pin2 = await measure(page, "pin");
    expect(pin2, "pin should still exist after pan").toBeDefined();
    // Source of truth: lat/lng are byte-stable. (load-bearing assertion)
    expect(pin2!.geo[0].lng).toBe(geo1.lng);
    expect(pin2!.geo[0].lat).toBe(geo1.lat);
    // A pan writes no element.
    expect({ x: pin2!.el.x, y: pin2!.el.y }).toEqual({
      x: pin1!.el.x,
      y: pin1!.el.y,
    });

    const dx = pin2!.drawn[0].x - pin1!.drawn[0].x;
    const dy = pin2!.drawn[0].y - pin1!.drawn[0].y;
    expect(
      Math.abs(dx - -200),
      `expected the pin to shift ~−200px on screen, got ${dx}`,
    ).toBeLessThan(15);
    expect(
      Math.abs(dy),
      `expected screen-y to be stable for horizontal pan, got ${dy}`,
    ).toBeLessThan(15);
    expect(drift(pin2!), "pin drawn on its lng/lat after pan").toBeLessThan(1);
  });

  test("rectangle stays glued during pan", async ({ page }) => {
    await page.goto("/");

    await expect(page.getByTestId("pin-tool-button")).toBeVisible();
    await waitForAtlasdrawReady(page);

    await selectRectangleTool(page);
    await dragRectangle(page);

    const rect1 = await measure(page, "rectangle");
    expect(rect1, "the drag drew a rectangle").toBeDefined();
    const [nw1, se1] = rect1!.geo;
    expect(nw1.lng).toBeLessThan(se1.lng);
    expect(se1.lat).toBeLessThan(nw1.lat);

    await panBy(page, 200, 0);

    const rect2 = await measure(page, "rectangle");
    expect(rect2, "rectangle should still exist after pan").toBeDefined();

    // Source of truth: the box is unchanged.
    expect(rect2!.geo).toEqual(rect1!.geo);

    // Drawn position shifts by ~−200 in x.
    const dx = rect2!.drawn[0].x - rect1!.drawn[0].x;
    const dy = rect2!.drawn[0].y - rect1!.drawn[0].y;
    expect(
      Math.abs(dx - -200),
      `expected the box to shift ~−200px on screen, got ${dx}`,
    ).toBeLessThan(5);
    expect(
      Math.abs(dy),
      `expected screen-y to be stable for horizontal pan, got ${dy}`,
    ).toBeLessThan(5);
    expect(drift(rect2!), "box drawn on its lng/lat after pan").toBeLessThan(1);
  });

  // A zoom must not let a drawing drift where a pan does not. After a zoom,
  // each element must still be drawn where map.project puts its lng/lat, and
  // a box's drawn size must be its geographic span.

  test("pin stays glued during ZOOM", async ({ page }) => {
    await page.goto("/");
    await expect(page.getByTestId("pin-tool-button")).toBeVisible();
    await waitForAtlasdrawReady(page);

    await placePin(page, 640, 400);
    const pin1 = await measure(page, "pin");
    expect(pin1, "pin should exist after click").toBeDefined();

    await zoomInOneLevel(page);

    const pin2 = await measure(page, "pin");
    expect(pin2, "pin should still exist after zoom").toBeDefined();
    // Source of truth: geo must be unchanged.
    expect(pin2!.geo).toEqual(pin1!.geo);
    expect(pin2!.zoom).toBeCloseTo(pin1!.zoom + 1, 6);
    console.log(
      `[5afc-zoom-pin] drift after zoom ${drift(pin2!).toExponential(2)} px`,
    );
    expect(drift(pin2!), "pin drawn on its lng/lat after zoom").toBeLessThan(1);
  });

  test("rectangle stays glued during ZOOM", async ({ page }) => {
    await page.goto("/");
    await expect(page.getByTestId("pin-tool-button")).toBeVisible();
    await waitForAtlasdrawReady(page);

    await selectRectangleTool(page);
    await dragRectangle(page);

    const rect1 = await measure(page, "rectangle");
    expect(rect1, "the drag drew a rectangle").toBeDefined();

    // Zoom in by 1 level → 2x pixel density per degree.
    await zoomInOneLevel(page);

    const rect2 = await measure(page, "rectangle");
    expect(rect2, "rectangle should still exist after zoom").toBeDefined();

    // Source of truth: the box is unchanged.
    expect(rect2!.geo).toEqual(rect1!.geo);

    // Drawn width/height equal the projected span of NW and SE at the new
    // zoom, twice the drag.
    const [nw, se] = rect2!.projected;
    const [dnw, dse] = rect2!.drawn;
    const driftW = dse.x - dnw.x - (se.x - nw.x);
    const driftH = dse.y - dnw.y - (se.y - nw.y);
    console.log(
      `[5afc-zoom-rect] drawn=(${(dse.x - dnw.x).toFixed(1)},${(
        dse.y - dnw.y
      ).toFixed(1)}) driftWH=(${driftW.toFixed(3)},${driftH.toFixed(3)})`,
    );
    expect(
      Math.abs(dse.x - dnw.x - 2 * (rect1!.drawn[1].x - rect1!.drawn[0].x)),
      "one zoom level doubles the drawn width",
    ).toBeLessThan(2);
    expect(Math.abs(driftW), "width matches the geographic span").toBeLessThan(
      1,
    );
    expect(Math.abs(driftH), "height matches the geographic span").toBeLessThan(
      1,
    );
    expect(drift(rect2!), "box drawn on its lng/lat after zoom").toBeLessThan(
      1,
    );
  });

  // Interactive wheel zoom — the path the user actually uses.
  test("pin stays glued during INTERACTIVE wheel zoom", async ({ page }) => {
    await page.goto("/");
    await expect(page.getByTestId("pin-tool-button")).toBeVisible();
    await waitForAtlasdrawReady(page);

    await placePin(page, 640, 400);
    const pin1 = await measure(page, "pin");
    expect(pin1, "pin should exist").toBeDefined();

    // Switch to HAND tool first so Excalidraw layer goes pointer-events:none.
    await page.evaluate(() => {
      const w = window as unknown as AtlasdrawWindow;
      w.__atlasdraw__?.excalidrawAPI.setActiveTool({ type: "hand" });
    });
    await page.waitForTimeout(50);

    const beforeZoom = pin1!.zoom;
    // Mouse wheel zoom IN at (300,300) — well away from any UI buttons.
    await page.mouse.move(300, 300);
    for (let i = 0; i < 5; i++) {
      await page.mouse.wheel(0, -120);
      await page.waitForTimeout(40);
    }
    await page.waitForTimeout(500);

    const pin2 = await measure(page, "pin");
    expect(pin2, "pin should still exist").toBeDefined();
    if (Math.abs(pin2!.zoom - beforeZoom) < 0.1) {
      throw new Error(
        `wheel zoom did not change camera zoom (${beforeZoom} -> ${
          pin2!.zoom
        }). Means wheel events were captured by an overlay instead of MapLibre.`,
      );
    }
    expect(pin2!.geo).toEqual(pin1!.geo);
    console.log(`[5afc-wheel] drift ${drift(pin2!).toExponential(2)} px`);
    expect(
      drift(pin2!),
      "pin drawn on its lng/lat after wheel zoom",
    ).toBeLessThan(1);
  });

  // In DRAWING mode (selection/rectangle/etc.) the Excalidraw layer takes
  // pointer events; useMapWheelRouter must route the wheel to the map.
  test("pin stays glued during wheel zoom in DRAWING mode", async ({
    page,
  }) => {
    await page.goto("/");
    await expect(page.getByTestId("pin-tool-button")).toBeVisible();
    await waitForAtlasdrawReady(page);

    await placePin(page, 640, 400);
    await page.evaluate(() => {
      const w = window as unknown as AtlasdrawWindow;
      w.__atlasdraw__?.excalidrawAPI.setActiveTool({ type: "selection" });
    });
    await page.waitForTimeout(50);

    const pin1 = await measure(page, "pin");
    expect(pin1, "pin should exist").toBeDefined();

    await page.mouse.move(300, 300);
    for (let i = 0; i < 5; i++) {
      await page.mouse.wheel(0, -120);
      await page.waitForTimeout(40);
    }
    await page.waitForTimeout(500);

    const pin2 = await measure(page, "pin");
    console.log(
      `[5afc-drawing-wheel] zoom: ${pin1!.zoom.toFixed(
        2,
      )} -> ${pin2!.zoom.toFixed(2)}`,
    );
    expect(
      pin2!.zoom - pin1!.zoom,
      `wheel zoom in selection mode must change camera zoom — ` +
        `if 0, the wheel router fix is missing/regressed`,
    ).toBeGreaterThan(0.3);
    expect(pin2!.geo).toEqual(pin1!.geo);
    expect(
      drift(pin2!),
      "pin drawn on its lng/lat after drawing-mode wheel zoom",
    ).toBeLessThan(1);
  });
});
