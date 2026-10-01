/**
 * The drawing is not a keyboard trap (WCAG 2.1.2).
 *
 * Upstream Excalidraw took every Tab on its canvas for shape conversion, so
 * focus that reached the canvas never left it by the keyboard: the compass
 * and the sheet rail after it were out of reach. The fork now takes Tab only
 * when a conversion applies.
 *
 * The status bar is text only and has no tab stop, so no Tab lands on it.
 * The walk checks instead that focus goes round the whole page and comes
 * back to the canvas.
 */

import { test, expect, type Page } from "@playwright/test";

import { openEditor } from "./helpers/atlas";

/** The test ids of the focused element and of each of its ancestors. */
function focusedIn(page: Page): Promise<string[]> {
  return page.evaluate(() => {
    const ids: string[] = [];
    for (
      let el: Element | null = document.activeElement;
      el;
      el = el.parentElement
    ) {
      const id = el.getAttribute("data-testid");
      if (id) {
        ids.push(id);
      }
    }
    return ids;
  });
}

async function focusCanvas(page: Page) {
  await page.evaluate(() =>
    (document.querySelector(".excalidraw-container") as HTMLElement).focus(),
  );
  expect(
    await page.evaluate(() =>
      document.activeElement?.classList.contains("excalidraw-container"),
    ),
  ).toBe(true);
}

/** Press `key` up to `max` times; the test ids each focus stop was inside. */
async function walk(page: Page, key: string, max: number) {
  const stops: string[][] = [];
  for (let i = 0; i < max; i++) {
    await page.keyboard.press(key);
    stops.push(await focusedIn(page));
  }
  return stops;
}

test.describe("Tab leaves the canvas", () => {
  test.beforeEach(async ({ page }) => {
    await openEditor(page);
  });

  test("forward, Tab reaches the compass and the sheet rail", async ({
    page,
  }) => {
    await focusCanvas(page);
    const stops = await walk(page, "Tab", 40);
    // The first Tab leaves the drawing.
    expect(stops[0]).toContain("map-compass");
    expect(stops.some((ids) => ids.includes("sheet-rail"))).toBe(true);
    // The toolbar comes later in the walk: focus went round the page.
    expect(stops.some((ids) => ids.includes("toolbar-selection"))).toBe(true);
  });

  test("backward, Shift+Tab leaves the canvas", async ({ page }) => {
    await focusCanvas(page);
    await page.keyboard.press("Shift+Tab");
    expect(
      await page.evaluate(() =>
        document.activeElement?.classList.contains("excalidraw-container"),
      ),
    ).toBe(false);
  });
});
