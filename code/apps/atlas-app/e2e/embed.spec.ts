/**
 * The embed inside another page: the snippet the Share dialog gives, pasted
 * into a host page, in a real browser.
 *
 *   - The frame is as wide as its column and 16:10 tall, at phone width too.
 *   - It fits the map's content on load. The author's map is panned away from
 *     the drawing before sharing, so the saved camera shows none of it; with
 *     "The view you see now" (view=saved) the embed shows that empty view.
 *   - A wheel over an unlocked embed scrolls the host page and leaves the map;
 *     Ctrl+wheel zooms the map.
 *   - legend=1 shows a legend; the credit is printed.
 */

import { expect, test, type Frame, type Page } from "@playwright/test";

import { drawRectangle, getRectangle, openEditor } from "./helpers/atlas";

const RECT = { x0: 560, y0: 330, x1: 720, y1: 450 };

/** Draw, pan the drawing out of view, and take the snippet for `choices`. */
async function snippetFor(
  page: Page,
  choices: { legend?: boolean; view?: "fit" | "saved" } = {},
): Promise<string> {
  await openEditor(page);
  await drawRectangle(page, RECT);
  expect(await getRectangle(page), "rectangle drawn").toBeDefined();
  await page.keyboard.press("Escape");
  await page.evaluate(() =>
    (
      window as unknown as {
        __atlasdraw__: {
          map: { panBy: (o: [number, number], p: object) => void };
        };
      }
    ).__atlasdraw__.map.panBy([2500, 0], { duration: 0 }),
  );
  await page.waitForTimeout(300);
  await page.getByTestId("main-menu-trigger").click();
  await page.getByTestId("main-menu-share").click();
  await page.getByTestId("share-dialog-pick-readonly").click();
  await expect(page.getByTestId("embed-snippet")).toBeVisible();
  if (choices.legend) {
    await page.getByTestId("embed-legend-toggle").check();
  }
  if (choices.view) {
    await page.getByTestId("embed-view").selectOption(choices.view);
  }
  return page.getByTestId("embed-snippet").inputValue();
}

/** A host page with a column of `width` px, text above and below the map. */
async function host(
  page: Page,
  snippet: string,
  width: number,
): Promise<Frame> {
  const filler = "<p>Article text.</p>".repeat(40);
  const hostPage = await page.context().newPage();
  await hostPage.setViewportSize({ width: width + 40, height: 700 });
  await hostPage.setContent(
    `<main style="width:${width}px;margin:0 auto">${filler}${snippet}${filler}</main>`,
  );
  const iframe = hostPage.locator("iframe");
  await iframe.scrollIntoViewIfNeeded();
  const frame = (await iframe.elementHandle())!.contentFrame();
  const f = (await frame)!;
  await f.waitForSelector("canvas.maplibregl-canvas", { timeout: 30_000 });
  // The document opens, the fit runs, the drawing paints.
  await f.waitForTimeout(2000);
  return f;
}

/** Painted pixels on the embed's drawing canvas. */
function drawingInk(frame: Frame): Promise<number> {
  return frame.evaluate(() => {
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

test.describe("embed", () => {
  test("fills a phone-width column at 16:10 and fits the drawing", async ({
    page,
  }) => {
    test.setTimeout(120_000);
    const snippet = await snippetFor(page);
    expect(snippet).not.toMatch(/width="800"/);
    const frame = await host(page, snippet, 360);
    const box = await frame.frameElement().then((e) => e.boundingBox());
    expect(box!.width).toBeCloseTo(360, 0);
    expect(box!.height).toBeCloseTo(225, 0);
    expect(
      await drawingInk(frame),
      "the fitted embed shows the box",
    ).toBeGreaterThan(100);
    await expect(frame.getByTestId("viewer-credit")).toContainText(
      "OpenStreetMap",
    );
  });

  test("view=saved opens where the author was, which here shows no drawing", async ({
    page,
  }) => {
    test.setTimeout(120_000);
    const snippet = await snippetFor(page, { view: "saved" });
    expect(snippet).toContain("view=saved");
    const frame = await host(page, snippet, 600);
    expect(await drawingInk(frame)).toBeLessThan(100);
  });

  test("a wheel scrolls the page, not the map; Ctrl+wheel zooms the map", async ({
    page,
  }) => {
    test.setTimeout(120_000);
    const frame = await host(page, await snippetFor(page), 600);
    const hostPage = frame.page();
    const box = (await (await frame.frameElement()).boundingBox())!;
    const inkBefore = await drawingInk(frame);
    const scrollBefore = await hostPage.evaluate(() => window.scrollY);

    await hostPage.mouse.move(box.x + box.width / 2, box.y + box.height / 2);
    await hostPage.mouse.wheel(0, 300);
    await hostPage.waitForTimeout(800);
    expect(
      await hostPage.evaluate(() => window.scrollY),
      "the page scrolled",
    ).toBeGreaterThan(scrollBefore);
    expect(await drawingInk(frame), "the map did not zoom").toBe(inkBefore);

    const box2 = (await (await frame.frameElement()).boundingBox())!;
    await hostPage.mouse.move(
      box2.x + box2.width / 2,
      box2.y + box2.height / 2,
    );
    await hostPage.keyboard.down("Control");
    await hostPage.mouse.wheel(0, -400);
    await hostPage.keyboard.up("Control");
    await hostPage.waitForTimeout(1200);
    expect(await drawingInk(frame), "Ctrl+wheel zoomed in").toBeGreaterThan(
      inkBefore,
    );
  });

  test("legend=1 shows a legend of what is in view", async ({ page }) => {
    test.setTimeout(120_000);
    const snippet = await snippetFor(page, { legend: true });
    expect(snippet).toContain("legend=1");
    const frame = await host(page, snippet, 600);
    const legend = frame.getByTestId("embed-legend");
    await expect(legend).toBeVisible();
    await expect(legend).toContainText("Legend");
    await expect(legend).toContainText("Rectangle");
  });
});
