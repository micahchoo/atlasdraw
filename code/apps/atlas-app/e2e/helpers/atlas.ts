import { expect, type Page } from "@playwright/test";

import { skipOnboarding } from "./onboarding";

/**
 * Shape of the dev-only `window.__atlasdraw__` hook that MapEditor sets
 * (`src/components/MapEditor.tsx`, guarded by `import.meta.env.DEV`). Only the
 * members the e2e specs read are typed.
 */
export interface AtlasdrawHook {
  map: {
    isStyleLoaded: () => boolean;
    getZoom: () => number;
    getCenter: () => { lng: number; lat: number };
    panBy: (offset: [number, number], opts?: { duration?: number }) => unknown;
    project: (lngLat: [number, number]) => { x: number; y: number };
  };
  excalidrawAPI: {
    getSceneElements: () => ReadonlyArray<SceneElement>;
    getAppState: () => {
      activeTool: { type: string };
      selectedElementIds: Record<string, boolean>;
    };
    setActiveTool: (tool: { type: string }) => void;
  };
  /** The open document's world frame (ADR-0015). */
  frame: () => unknown;
  toLngLat: (
    frame: unknown,
    p: { x: number; y: number },
  ) => { lng: number; lat: number };
}

export interface SceneElement {
  id: string;
  type: string;
  x: number;
  y: number;
  width: number;
  height: number;
  angle?: number;
  customData?: Record<string, unknown>;
}

/** Where a box is on Earth: its NW and SE corners in lng/lat. */
export interface Geography {
  west: number;
  north: number;
  east: number;
  south: number;
}

export interface Camera {
  zoom: number;
  lng: number;
  lat: number;
}

/** Boot the editor at `/` with onboarding dismissed; wait for map + Excalidraw. */
export async function openEditor(page: Page): Promise<void> {
  await skipOnboarding(page);
  await page.goto("/");
  await expect(page.getByTestId("onboarding-scrim")).toHaveCount(0);
  await page.waitForFunction(
    () => {
      const w = window as unknown as { __atlasdraw__?: AtlasdrawHook };
      return Boolean(
        w.__atlasdraw__?.map.isStyleLoaded() && w.__atlasdraw__.excalidrawAPI,
      );
    },
    undefined,
    { timeout: 30_000 },
  );
  // First render frame after style-load.
  await page.waitForTimeout(250);
}

export async function readCamera(page: Page): Promise<Camera> {
  return page.evaluate(() => {
    const m = (window as unknown as { __atlasdraw__: AtlasdrawHook })
      .__atlasdraw__.map;
    const c = m.getCenter();
    return { zoom: m.getZoom(), lng: c.lng, lat: c.lat };
  });
}

export async function setTool(page: Page, type: string): Promise<void> {
  await page.evaluate((t) => {
    (
      window as unknown as { __atlasdraw__: AtlasdrawHook }
    ).__atlasdraw__.excalidrawAPI.setActiveTool({ type: t });
  }, type);
  await page.waitForTimeout(50);
}

export interface Box {
  x0: number;
  y0: number;
  x1: number;
  y1: number;
}

/**
 * Drag a rectangle with Excalidraw's stock tool, in viewport pixels. The move
 * is interpolated so a pointermove lands before pointerup.
 */
export async function drawRectangle(page: Page, box: Box): Promise<void> {
  await setTool(page, "rectangle");
  await page.mouse.move(box.x0, box.y0);
  await page.mouse.down();
  await page.mouse.move((box.x0 + box.x1) / 2, (box.y0 + box.y1) / 2, {
    steps: 5,
  });
  await page.mouse.move(box.x1, box.y1, { steps: 5 });
  await page.mouse.up();
  // Let Excalidraw commit the element.
  await page.waitForTimeout(300);
}

export async function getRectangle(
  page: Page,
): Promise<SceneElement | undefined> {
  return page.evaluate(() =>
    (
      window as unknown as { __atlasdraw__: AtlasdrawHook }
    ).__atlasdraw__.excalidrawAPI
      .getSceneElements()
      .find((el) => el.type === "rectangle"),
  );
}

/**
 * Where the first rectangle is on Earth, from its scene coordinates through
 * the document's world frame. Undefined when there is no rectangle.
 */
export async function rectangleGeography(
  page: Page,
): Promise<Geography | undefined> {
  return page.evaluate(() => {
    const a = (window as unknown as { __atlasdraw__: AtlasdrawHook })
      .__atlasdraw__;
    const el = a.excalidrawAPI
      .getSceneElements()
      .find((e) => e.type === "rectangle");
    if (!el) {
      return undefined;
    }
    const frame = a.frame();
    const nw = a.toLngLat(frame, { x: el.x, y: el.y });
    const se = a.toLngLat(frame, { x: el.x + el.width, y: el.y + el.height });
    return { west: nw.lng, north: nw.lat, east: se.lng, south: se.lat };
  });
}
