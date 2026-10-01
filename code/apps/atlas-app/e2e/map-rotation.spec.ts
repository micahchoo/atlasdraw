/**
 * What rotating the map actually does, in a real browser.
 *
 * A unit suite cannot see a loop that runs between two onChange consumers.
 * Such a loop is a measured hazard here: turn the map with a rectangle on it,
 * React hits its nested-update ceiling, the ErrorBoundary recreates the tree,
 * and the user's drawing is gone. World coordinates
 * (docs/architecture/adr/0015-world-coordinates-gate.md) take the camera work
 * out of both consumers: a turn is a CSS rotation of the drawing layer and
 * writes no element. This file is the part that only a browser settles.
 *
 * Three claims live here. Each is easy to argue from source and get partly
 * wrong:
 *
 *   1. The compass is reachable and a turned map keeps its annotations.
 *   2. A turned map draws its annotations turned — *correctly*, not merely at
 *      some angle. Checked by drawing the element's four corners through
 *      Excalidraw's viewport and the canvas's computed CSS transform, and
 *      comparing them against `map.project` of the corners' lng/lat. Nothing
 *      else distinguishes "rotated" from "rotated the wrong way".
 *   3. The bearing sign. `setCameraRotation` writes a bearing and
 *      `useCameraRotation` reads one; the drawing layer is turned by the
 *      latter. Unit tests check the sign against `FakeMercatorMap`, whose
 *      convention is a reading of the docs. Only real MapLibre settles it, and
 *      it is settled by measuring the screen angle of a due-east vector.
 *
 * Two-finger twist needs synthesised touch: see map-rotation-touch.spec.ts.
 */

import { test, expect } from "@playwright/test";

import { measureTurn } from "./helpers/rotation";

import type { Page } from "@playwright/test";

interface AtlasdrawWindow {
  __atlasdraw__?: {
    map: {
      getBearing: () => number;
      getCenter: () => { lng: number; lat: number };
      project: (lngLat: [number, number]) => { x: number; y: number };
    };
    excalidrawAPI: {
      getSceneElements: () => ReadonlyArray<{
        isDeleted?: boolean;
        type: string;
        x: number;
        y: number;
        width: number;
        height: number;
        angle?: number;
        points?: unknown;
      }>;
    };
  };
}

/**
 * Shapes whose geometry is a box hit the update loop; polylines never did.
 * "anchor" is the shape's kind of geometry: a box, or a polyline of points.
 */
const SHAPES = [
  { tool: "Rectangle", anchor: "bbox" },
  { tool: "Ellipse", anchor: "bbox" },
  { tool: "Line", anchor: "polyline" },
  { tool: "Arrow", anchor: "polyline" },
] as const;

async function waitForApp(page: Page) {
  await page.addInitScript(() => {
    localStorage.setItem("atlasdraw-onboarding-dismissed", "1");
  });
  await page.goto("/");
  await expect(page.getByTestId("onboarding-scrim")).toHaveCount(0);
  await page.waitForSelector(".maplibregl-canvas-container", {
    state: "attached",
    timeout: 30_000,
  });
  await page.waitForFunction(
    () => (window as unknown as AtlasdrawWindow).__atlasdraw__ != null,
    { timeout: 30_000 },
  );
  await page.waitForTimeout(2000);
}

/**
 * Collect the crash rather than assert on its absence indirectly.
 *
 * The failure is a React error boundary catch, so the page keeps running and
 * a naive "did it throw" check passes. The string is the only reliable signal.
 */
function watchForUpdateDepthCrash(page: Page): () => boolean {
  let crashed = false;
  const note = (text: string) => {
    if (/Maximum update depth/.test(text)) {
      crashed = true;
    }
  };
  page.on("console", (m) => {
    if (m.type() === "error") {
      note(m.text());
    }
  });
  page.on("pageerror", (e) => note(String(e)));
  return () => crashed;
}

async function draw(page: Page, tool: string) {
  await page.locator(`[title*="${tool}" i]`).first().click({ timeout: 10_000 });
  await page.waitForTimeout(250);
  await page.mouse.move(560, 260);
  await page.mouse.down();
  await page.mouse.move(800, 400, { steps: 12 });
  await page.mouse.up();
  await page.keyboard.press("Escape");
  await page.waitForTimeout(1500);
}

/** Shift+arrow off the compass — the mouse path is the drag, tested separately. */
async function rotateByKeyboard(page: Page, steps: number) {
  await page.getByTestId("map-compass").focus();
  for (let i = 0; i < steps; i++) {
    await page.keyboard.press("Shift+ArrowRight");
    await page.waitForTimeout(1200);
  }
}

function liveElements(page: Page) {
  return page.evaluate(() => {
    const w = window as unknown as AtlasdrawWindow;
    const els = (
      w.__atlasdraw__?.excalidrawAPI.getSceneElements() ?? []
    ).filter((e) => !e.isDeleted);
    return els.map((e) => ({
      type: e.type,
      anchor: e.points ? "polyline" : "bbox",
      angleDeg: Math.round((((e.angle ?? 0) * 180) / Math.PI) * 100) / 100,
    }));
  });
}

test.describe("map rotation", () => {
  for (const { tool, anchor } of SHAPES) {
    test(`rotating with a ${tool.toLowerCase()} (${anchor}) keeps the drawing`, async ({
      page,
    }) => {
      const crashed = watchForUpdateDepthCrash(page);
      await waitForApp(page);
      await draw(page, tool);

      expect(await liveElements(page)).toHaveLength(1);
      await rotateByKeyboard(page, 1);

      // Both halves matter. The crash string alone would pass if the element
      // vanished silently; the element count alone would pass if the boundary
      // caught and restored. Under the update loop, bbox anchors fail both.
      expect(crashed(), "React nested-update ceiling was hit").toBe(false);
      const after = await liveElements(page);
      expect(after, "the drawing survived the rotation").toHaveLength(1);
      expect(after[0]?.anchor).toBe(anchor);
      await expect(page.getByTestId("map-compass")).toHaveAttribute(
        "data-rotated",
        "true",
      );
    });
  }

  test("a turned map draws its annotations turned, and turned the right way", async ({
    page,
  }) => {
    await waitForApp(page);
    await draw(page, "Rectangle");

    for (const turns of [0, 1, 2, 3]) {
      if (turns > 0) {
        await rotateByKeyboard(page, 1);
      }

      const m = await measureTurn(page);

      // Claim 3 — the sign, against real MapLibre. A convention that is
      // consistently backwards passes every unit test and fails this line.
      expect(m.eastDeg, `east angle at ${turns} turns`).toBeCloseTo(
        -m.bearing,
        4,
      );
      // Claim 2 — the annotation turns with the camera, and lands on its
      // geography. 1px of slack for the browser's float path; the measured
      // error is 0.
      expect(m.elAngleDeg, `element angle at ${turns} turns`).toBeCloseTo(
        m.eastDeg,
        4,
      );
      expect(
        m.cornerErrPx,
        `corners land on the projected bbox at ${turns} turns`,
      ).toBeLessThan(1);
    }
  });

  test("the compass returns a turned map to north", async ({ page }) => {
    await waitForApp(page);
    await draw(page, "Rectangle");
    const compass = page.getByTestId("map-compass");

    await rotateByKeyboard(page, 1);
    await expect(compass).toHaveAttribute("data-rotated", "true");

    await compass.click();
    await page.waitForTimeout(1500);

    // The hazard is being turned with no way back, so this is the assertion
    // that matters: the state a user is stuck in must be exitable.
    await expect(compass).not.toHaveAttribute("data-rotated", "true");
    const els = await liveElements(page);
    expect(els).toHaveLength(1);
    expect(els[0]?.angleDeg).toBeCloseTo(0, 2);
  });
});
