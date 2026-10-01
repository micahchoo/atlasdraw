/**
 * The read-only viewer on a share link (/m): the map, the drawing in place,
 * the map's title, and "Open in Atlasdraw", which opens a copy in the editor.
 * A small map takes hash mode (`/m#v2:<base64url>`), which needs no storage
 * server; unit tests cover upload links.
 */

import { test, expect, type Page } from "@playwright/test";

import {
  drawRectangle,
  getRectangle,
  openEditor,
  setTool,
  type AtlasdrawHook,
} from "./helpers/atlas";
import { skipOnboarding } from "./helpers/onboarding";

const RECT = { x0: 560, y0: 330, x1: 720, y1: 450 };

async function shareLink(page: Page): Promise<string> {
  await openEditor(page);
  await drawRectangle(page, RECT);
  await setTool(page, "selection");
  await page.getByTestId("main-menu-trigger").click();
  await page.getByTestId("main-menu-share").click();
  await page.getByTestId("share-dialog-pick-readonly").click();
  const url = await page.getByTestId("share-dialog-url").inputValue();
  expect(url, "small map takes hash mode").toContain("/m#v2:");
  return url;
}

/** The painted box on Excalidraw's static canvas, in CSS pixels; null if blank. */
async function paintedBox(page: Page) {
  return page.evaluate(() => {
    const canvas = document.querySelector<HTMLCanvasElement>(
      "canvas.excalidraw__canvas.static",
    );
    const ctx = canvas?.getContext("2d");
    if (!canvas || !ctx) {
      return null;
    }
    const { width, height, data } = ctx.getImageData(
      0,
      0,
      canvas.width,
      canvas.height,
    );
    let x0 = Infinity;
    let y0 = Infinity;
    let x1 = -Infinity;
    let y1 = -Infinity;
    for (let y = 0; y < height; y++) {
      for (let x = 0; x < width; x++) {
        if (data[(y * width + x) * 4 + 3] !== 0) {
          x0 = Math.min(x0, x);
          y0 = Math.min(y0, y);
          x1 = Math.max(x1, x);
          y1 = Math.max(y1, y);
        }
      }
    }
    if (x1 < 0) {
      return null;
    }
    const scale = canvas.width / canvas.getBoundingClientRect().width;
    return {
      width: (x1 - x0) / scale,
      height: (y1 - y0) / scale,
    };
  });
}

test("a share link shows the map, the drawing and the map's title", async ({
  page,
}) => {
  const url = await shareLink(page);
  const viewer = await page.context().newPage();
  await viewer.goto(url.slice(url.indexOf("/m#")));

  await expect(viewer.getByTestId("viewer-head")).toContainText("Untitled map");
  await expect(viewer.locator("canvas.maplibregl-canvas")).toHaveCount(1, {
    timeout: 15_000,
  });
  // The camera bridge sets the viewport once Excalidraw has initialized.
  await viewer.waitForTimeout(1500);
  const box = await paintedBox(viewer);
  // The viewer opens at the saved camera, so the rectangle has the size it
  // had in the editor.
  expect(box, "the rectangle is drawn").not.toBeNull();
  expect(box!.width).toBeGreaterThan(RECT.x1 - RECT.x0 - 8);
  expect(box!.width).toBeLessThan(RECT.x1 - RECT.x0 + 8);
  expect(box!.height).toBeGreaterThan(RECT.y1 - RECT.y0 - 8);
  expect(box!.height).toBeLessThan(RECT.y1 - RECT.y0 + 8);
});

test("Open in Atlasdraw opens a copy of the shared map in the editor", async ({
  page,
}) => {
  const url = await shareLink(page);
  const visitor = await page.context().browser()!.newContext();
  const viewer = await visitor.newPage();
  await skipOnboarding(viewer);
  await viewer.goto(new URL(url).pathname + new URL(url).hash);
  await viewer.getByRole("link", { name: "Open in Atlasdraw" }).click();

  await viewer.waitForFunction(
    () => {
      const w = window as unknown as { __atlasdraw__?: AtlasdrawHook };
      return Boolean(w.__atlasdraw__?.excalidrawAPI);
    },
    undefined,
    { timeout: 30_000 },
  );
  await expect
    .poll(() => getRectangle(viewer), { timeout: 10_000 })
    .toBeDefined();
  await expect.poll(() => new URL(viewer.url()).hash).toBe("");
  await visitor.close();
});

test("? opens no help in the viewer: it has no editor keys to explain", async ({
  page,
}) => {
  const url = await shareLink(page);
  const viewer = await page.context().newPage();
  for (const path of ["/m", "/embed"]) {
    await viewer.goto(path + url.slice(url.indexOf("#")));
    await expect(viewer.locator("canvas.maplibregl-canvas")).toHaveCount(1, {
      timeout: 15_000,
    });
    // Focus in the drawing, where the drawing's own keys are heard.
    await viewer.locator(".excalidraw").first().press("Shift+?");
    await viewer.waitForTimeout(300);
    await expect(viewer.locator(".HelpDialog"), path).toHaveCount(0);
  }
});
