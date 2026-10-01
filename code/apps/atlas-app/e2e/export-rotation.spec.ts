/**
 * A turned map exports turned, with the drawing on its place on the map.
 *
 * Measured on real pixels, as the blind audit measured the defect (a box over
 * Shigatse that printed over Dhaka; audit2-00 #3). A magenta box is drawn
 * away from the centre, the map is turned, and then two pictures are compared:
 *
 *   - the live screen: a screenshot of the map, and
 *   - the PNG the Export dialog downloads at 1x, and the map image inside the
 *     PDF.
 *
 * In each picture the test finds the magenta pixels and takes their centre.
 * The export is the size of the map, so at 1x the two centres must agree.
 * Before MapView the PNG put the box at the same place at every bearing, so
 * at 90° it was hundreds of pixels off.
 */

import { readFileSync } from "fs";

import { expect, test, type Page } from "@playwright/test";

import { drawRectangle, openEditor } from "./helpers/atlas";

interface Hook {
  map: {
    getContainer: () => HTMLElement;
    jumpTo: (opts: { bearing: number }) => void;
    getBearing: () => number;
    once: (type: string, cb: () => void) => void;
    triggerRepaint: () => void;
  };
  excalidrawAPI: {
    getSceneElements: () => ReadonlyArray<{ id: string; type: string }>;
    updateScene: (data: { elements: unknown[] }) => void;
  };
  session: {
    view: {
      getState: () => {
        openDialog: (d: { kind: "export"; format: "png" | "pdf" }) => void;
      };
    };
  };
}

/** Pixels the export may differ from the screen by: antialiasing, rounding. */
const SLACK_PX = 3;

/** The map's rectangle on the page, in CSS px. */
function mapRect(page: Page) {
  return page.evaluate(() => {
    const r = (window as unknown as { __atlasdraw__: Hook }).__atlasdraw__.map
      .getContainer()
      .getBoundingClientRect();
    return { x: r.left, y: r.top, width: r.width, height: r.height };
  });
}

/** Paint the one rectangle magenta, filled, so it is easy to find. */
async function paintMagenta(page: Page) {
  await page.evaluate(() => {
    const api = (window as unknown as { __atlasdraw__: Hook }).__atlasdraw__
      .excalidrawAPI;
    api.updateScene({
      elements: api.getSceneElements().map((e) =>
        e.type === "rectangle"
          ? {
              ...e,
              strokeColor: "#ff00ff",
              backgroundColor: "#ff00ff",
              fillStyle: "solid",
              roughness: 0,
              version: ((e as { version?: number }).version ?? 1) + 1,
            }
          : e,
      ),
    });
  });
}

async function turn(page: Page, bearing: number) {
  await page.evaluate(
    (b) =>
      new Promise<void>((resolve) => {
        const map = (window as unknown as { __atlasdraw__: Hook }).__atlasdraw__
          .map;
        map.once("idle", () => resolve());
        map.jumpTo({ bearing: b });
        map.triggerRepaint();
      }),
    bearing,
  );
  await page.waitForTimeout(400);
}

interface Ink {
  count: number;
  cx: number;
  cy: number;
  width: number;
  height: number;
}

/** The centre of the magenta pixels in an encoded image, in image px. */
function magentaIn(page: Page, bytes: Buffer, type: string): Promise<Ink> {
  return page.evaluate(
    async ({ b64, type }) => {
      const raw = Uint8Array.from(atob(b64), (c) => c.charCodeAt(0));
      const bitmap = await createImageBitmap(new Blob([raw], { type }));
      const canvas = new OffscreenCanvas(bitmap.width, bitmap.height);
      const ctx = canvas.getContext("2d")!;
      ctx.drawImage(bitmap, 0, 0);
      const { data } = ctx.getImageData(0, 0, bitmap.width, bitmap.height);
      let count = 0;
      let sx = 0;
      let sy = 0;
      for (let i = 0; i < data.length; i += 4) {
        // Magenta, allowing for JPEG and antialiasing.
        if (data[i] > 200 && data[i + 1] < 70 && data[i + 2] > 200) {
          const p = i / 4;
          sx += p % bitmap.width;
          sy += Math.floor(p / bitmap.width);
          count++;
        }
      }
      return {
        count,
        cx: sx / Math.max(count, 1),
        cy: sy / Math.max(count, 1),
        width: bitmap.width,
        height: bitmap.height,
      };
    },
    { b64: bytes.toString("base64"), type },
  );
}

async function screenInk(page: Page): Promise<Ink> {
  const rect = await mapRect(page);
  const shot = await page.screenshot({ clip: rect });
  return magentaIn(page, shot, "image/png");
}

async function exportPng(page: Page): Promise<Buffer> {
  await page.evaluate(() =>
    (window as unknown as { __atlasdraw__: Hook }).__atlasdraw__.session.view
      .getState()
      .openDialog({ kind: "export", format: "png" }),
  );
  await page.getByTestId("export-png-pixel-ratio").selectOption("1");
  const [download] = await Promise.all([
    page.waitForEvent("download", { timeout: 45_000 }),
    page.getByTestId("export-dialog-export").click(),
  ]);
  return readFileSync((await download.path())!);
}

async function exportPdfImage(page: Page): Promise<Buffer> {
  await page.evaluate(() =>
    (window as unknown as { __atlasdraw__: Hook }).__atlasdraw__.session.view
      .getState()
      .openDialog({ kind: "export", format: "pdf" }),
  );
  const [download] = await Promise.all([
    page.waitForEvent("download", { timeout: 90_000 }),
    page.getByTestId("export-dialog-export").click(),
  ]);
  const pdf = readFileSync((await download.path())!);
  // pdf-lib embeds the JPEG as-is: the bytes from the SOI to the EOI marker.
  const start = pdf.indexOf(Buffer.from([0xff, 0xd8, 0xff]));
  const end = pdf.indexOf(Buffer.from([0xff, 0xd9]), start) + 2;
  expect(start, "the PDF holds a JPEG").toBeGreaterThan(0);
  return pdf.subarray(start, end);
}

test.describe("export of a turned map", () => {
  test.beforeEach(async ({ page }) => {
    await openEditor(page);
    const r = await mapRect(page);
    const cx = r.x + r.width / 2;
    const cy = r.y + r.height / 2;
    // Away from the centre, so a turn about the centre moves it far.
    await drawRectangle(page, {
      x0: cx + 160,
      y0: cy - 170,
      x1: cx + 280,
      y1: cy - 90,
    });
    await page.keyboard.press("Escape");
    await paintMagenta(page);
    await page.mouse.move(r.x + 5, r.y + r.height - 5);
    await page.waitForTimeout(300);
  });

  for (const bearing of [0, 30, 90]) {
    test(`the PNG at bearing ${bearing} has the drawing where the screen has it`, async ({
      page,
    }) => {
      await turn(page, bearing);
      const live = await screenInk(page);
      expect(live.count, "the box is on the screen").toBeGreaterThan(500);

      const png = await magentaIn(page, await exportPng(page), "image/png");
      const rect = await mapRect(page);
      expect([png.width, png.height]).toEqual([
        Math.floor(rect.width),
        Math.floor(rect.height),
      ]);
      expect(png.count, "the box is in the PNG").toBeGreaterThan(500);

      const err = Math.hypot(png.cx - live.cx, png.cy - live.cy);
      test.info().annotations.push({
        type: "measure",
        description: `bearing ${bearing}: screen (${live.cx.toFixed(
          1,
        )}, ${live.cy.toFixed(1)}) png (${png.cx.toFixed(1)}, ${png.cy.toFixed(
          1,
        )}) error ${err.toFixed(2)} px; ink ${live.count} / ${png.count} px`,
      });
      expect(err).toBeLessThan(SLACK_PX);
      // Same ink: turned the same way, not only centred the same.
      expect(png.count / live.count).toBeGreaterThan(0.9);
      expect(png.count / live.count).toBeLessThan(1.1);
    });
  }

  test("the PDF's map image at bearing 30 has the drawing where the screen has it", async ({
    page,
  }) => {
    test.setTimeout(150_000);
    await turn(page, 30);
    const live = await screenInk(page);
    const rect = await mapRect(page);
    const img = await magentaIn(page, await exportPdfImage(page), "image/jpeg");
    expect(img.count, "the box is in the PDF").toBeGreaterThan(500);
    // The PDF image is the map at print resolution: compare in fractions.
    const fx = img.cx / img.width - live.cx / Math.floor(rect.width);
    const fy = img.cy / img.height - live.cy / Math.floor(rect.height);
    const errPx = Math.hypot(fx * rect.width, fy * rect.height);
    test.info().annotations.push({
      type: "measure",
      description: `pdf bearing 30: error ${errPx.toFixed(2)} screen px`,
    });
    expect(errPx).toBeLessThan(SLACK_PX);
  });
});
