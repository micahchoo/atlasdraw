/**
 * Two-finger twist — the last of the three claims the rotation wave shipped on
 * and nobody had run.
 *
 * The other two were settled in `map-rotation.spec.ts`: the compass is
 * clickable where it sits, and a turned map draws its annotations turned. This
 * one stayed open because it needs real multi-touch, and Playwright's
 * `page.touchscreen` only taps. So it goes through CDP
 * `Input.dispatchTouchEvent`, which means chromium only — the other browser
 * projects skip rather than pretend.
 *
 * **The gesture is gated on the hand tool, and that is the finding.**
 * `enableCameraRotation` turns rotation on at the MapLibre end
 * (`touchZoomRotate.enableRotation()`), but the gesture still has to *reach*
 * MapLibre through the Excalidraw plate. The plate is `pointer-events: none`
 * only when `classifyTool` says the active tool is map-interactive, and
 * `classifyTool` is `toolType !== "hand"` — so under the **default selection
 * tool the plate is opaque and no touch, and no mouse drag either, reaches the
 * camera at all**. The first test below pins that; the rest pick up the hand
 * tool first, because that is the state the gesture exists in.
 *
 * Deliberately not asserted: the exact degrees. MapLibre's
 * `TwoFingersTouchRotateHandler` applies a threshold before it engages and does
 * not map finger rotation 1:1 onto bearing — a 90° twist measures ~82°. Pinning
 * a number would test MapLibre's tuning rather than our wiring. What has to be
 * true is that the twist reaches the camera, turns it the way the fingers went,
 * and leaves the annotation consistent with the new camera.
 */

import { test, expect } from "@playwright/test";

import type { Page } from "@playwright/test";

interface GeoBbox {
  kind: string;
  west: number;
  east: number;
  north: number;
  south: number;
}

interface AtlasdrawWindow {
  __atlasdraw__?: {
    map: {
      getBearing: () => number;
      getCenter: () => { lng: number; lat: number };
      project: (lngLat: [number, number]) => { x: number; y: number };
    };
    excalidrawAPI: {
      setActiveTool: (tool: { type: string }) => void;
      getSceneElements: () => ReadonlyArray<{
        isDeleted?: boolean;
        x: number;
        y: number;
        width: number;
        height: number;
        angle?: number;
        customData?: { geo?: GeoBbox };
      }>;
    };
  };
}

test.use({ hasTouch: true });

test.describe("map rotation — two-finger twist", () => {
  test.skip(
    ({ browserName }) => browserName !== "chromium",
    "multi-touch needs CDP Input.dispatchTouchEvent",
  );

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

  /** The state the map gestures live in. See the header. */
  async function pickUpHandTool(page: Page) {
    await page.evaluate(() =>
      (
        window as unknown as AtlasdrawWindow
      ).__atlasdraw__!.excalidrawAPI.setActiveTool({ type: "hand" }),
    );
    await page.waitForTimeout(400);
    await expect(page.locator('[class*="excalidrawLayer"]').first()).toHaveCSS(
      "pointer-events",
      "none",
    );
  }

  async function mapCentre(page: Page) {
    const box = await page
      .locator(".maplibregl-canvas-container")
      .first()
      .boundingBox();
    if (!box) {
      throw new Error("map canvas container has no box");
    }
    return { cx: box.x + box.width / 2, cy: box.y + box.height / 2 };
  }

  /**
   * Two fingers on the map, rotated `degrees` about their midpoint.
   *
   * Screen coordinates are y-down, so a positive `degrees` is a clockwise
   * twist. Both points move every frame — a twist with one finger planted
   * reads as a drag to some handlers, and we want the gesture a user makes.
   */
  async function twist(page: Page, degrees: number) {
    const { cx, cy } = await mapCentre(page);
    const radius = 160;
    const at = (angleDeg: number) => {
      const r = (angleDeg * Math.PI) / 180;
      return [
        { x: cx + radius * Math.cos(r), y: cy + radius * Math.sin(r), id: 1 },
        { x: cx - radius * Math.cos(r), y: cy - radius * Math.sin(r), id: 2 },
      ];
    };

    const cdp = await page.context().newCDPSession(page);
    await cdp.send("Input.dispatchTouchEvent", {
      type: "touchStart",
      touchPoints: at(0),
    });
    const STEPS = 24;
    for (let i = 1; i <= STEPS; i++) {
      await cdp.send("Input.dispatchTouchEvent", {
        type: "touchMove",
        touchPoints: at((degrees * i) / STEPS),
      });
      await page.waitForTimeout(16);
    }
    await cdp.send("Input.dispatchTouchEvent", {
      type: "touchEnd",
      touchPoints: [],
    });
    await cdp.detach();
    await page.waitForTimeout(1200);
  }

  /**
   * Camera and annotation, measured the way `map-rotation.spec.ts` measures
   * them: the screen angle of geographic east off the live projection, never
   * `getBearing()`, so a backwards convention cannot pass by agreeing with
   * itself.
   */
  function measure(page: Page) {
    return page.evaluate(() => {
      const w = window as unknown as AtlasdrawWindow;
      const map = w.__atlasdraw__!.map;
      const els = w
        .__atlasdraw__!.excalidrawAPI.getSceneElements()
        .filter((e) => !e.isDeleted);

      const c = map.getCenter();
      const a = map.project([c.lng - 0.02, c.lat]);
      const b = map.project([c.lng + 0.02, c.lat]);
      const eastDeg = (Math.atan2(b.y - a.y, b.x - a.x) * 180) / Math.PI;

      const el = els[0];
      let cornerErrPx: number | null = null;
      if (el?.customData?.geo?.kind === "bbox") {
        const geo = el.customData.geo;
        const ang = el.angle ?? 0;
        const ecx = el.x + el.width / 2;
        const ecy = el.y + el.height / 2;
        const corner = (dx: number, dy: number) => ({
          x: ecx + dx * Math.cos(ang) - dy * Math.sin(ang),
          y: ecy + dx * Math.sin(ang) + dy * Math.cos(ang),
        });
        const hw = el.width / 2;
        const hh = el.height / 2;
        const drawn = [
          corner(-hw, -hh),
          corner(hw, -hh),
          corner(hw, hh),
          corner(-hw, hh),
        ];
        const truth = [
          map.project([geo.west, geo.north]),
          map.project([geo.east, geo.north]),
          map.project([geo.east, geo.south]),
          map.project([geo.west, geo.south]),
        ];
        cornerErrPx = Math.max(
          ...drawn.map((d, i) =>
            Math.hypot(d.x - truth[i]!.x, d.y - truth[i]!.y),
          ),
        );
      }
      return {
        eastDeg,
        count: els.length,
        elAngleDeg: el ? ((el.angle ?? 0) * 180) / Math.PI : null,
        cornerErrPx,
      };
    });
  }

  test("under the default selection tool the plate swallows the gesture", async ({
    page,
  }) => {
    await waitForApp(page);
    expect((await measure(page)).eastDeg).toBeCloseTo(0, 4);

    await twist(page, 90);

    // Not a bug report — the shipped gate. Recorded because it is the whole
    // reason the tests below pick up a tool first, and because if the gate
    // ever moves off `classifyTool`, this is the line that says so.
    expect(
      (await measure(page)).eastDeg,
      "twist reached the camera without the hand tool",
    ).toBeCloseTo(0, 4);
    await expect(page.getByTestId("map-compass")).not.toHaveAttribute(
      "data-rotated",
      "true",
    );
  });

  test("with the hand tool the twist reaches the camera through the plate", async ({
    page,
  }) => {
    await waitForApp(page);
    await pickUpHandTool(page);

    await twist(page, 90);

    // Failing here means the gesture never got to MapLibre — not that the
    // rotation math is wrong. The plate and `enableCameraRotation` are two
    // subsystems that have to agree and neither one's source mentions the other.
    expect(
      Math.abs((await measure(page)).eastDeg),
      "twist did not reach the camera",
    ).toBeGreaterThan(5);
    await expect(page.getByTestId("map-compass")).toHaveAttribute(
      "data-rotated",
      "true",
    );
  });

  test("the camera turns the way the fingers went", async ({ page }) => {
    await waitForApp(page);
    await pickUpHandTool(page);

    await twist(page, 90);
    const clockwise = (await measure(page)).eastDeg;

    await page.getByTestId("map-compass").click();
    await page.waitForTimeout(1200);
    expect((await measure(page)).eastDeg).toBeCloseTo(0, 4);

    await twist(page, -90);
    const anticlockwise = (await measure(page)).eastDeg;

    // Screen y-down: a clockwise twist must carry east clockwise, i.e. to a
    // positive screen angle. Asserting the direction rather than the magnitude
    // keeps this a test of our wiring instead of MapLibre's gesture tuning —
    // and a convention that is consistently backwards fails both lines.
    expect(clockwise, "clockwise twist").toBeGreaterThan(5);
    expect(anticlockwise, "anticlockwise twist").toBeLessThan(-5);
  });

  test("an annotation stays glued through a twist", async ({ page }) => {
    await waitForApp(page);
    await page.locator('[title*="Rectangle" i]').first().click();
    await page.waitForTimeout(250);
    await page.mouse.move(560, 260);
    await page.mouse.down();
    await page.mouse.move(800, 400, { steps: 12 });
    await page.mouse.up();
    await page.keyboard.press("Escape");
    await page.waitForTimeout(1500);
    expect((await measure(page)).count).toBe(1);

    await pickUpHandTool(page);
    await twist(page, 90);

    // The crash this wave shipped was reachable from any rotation path, so the
    // touch path gets the same survival and geometry checks the keyboard one
    // does — through a gesture no unit test can synthesise.
    const after = await measure(page);
    expect(after.count, "the drawing survived the twist").toBe(1);
    expect(
      Math.abs(after.eastDeg),
      "the camera actually turned",
    ).toBeGreaterThan(5);
    expect(
      after.elAngleDeg,
      "the annotation turned with the camera",
    ).toBeCloseTo(after.eastDeg, 4);
    expect(
      after.cornerErrPx,
      "corners land on the projected bbox",
    ).toBeLessThan(1);
  });
});
