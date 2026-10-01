/**
 * Renaming an annotation layer, in a real browser.
 *
 * The unit tests prove the store guard and the panel's editor separately. What
 * only a browser can show is the two of them against the *real* chain — scene
 * change → generateLayerLabel reads the shape's position through the world
 * frame → "Rectangle near 20.8°N, 73.4°E" in the panel. That chain is what
 * made the naive version of this feature silently lose renames: it re-runs on
 * every scene change, so a rename survived only until the shape next moved.
 *
 * Shapes go in through `updateScene` rather than a pointer drag. The drag path
 * is unreliable headless, and it is not what these tests are about. Everything after
 * the injection is the app's own machinery, unmocked.
 */

import { test, expect } from "@playwright/test";

interface SceneElement {
  id: string;
  type: string;
}

interface AtlasdrawWindow {
  __atlasdraw__?: {
    excalidrawAPI: {
      getSceneElements: () => ReadonlyArray<SceneElement>;
      getAppState: () => {
        scrollX: number;
        scrollY: number;
        zoom: { value: number };
      };
      updateScene: (opts: { elements: ReadonlyArray<unknown> }) => void;
      toggleSidebar: (opts: { name: string; tab?: string }) => void;
    };
  };
}

const RECT_ID = "e2e-rect-1";

/**
 * A minimal but complete Excalidraw rectangle, sized in screen pixels. Its
 * scene coordinates are set where it is put (putRectangle).
 */
function rectangleAt(x: number, y: number) {
  return {
    id: RECT_ID,
    type: "rectangle",
    x,
    y,
    width: 160,
    height: 120,
    angle: 0,
    strokeColor: "#1e1e1e",
    backgroundColor: "transparent",
    fillStyle: "solid",
    strokeWidth: 2,
    strokeStyle: "solid",
    roughness: 1,
    opacity: 100,
    groupIds: [],
    frameId: null,
    roundness: null,
    seed: 1,
    version: 1,
    versionNonce: 1,
    isDeleted: false,
    boundElements: null,
    updated: 1,
    link: null,
    locked: false,
    index: "a0",
  };
}

async function waitForApp(page: import("@playwright/test").Page) {
  // A fresh profile gets the first-run onboarding, whose scrim covers the
  // sidebar and swallows every click in it. Set the flag OnboardingTips reads
  // (its STORAGE_KEY) before the app boots, not after.
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

async function putRectangle(
  page: import("@playwright/test").Page,
  x: number,
  y: number,
) {
  // (x, y) and the size are screen pixels: the scene is the world, so they
  // go through the viewport the camera bridge set.
  await page.evaluate((el) => {
    const api = (window as unknown as AtlasdrawWindow).__atlasdraw__
      ?.excalidrawAPI;
    if (!api) {
      return;
    }
    const { scrollX, scrollY, zoom } = api.getAppState();
    const z = zoom.value;
    // Moving a shape keeps everything else on it (its user label included).
    const existing = api.getSceneElements().find((e) => e.id === el.id);
    api.updateScene({
      elements: [
        {
          ...el,
          ...existing,
          x: el.x / z - scrollX,
          y: el.y / z - scrollY,
          width: el.width / z,
          height: el.height / z,
          strokeWidth: el.strokeWidth / z,
          // A real move raises the version; the panel follows versions.
          version: el.version + Date.now(),
        },
      ],
    });
  }, rectangleAt(x, y));
  await page.waitForFunction(
    (id) => {
      const w = window as unknown as AtlasdrawWindow;
      return (
        w.__atlasdraw__?.excalidrawAPI
          .getSceneElements()
          .some((e) => e.id === id) ?? false
      );
    },
    RECT_ID,
    { timeout: 10_000 },
  );
}

async function openLayersTab(page: import("@playwright/test").Page) {
  await page.evaluate(() => {
    const w = window as unknown as AtlasdrawWindow;
    w.__atlasdraw__?.excalidrawAPI.toggleSidebar({
      name: "default",
      tab: "layers",
    });
  });
  await expect(page.locator('[data-testid="layer-panel-body"]')).toBeAttached({
    timeout: 5_000,
  });
}

async function startRename(page: import("@playwright/test").Page) {
  // The name is an inert label since 7de0ea6 (a row click selects); the ⋯
  // menu's "Rename…" is the door into the editor.
  await page.locator(`[data-testid="layer-menu-${RECT_ID}"]`).click();
  await page.locator(`[data-testid="layer-rename-${RECT_ID}"]`).click();
}

test.describe("LayerPanel — annotation rename", () => {
  test("a renamed annotation keeps its name when the shape moves", async ({
    page,
  }) => {
    await waitForApp(page);
    await putRectangle(page, 400, 300);
    await openLayersTab(page);

    const name = page.locator(`[data-testid="layer-name-${RECT_ID}"]`);
    // The generated name, geo segment and all — the thing being replaced.
    await expect(name).toContainText("Rectangle near");

    await startRename(page);
    const input = page.locator(`[data-testid="layer-rename-input-${RECT_ID}"]`);
    await expect(input).toBeFocused();
    await input.fill("Ward 3");
    await input.press("Enter");
    await expect(name).toHaveText("Ward 3");

    // Move it far enough that the generator would produce a *different*
    // "near …" string — so a label that survives is the guard working, not two
    // coincidentally equal generated names.
    await putRectangle(page, 900, 600);
    await page.waitForTimeout(1000);
    await expect(name).toHaveText("Ward 3");
  });

  test("the generated name follows the shape when it moves", async ({
    page,
  }) => {
    await waitForApp(page);
    await putRectangle(page, 400, 300);
    await openLayersTab(page);

    const name = page.locator(`[data-testid="layer-name-${RECT_ID}"]`);
    await expect(name).toContainText("Rectangle near");
    const before = await name.textContent();

    // Far enough across the map for the one-decimal "near" text to change.
    await page.evaluate(() => {
      const w = window as unknown as {
        __atlasdraw__: { map: { panBy: (o: [number, number]) => void } };
      };
      w.__atlasdraw__.map.panBy([-600, -400]);
    });
    await page.waitForTimeout(500);
    await putRectangle(page, 400, 300);

    await expect(name).toContainText("Rectangle near");
    await expect(name).not.toHaveText(before ?? "");
  });

  test("Escape leaves the generated name alone", async ({ page }) => {
    await waitForApp(page);
    await putRectangle(page, 400, 300);
    await openLayersTab(page);

    const name = page.locator(`[data-testid="layer-name-${RECT_ID}"]`);
    const before = await name.textContent();

    await startRename(page);
    const input = page.locator(`[data-testid="layer-rename-input-${RECT_ID}"]`);
    await input.fill("oops");
    await input.press("Escape");

    await expect(name).toHaveText(before ?? "");
    // Escape cancelled the rename, not the sidebar it lives in.
    await expect(
      page.locator('[data-testid="layer-panel-body"]'),
    ).toBeVisible();
  });
});
