/**
 * Dark theme reaches the app's own surfaces, not only Excalidraw's.
 *
 * "Dark or light theme" sets Excalidraw's `appState.theme`. Excalidraw's
 * chrome follows it; the app's panels and dialogs read the `--ad-*` tokens,
 * which had no dark values, so they stayed light vellum beside a dark toolbar.
 * Found 2026-10-02 in the UI consistency pass.
 *
 * The test asks the page for each surface's computed background and checks its
 * relative luminance: under 0.2 is dark.
 */

import { test, expect, type Page } from "@playwright/test";

import { openEditor } from "./helpers/atlas";

async function runCommand(page: Page, name: string) {
  await page.keyboard.press("ControlOrMeta+k");
  await page.keyboard.type(name);
  await page.keyboard.press("Enter");
}

/** The WCAG relative luminance of the first opaque background up the tree. */
async function luminance(page: Page, testId: string): Promise<number> {
  return page.getByTestId(testId).evaluate((start) => {
    let el: Element | null = start;
    while (el) {
      const bg = getComputedStyle(el).backgroundColor;
      const m = bg.match(
        /rgba?\(([\d.]+),\s*([\d.]+),\s*([\d.]+)(?:,\s*([\d.]+))?/,
      );
      if (m && (m[4] === undefined || Number(m[4]) > 0.5)) {
        const [r, g, b] = [m[1], m[2], m[3]].map((v) => {
          const c = Number(v) / 255;
          return c <= 0.03928 ? c / 12.92 : ((c + 0.055) / 1.055) ** 2.4;
        });
        return 0.2126 * r + 0.7152 * g + 0.0722 * b;
      }
      el = el.parentElement;
    }
    return 1;
  });
}

test("in dark theme the layers panel and a dialog are dark", async ({
  page,
}) => {
  await openEditor(page);
  await runCommand(page, "Dark or light theme");
  await runCommand(page, "Layers panel");
  await expect(page.getByTestId("layer-panel-body")).toBeVisible();
  expect(await luminance(page, "layer-panel-body")).toBeLessThan(0.2);

  await runCommand(page, "Settings");
  const dialog = page.getByRole("dialog");
  await expect(dialog).toBeVisible();
  const id = await dialog.getAttribute("data-testid");
  expect(await luminance(page, id!)).toBeLessThan(0.2);
});
