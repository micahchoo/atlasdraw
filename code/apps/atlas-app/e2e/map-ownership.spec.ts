/**
 * Who may write a map (audit2-03 F1, F2), in a real browser:
 *
 * - An older .atlasdraw file of the open map does not overwrite the newer
 *   browser copy. The user is asked, and "Keep both" keeps both.
 * - One tab per map: a second tab that opens the same map is asked, and
 *   "Take over" leaves the first tab read-only.
 */

import { readFileSync } from "fs";

import { test, expect, type Page } from "@playwright/test";

import {
  drawRectangle,
  openEditor,
  setTool,
  type AtlasdrawHook,
} from "./helpers/atlas";

type Hook = AtlasdrawHook & {
  session: {
    store: { getState: () => { doc: { id: string } } };
    persistence: { getState: () => { readOnly: boolean } };
  };
  isDirty: () => boolean;
};

const docId = (page: Page) =>
  page.evaluate(
    () =>
      (
        window as unknown as { __atlasdraw__: Hook }
      ).__atlasdraw__.session.store.getState().doc.id,
  );
const elementCount = (page: Page) =>
  page.evaluate(
    () =>
      (
        window as unknown as { __atlasdraw__: Hook }
      ).__atlasdraw__.excalidrawAPI.getSceneElements().length,
  );
const readOnly = (page: Page) =>
  page.evaluate(
    () =>
      (
        window as unknown as { __atlasdraw__: Hook }
      ).__atlasdraw__.session.persistence.getState().readOnly,
  );
const saved = async (page: Page) =>
  expect
    .poll(
      () =>
        page.evaluate(() =>
          (
            window as unknown as { __atlasdraw__: Hook }
          ).__atlasdraw__.isDirty(),
        ),
      { timeout: 15_000 },
    )
    .toBe(false);

test("an older file of the open map does not overwrite the newer copy", async ({
  page,
}) => {
  await openEditor(page);
  // No File System Access: Save downloads and Open uses a file input, both
  // of which Playwright can drive.
  await page.evaluate(() => {
    delete (window as { showSaveFilePicker?: unknown }).showSaveFilePicker;
    delete (window as { showOpenFilePicker?: unknown }).showOpenFilePicker;
  });

  await drawRectangle(page, { x0: 560, y0: 330, x1: 720, y1: 450 });
  await setTool(page, "selection");
  const id = await docId(page);

  // The file, with one rectangle.
  const download = page.waitForEvent("download");
  await page.keyboard.press("ControlOrMeta+s");
  const file = await (await download).path();
  const oldBytes = readFileSync(file!);

  // A later edit, saved in the browser: the browser copy is now newer.
  await page.waitForTimeout(1100);
  await drawRectangle(page, { x0: 400, y0: 200, x1: 480, y1: 260 });
  await setTool(page, "selection");
  await saved(page);
  expect(await elementCount(page)).toBe(2);

  // Open the older file.
  const chooser = page.waitForEvent("filechooser");
  await page.keyboard.press("ControlOrMeta+o");
  // The open map is in a file only as it was before the second rectangle.
  await page.getByTestId("confirm-dialog-confirm").click();
  await (
    await chooser
  ).setFiles({
    name: "plan.atlasdraw",
    mimeType: "application/vnd.atlasdraw+zip",
    buffer: oldBytes,
  });

  // The newer copy is in this browser: the user is asked. Keep both.
  await expect(page.getByTestId("confirm-dialog")).toContainText(
    "A newer copy of this map is in this browser",
  );
  await page.getByTestId("confirm-dialog-cancel").click();
  await expect.poll(() => docId(page)).not.toBe(id);
  expect(await elementCount(page)).toBe(1);
  await saved(page);

  // The newer copy is intact in My maps.
  await page.getByTestId("main-menu-trigger").click();
  await page.getByTestId("main-menu-my-maps").click();
  const dialog = page.getByRole("dialog", { name: "My maps" });
  await expect(dialog.getByTestId("my-maps-row")).toHaveCount(2);
  await dialog.locator('[data-testid="my-maps-open"]:not([disabled])').click();
  await expect.poll(() => docId(page)).toBe(id);
  expect(await elementCount(page)).toBe(2);
});

test("a second tab on the same map is asked; taking over makes the first tab read-only", async ({
  page,
  context,
}) => {
  await openEditor(page);
  await drawRectangle(page, { x0: 560, y0: 330, x1: 720, y1: 450 });
  await setTool(page, "selection");
  await saved(page);
  const id = await docId(page);

  // A fresh tab opens the map saved last in this browser: the same one.
  const second = await context.newPage();
  await second.goto("/");
  await expect(second.getByTestId("confirm-dialog")).toContainText(
    "This map is open in another tab",
  );
  await second.getByTestId("confirm-dialog-confirm").click();
  expect(await docId(second)).toBe(id);
  await expect.poll(() => readOnly(second)).toBe(false);

  // The first tab lost the map and says so.
  await expect.poll(() => readOnly(page)).toBe(true);
  await expect(page.getByText(/opened in another tab/)).toBeVisible();
});
