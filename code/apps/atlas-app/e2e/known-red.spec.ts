/**
 * KNOWN-RED — Playwright tests of the CORRECT behaviour that fail on today's
 * code. Each is marked `test.fail(true, ...)`, so the suite stays green while
 * the defect stands; Playwright reports "unexpectedly passed" the moment a fix
 * lands, which is the signal to delete the `test.fail` line.
 *
 * Every test here was first run WITHOUT `test.fail` and seen to fail for the
 * stated reason.
 */

import { test, expect, type Page } from "@playwright/test";

import {
  drawRectangle,
  getRectangle,
  openEditor,
  readCamera,
  setTool,
  type AtlasdrawHook,
} from "./helpers/atlas";

/** A rectangle well inside the 1280x800 plate, clear of the collar chrome. */
const RECT = { x0: 560, y0: 330, x1: 720, y1: 450 };

/**
 * Draw a rectangle in the editor, then take the read-only share link through
 * the real Share dialog. A small map takes hash mode (`/m#v2:<base64url>`), which
 * needs no storage server.
 */
async function shareLinkWithRectangle(page: Page): Promise<string> {
  await openEditor(page);
  await drawRectangle(page, RECT);
  expect(await getRectangle(page), "rectangle drawn").toBeDefined();
  await setTool(page, "selection");

  await page.getByTestId("main-menu-trigger").click();
  await page.getByTestId("main-menu-share").click();
  await page.getByTestId("share-dialog-pick-readonly").click();
  const url = await page.getByTestId("share-dialog-url").inputValue();
  expect(url, "small map takes hash mode").toContain("/m#v2:");
  return url;
}

/** Count of painted pixels on Excalidraw's static (scene) canvas. */
async function paintedPixels(page: Page): Promise<number> {
  return page.evaluate(() => {
    const canvas = document.querySelector<HTMLCanvasElement>(
      "canvas.excalidraw__canvas.static",
    );
    const ctx = canvas?.getContext("2d");
    if (!canvas || !ctx) {
      return -1;
    }
    const { data } = ctx.getImageData(0, 0, canvas.width, canvas.height);
    let n = 0;
    for (let i = 3; i < data.length; i += 4) {
      if (data[i] !== 0) {
        n++;
      }
    }
    return n;
  });
}

test.describe("known-red", () => {
  test("W7: the read-only share page renders a map", async ({ page }) => {
    test.fail(
      true,
      "KNOWN-RED (W7 share view): /m renders Excalidraw on opaque white with no MapLibre canvas. Remove when fixed.",
    );
    const url = await shareLinkWithRectangle(page);
    const path = url.slice(url.indexOf("/m#"));

    const viewer = await page.context().newPage();
    await viewer.goto(path);
    await expect(viewer.getByTestId("share-view-canvas")).toBeVisible();
    // A share of a MAP shows the map: ShareView mounts Excalidraw alone on
    // opaque white, with no basemap under it.
    await expect(viewer.locator("canvas.maplibregl-canvas")).toHaveCount(1, {
      timeout: 15_000,
    });
  });

  // Fixed in W3: the document saves the live camera.
  test("an embed opens on the saved camera", async ({ page }) => {
    const url = await shareLinkWithRectangle(page);
    const hash = url.slice(url.indexOf("#"));

    const embed = await page.context().newPage();
    await embed.goto(`/embed${hash}`);
    await expect(embed.getByTestId("embed-canvas")).toBeVisible();
    await embed.waitForSelector("canvas.maplibregl-canvas");
    // CoordinateSync projects the scene a frame after map + api are up.
    await embed.waitForTimeout(1500);

    const painted = await paintedPixels(embed);
    expect(
      painted,
      "the drawn rectangle must be on screen in the embed",
    ).toBeGreaterThan(100);
  });

  test("W5/W7: clicking a shape with the selection tool leaves the camera alone", async ({
    page,
  }) => {
    await openEditor(page);
    await drawRectangle(page, RECT);
    await setTool(page, "selection");
    // Deselect by clicking empty canvas, so the next click is a fresh select.
    await page.mouse.click(300, 650);
    await page.waitForTimeout(300);

    const before = await readCamera(page);
    // Click the rectangle's left edge (a transparent fill selects on stroke).
    await page.mouse.click(RECT.x0, (RECT.y0 + RECT.y1) / 2);
    await page.waitForTimeout(800);
    const after = await readCamera(page);

    const selected = await page.evaluate(
      () =>
        Object.keys(
          (
            window as unknown as { __atlasdraw__: AtlasdrawHook }
          ).__atlasdraw__.excalidrawAPI.getAppState().selectedElementIds,
        ).length,
    );
    expect(selected, "the click selected the rectangle").toBe(1);
    expect(after.zoom, `zoom ${before.zoom} -> ${after.zoom}`).toBeCloseTo(
      before.zoom,
      3,
    );
    expect(after.lng, `centre lng ${before.lng} -> ${after.lng}`).toBeCloseTo(
      before.lng,
      4,
    );
    expect(after.lat, `centre lat ${before.lat} -> ${after.lat}`).toBeCloseTo(
      before.lat,
      4,
    );
  });

  test("W7: pressing ? opens exactly one help surface", async ({ page }) => {
    test.fail(
      true,
      "KNOWN-RED (W7 help): ? opens both the Atlasdraw shortcuts panel and Excalidraw's HelpDialog. Remove when fixed.",
    );
    await openEditor(page);
    await page.mouse.click(300, 650);
    await page.keyboard.press("?");
    await page.waitForTimeout(500);

    const atlas = await page.getByTestId("keyboard-shortcuts-panel").count();
    const excalidraw = await page.locator(".HelpDialog").count();
    expect(
      atlas + excalidraw,
      `open help surfaces: Atlasdraw shortcuts=${atlas}, Excalidraw HelpDialog=${excalidraw}`,
    ).toBe(1);
  });

  test("W4: undo after a pan restores the shape's original geography", async ({
    page,
  }) => {
    test.fail(
      true,
      "KNOWN-RED (W4 undo after pan): Ctrl+Z after drag-then-pan yields an anchor that is neither the pre-drag nor the dragged one, offset by the pan. Remove when fixed.",
    );
    await openEditor(page);
    await drawRectangle(page, RECT);
    const drawn = await getRectangle(page);
    expect(drawn?.customData?.geo, "rectangle is geo-anchored").toBeDefined();
    const anchor = drawn!.customData!.geo;

    // The new rectangle is selected; drag it by its interior.
    await setTool(page, "selection");
    const cx = (RECT.x0 + RECT.x1) / 2;
    const cy = (RECT.y0 + RECT.y1) / 2;
    await page.mouse.move(cx, cy);
    await page.mouse.down();
    await page.mouse.move(cx + 60, cy + 40, { steps: 8 });
    await page.mouse.move(cx + 120, cy + 80, { steps: 8 });
    await page.mouse.up();
    await page.waitForTimeout(400);
    const moved = (await getRectangle(page))!.customData!.geo;
    expect(moved, "the drag moved the anchor").not.toEqual(anchor);

    await page.evaluate(() => {
      (
        window as unknown as { __atlasdraw__: AtlasdrawHook }
      ).__atlasdraw__.map.panBy([150, 90], { duration: 0 });
    });
    await page.waitForTimeout(400);

    await page.keyboard.press("Control+z");
    await page.waitForTimeout(500);

    const undone = (await getRectangle(page))?.customData?.geo;
    expect(
      undone,
      `undo restores the pre-drag anchor (after the drag it was ` +
        `${JSON.stringify(moved)})`,
    ).toEqual(anchor);
  });
});
