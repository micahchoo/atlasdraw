/* eslint-disable no-console */
/**
 * LayerPanel smoke — sidebar tab rendering + LayerPanel body.
 *
 * Uses the same window.__atlasdraw__ pattern as the phase-1 test for
 * direct access to the map + Excalidraw API. The sidebar tabs are
 * registered via excalidrawAPI.registerSidebarTab in MapEditor's
 * useEffect — we verify they appear in the DefaultSidebar.
 */

import { test, expect } from "@playwright/test";

interface SceneElement {
  id: string;
  type: string;
  x: number;
  y: number;
  isDeleted?: boolean;
}

interface AtlasdrawWindow {
  __atlasdraw__?: {
    map: { isStyleLoaded: () => boolean };
    excalidrawAPI: {
      getSceneElements: () => ReadonlyArray<SceneElement>;
      setActiveTool: (tool: { type: string }) => void;
      toggleSidebar: (opts: { name: string; tab?: string }) => void;
    };
  };
}

async function waitForApp(page: import("@playwright/test").Page) {
  await page.goto("/");
  // The map canvas exists but is behind Excalidraw's transparent layer.
  await page.waitForSelector(".maplibregl-canvas-container", {
    state: "attached",
    timeout: 30_000,
  });
  // Wait for the __atlasdraw__ bridge to appear (Dev-only, gated on import.meta.env.DEV).
  await page.waitForFunction(
    () => (window as unknown as AtlasdrawWindow).__atlasdraw__ != null,
    { timeout: 30_000 },
  );
  // Let the map + Excalidraw finish initialising.
  await page.waitForTimeout(2000);
}

test.describe("LayerPanel", () => {
  test("app loads and layer panel body renders when sidebar opens", async ({
    page,
  }) => {
    await waitForApp(page);

    // Open the layers tab via the toggle-sidebar API.
    await page.evaluate(() => {
      const w = window as unknown as AtlasdrawWindow;
      w.__atlasdraw__?.excalidrawAPI.toggleSidebar({
        name: "default",
        tab: "layers",
      });
    });
    await page.waitForTimeout(500);

    // The layer panel body should be in the DOM.
    const panel = page.locator('[data-testid="layer-panel-body"]');
    await expect(panel).toBeAttached({ timeout: 5_000 });
  });

  test("layer panel shows empty state with no annotations", async ({
    page,
  }) => {
    await waitForApp(page);

    await page.evaluate(() => {
      const w = window as unknown as AtlasdrawWindow;
      w.__atlasdraw__?.excalidrawAPI.toggleSidebar({
        name: "default",
        tab: "layers",
      });
    });
    await page.waitForTimeout(500);

    const panel = page.locator('[data-testid="layer-panel-body"]');
    // "none" appears in both Data Layers and Annotations empty-state text.
    await expect(panel).toContainText("none");
  });
});
