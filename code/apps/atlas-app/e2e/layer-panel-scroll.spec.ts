/* eslint-disable no-console */
/**
 * The layer list must stay reachable as layers pile up.
 *
 * This exists because the unit tests for it cannot fail for the real defect.
 * jsdom does no layout and vitest injects no CSS modules or compiled SCSS, so
 * every assertion about whether the panel scrolls has to read stylesheet source
 * and check for literal declarations — which catches someone deleting one of
 * five lines and nothing else. It would not catch a `flex-shrink: 0` added
 * above the panel, a `height` reintroduced in the chain, an upstream merge
 * reordering the cascade, or a new capture-phase wheel handler.
 *
 * What actually shipped broken, before the fix, measured in this same browser:
 * `.sidebar` is `overflow: hidden` and nothing between it and LayerPanel's root
 * was a scroll port, so at 25 layers the content was 1309px in a 680px box with
 * 11 rows clipped away, and a wheel over the panel moved nothing because
 * useMapWheelRouter preventDefaulted every wheel in the app.
 *
 * Three assertions, each pinning one of those:
 *   1. a scroll port exists on the chain and the content overflows it
 *   2. the last layer can be reached — by wheel, which is the gesture that was
 *      impossible even after the port existed
 *   3. the open card's Apply button lands inside the panel
 *
 * Layers are created by dropping GeoJSON on the editor root, the same path
 * useDataFileImport's capture-phase listener serves, so this exercises import
 * too rather than seeding the store behind its back.
 */

import { test, expect, type Page } from "@playwright/test";

const LAYERS = 25;

interface AtlasdrawWindow {
  __atlasdraw__?: {
    map: { isStyleLoaded: () => boolean };
    excalidrawAPI: {
      toggleSidebar: (opts: { name: string; tab?: string }) => void;
    };
  };
}

function geojson(i: number): string {
  return JSON.stringify({
    type: "FeatureCollection",
    features: [
      {
        type: "Feature",
        properties: { name: `feature ${i}`, pop: 1000 + i },
        geometry: { type: "Point", coordinates: [-122.4 + i * 0.01, 37.77] },
      },
    ],
  });
}

async function waitForApp(page: Page) {
  await page.goto("/");
  await page.waitForSelector(".maplibregl-canvas-container", {
    state: "attached",
    timeout: 30_000,
  });
  await page.waitForFunction(
    () => (window as unknown as AtlasdrawWindow).__atlasdraw__ != null,
    { timeout: 30_000 },
  );
  await page.waitForTimeout(2000);
  // The onboarding scrim covers the app and swallows clicks.
  const skip = page.locator('[data-testid="onboarding-skip"]');
  if (await skip.count()) {
    await skip.click();
  }
}

async function dropLayer(page: Page, name: string, body: string) {
  await page.evaluate(
    ({ name, body }) => {
      const root = document.querySelector('[data-testid="map-editor-root"]');
      if (!root) {
        throw new Error("map-editor-root not found");
      }
      const dt = new DataTransfer();
      dt.items.add(new File([body], name, { type: "application/geo+json" }));
      for (const type of ["dragover", "drop"]) {
        root.dispatchEvent(
          new DragEvent(type, {
            dataTransfer: dt,
            bubbles: true,
            cancelable: true,
          }),
        );
      }
    },
    { name, body },
  );
}

/** Scroll geometry of the panel and of every ancestor up to the editor root. */
async function panelScrollState(page: Page) {
  return page.evaluate(() => {
    const body = document.querySelector('[data-testid="layer-panel-body"]');
    if (!body) {
      throw new Error("layer-panel-body not found");
    }
    let el: Element | null = body;
    let scrollPort: {
      cls: string;
      clientH: number;
      scrollH: number;
    } | null = null;
    while (el && el !== document.documentElement) {
      const overflowY = getComputedStyle(el).overflowY;
      if (
        (overflowY === "auto" || overflowY === "scroll") &&
        el.scrollHeight > el.clientHeight
      ) {
        scrollPort = {
          cls: String(el.className).slice(0, 40),
          clientH: el.clientHeight,
          scrollH: el.scrollHeight,
        };
        break;
      }
      el = el.parentElement;
    }
    return {
      scrollPort,
      scrollTop: (body as HTMLElement).scrollTop,
      maxScroll: body.scrollHeight - body.clientHeight,
      rows: document.querySelectorAll('[data-testid^="layer-row-header-"]')
        .length,
    };
  });
}

test.describe("layer panel at 25 layers", () => {
  test("scrolls, and the last layer is reachable by wheel", async ({
    page,
  }) => {
    await waitForApp(page);

    for (let i = 0; i < LAYERS; i += 1) {
      await dropLayer(
        page,
        `district-${String(i).padStart(2, "0")}-boundary.geojson`,
        geojson(i),
      );
      await page.waitForTimeout(120);
    }

    // The panel auto-opens on the first successful import; open it if not.
    if (
      (await page.locator('[data-testid="layer-panel-body"]').count()) === 0
    ) {
      await page.evaluate(() => {
        (
          window as unknown as AtlasdrawWindow
        ).__atlasdraw__?.excalidrawAPI.toggleSidebar({
          name: "default",
          tab: "layers",
        });
      });
    }
    const panel = page.locator('[data-testid="layer-panel-body"]');
    await expect(panel).toBeVisible();
    await expect(
      page.locator('[data-testid^="layer-row-header-"]'),
    ).toHaveCount(LAYERS);

    // 1. A scroll port exists, and the list overflows it — i.e. there is
    //    something to scroll and somewhere to scroll it.
    const before = await panelScrollState(page);
    expect(
      before.scrollPort,
      "no scrollable ancestor for the layer list",
    ).not.toBeNull();
    expect(before.maxScroll).toBeGreaterThan(0);

    // 2. A wheel over the panel scrolls it. This is the assertion that would
    //    have failed even with the scroll port in place, because the map wheel
    //    router claimed every wheel in the app.
    const box = await panel.boundingBox();
    if (!box) {
      throw new Error("panel has no bounding box");
    }
    await page.mouse.move(box.x + box.width / 2, box.y + box.height / 2);
    await page.mouse.wheel(0, 4000);
    await page.waitForTimeout(400);
    const after = await panelScrollState(page);
    expect(after.scrollTop).toBeGreaterThan(before.scrollTop);

    // The 25th layer is now on screen rather than clipped off the bottom.
    const last = page
      .locator('[data-testid^="layer-row-header-"]')
      .nth(LAYERS - 1);
    await expect(last).toBeInViewport();
  });

  test("the open card's Apply button lands inside the panel", async ({
    page,
  }) => {
    await waitForApp(page);
    for (let i = 0; i < LAYERS; i += 1) {
      await dropLayer(
        page,
        `district-${String(i).padStart(2, "0")}-boundary.geojson`,
        geojson(i),
      );
      await page.waitForTimeout(120);
    }
    await expect(
      page.locator('[data-testid="layer-panel-body"]'),
    ).toBeVisible();

    // The ninth of 25 — the case that opened below the fold with its Apply
    // button 22px past the sidebar's bottom edge.
    await page.locator('[data-testid^="layer-disclosure-"]').nth(8).click();
    await page.waitForTimeout(500);

    const apply = page.getByRole("button", { name: /^apply$/i }).first();
    await expect(apply).toBeVisible();

    const fits = await apply.evaluate((el) => {
      const sidebar = document.querySelector(".sidebar");
      if (!sidebar) {
        throw new Error(".sidebar not found");
      }
      const a = el.getBoundingClientRect();
      const s = sidebar.getBoundingClientRect();
      return { inside: a.top >= s.top && a.bottom <= s.bottom };
    });
    expect(fits.inside).toBe(true);
  });
});
