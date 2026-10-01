/**
 * Ctrl+0 and the zoom readout on a map.
 *
 * Excalidraw's "reset zoom" is its 100%. In world coordinates
 * (docs/architecture/adr/0015-world-coordinates-gate.md) that is map zoom 22, so the map routes it: Ctrl+0 frames everything drawn, as
 * zoom-to-fit does, and does nothing on an empty drawing. The only zoom
 * readout is the status bar's map zoom; Excalidraw's percentage control is
 * not rendered in the collar shell.
 */

import { test, expect } from "@playwright/test";

import type { Page } from "@playwright/test";

interface AtlasdrawWindow {
  __atlasdraw__?: {
    map: {
      getZoom: () => number;
      jumpTo: (o: { zoom: number }) => void;
      getContainer: () => HTMLElement;
    };
  };
}

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

const resetZoom = async (page: Page) => {
  // Focus in the drawing: Excalidraw's own action takes the key.
  await page.locator(".excalidraw").first().focus();
  await page.keyboard.press("ControlOrMeta+0");
  await page.waitForTimeout(1200);
};

test.describe("reset zoom on a map", () => {
  test("Ctrl+0 frames the drawing, not zoom 22", async ({ page }) => {
    await waitForApp(page);
    await page.locator('[title*="Rectangle" i]').first().click();
    await page.mouse.move(560, 300);
    await page.mouse.down();
    await page.mouse.move(700, 400, { steps: 8 });
    await page.mouse.up();
    await page.keyboard.press("Escape");
    const drawnAt = await mapZoom(page);

    // Zoom far out, then reset: the camera comes back to the rectangle.
    await page.evaluate((z) => {
      (window as unknown as AtlasdrawWindow).__atlasdraw__!.map.jumpTo({
        zoom: z,
      });
    }, drawnAt - 4);
    await resetZoom(page);
    const after = await mapZoom(page);
    // The fit puts the 140 x 100 px rectangle in the map less 64 px padding
    // a side (lib/fitMapToContent.ts).
    const box = await page.evaluate(() => {
      const c = (
        window as unknown as AtlasdrawWindow
      ).__atlasdraw__!.map.getContainer();
      return { width: c.clientWidth, height: c.clientHeight };
    });
    const expected =
      drawnAt +
      Math.log2(Math.min((box.width - 128) / 140, (box.height - 128) / 100));
    expect(
      Math.abs(after - expected),
      `map zoom ${after}, fit ${expected}`,
    ).toBeLessThan(0.3);
  });

  test("Ctrl+0 on an empty drawing leaves the camera", async ({ page }) => {
    await waitForApp(page);
    const before = await mapZoom(page);
    await resetZoom(page);
    expect(await mapZoom(page)).toBeCloseTo(before, 6);
  });

  test("the zoom readout is the map's zoom; no percentage is shown", async ({
    page,
  }) => {
    await waitForApp(page);
    const z = await mapZoom(page);
    await expect(page.getByTestId("status-bar-zoom")).toContainText(
      z.toFixed(1),
    );
    await expect(page.locator(".zoom-actions")).toHaveCount(0);
  });
});
