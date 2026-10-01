/**
 * Two-finger pinch under a drawing tool zooms the map, not Excalidraw.
 *
 * Under the selection tool and every drawing tool the Excalidraw plate takes
 * pointer input, so a touch pinch reaches Excalidraw's own pinch handler
 * (`App.tsx#handleCanvasPointerMove`), which hands the new viewport to the
 * camera bridge. Excalidraw clamps its zoom to [0.1, 30]; the scene's zoom
 * value is 2^(z - 22) (docs/architecture/adr/0015-world-coordinates-gate.md),
 * so with that clamp the first frame of a pinch at map zoom 4 sends the map to
 * zoom 18.68. With `onZoomAction` set the fork leaves the zoom unclamped.
 *
 * Multi-touch needs CDP `Input.dispatchTouchEvent`, so chromium only.
 */

import { test, expect } from "@playwright/test";

import type { Page } from "@playwright/test";

interface AtlasdrawWindow {
  __atlasdraw__?: {
    map: { getZoom: () => number };
    excalidrawAPI: {
      setActiveTool: (tool: { type: string }) => void;
      getSceneElements: () => ReadonlyArray<{ isDeleted?: boolean }>;
    };
  };
}

test.use({ hasTouch: true });

test.describe("touch pinch under a drawing tool", () => {
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

  const mapZoom = (page: Page) =>
    page.evaluate(() =>
      (window as unknown as AtlasdrawWindow).__atlasdraw__!.map.getZoom(),
    );

  const liveElements = (page: Page) =>
    page.evaluate(
      () =>
        (window as unknown as AtlasdrawWindow)
          .__atlasdraw__!.excalidrawAPI.getSceneElements()
          .filter((e) => !e.isDeleted).length,
    );

  async function useTool(page: Page, type: string) {
    await page.evaluate(
      (t) =>
        (
          window as unknown as AtlasdrawWindow
        ).__atlasdraw__!.excalidrawAPI.setActiveTool({ type: t }),
      type,
    );
    await page.waitForTimeout(300);
    // The plate takes the input: this is the state the hazard lives in.
    await expect(page.locator('[class*="excalidrawLayer"]').first()).toHaveCSS(
      "pointer-events",
      "auto",
    );
  }

  /** Two fingers about the map centre, from `from` to `to` px apart. */
  async function pinch(page: Page, from: number, to: number) {
    const box = await page
      .locator(".maplibregl-canvas-container")
      .first()
      .boundingBox();
    if (!box) {
      throw new Error("map canvas container has no box");
    }
    const cx = box.x + box.width / 2;
    const cy = box.y + box.height / 2;
    const at = (gap: number) => [
      { x: cx - gap / 2, y: cy, id: 1 },
      { x: cx + gap / 2, y: cy, id: 2 },
    ];
    const cdp = await page.context().newCDPSession(page);
    await cdp.send("Input.dispatchTouchEvent", {
      type: "touchStart",
      touchPoints: at(from),
    });
    const STEPS = 20;
    for (let i = 1; i <= STEPS; i++) {
      await cdp.send("Input.dispatchTouchEvent", {
        type: "touchMove",
        touchPoints: at(from + ((to - from) * i) / STEPS),
      });
      await page.waitForTimeout(16);
    }
    await cdp.send("Input.dispatchTouchEvent", {
      type: "touchEnd",
      touchPoints: [],
    });
    await cdp.detach();
    await page.waitForTimeout(800);
  }

  for (const tool of ["selection", "rectangle"]) {
    test(`under the ${tool} tool, fingers twice as far apart zoom the map in one level`, async ({
      page,
    }) => {
      await waitForApp(page);
      await useTool(page, tool);
      const before = await mapZoom(page);
      const elements = await liveElements(page);

      await pinch(page, 120, 240);

      const after = await mapZoom(page);
      // log2(240 / 120) = 1. Not exact: the fingers' first frame sets the
      // start distance, and MapLibre settles the last frame.
      expect(after - before, `map zoom ${before} -> ${after}`).toBeGreaterThan(
        0.6,
      );
      expect(after - before, `map zoom ${before} -> ${after}`).toBeLessThan(
        1.4,
      );
      // The gesture drew nothing.
      expect(await liveElements(page)).toBe(elements);
    });
  }

  test("pinching in zooms the map out", async ({ page }) => {
    await waitForApp(page);
    await useTool(page, "selection");
    const before = await mapZoom(page);
    await pinch(page, 240, 120);
    const after = await mapZoom(page);
    expect(after - before, `map zoom ${before} -> ${after}`).toBeLessThan(-0.6);
    expect(after - before, `map zoom ${before} -> ${after}`).toBeGreaterThan(
      -1.4,
    );
  });
});
