/**
 * My maps, in a real browser: make two maps, list them, open the first,
 * delete the second. The maps are real autosaves in the browser's IndexedDB;
 * the list survives a reload.
 */

import { test, expect, type Page } from "@playwright/test";

import { drawRectangle, openEditor, setTool } from "./helpers/atlas";

const RECT = { x0: 560, y0: 330, x1: 720, y1: 450 };

async function nameMap(page: Page, title: string) {
  await page.getByTestId("collar-sheet-name").click();
  await page.getByTestId("collar-sheet-name-input").fill(title);
  await page.getByTestId("collar-sheet-name-input").press("Enter");
  await expect(page.getByTestId("collar-sheet-name")).toHaveText(title);
}

async function openMyMapsFromMenu(page: Page) {
  await page.getByTestId("main-menu-trigger").click();
  await page.getByTestId("main-menu-my-maps").click();
  await expect(page.getByRole("dialog", { name: "My maps" })).toBeVisible();
}

async function sceneCount(page: Page): Promise<number> {
  return page.evaluate(
    () =>
      (
        window as unknown as {
          __atlasdraw__: {
            excalidrawAPI: { getSceneElements: () => unknown[] };
          };
        }
      ).__atlasdraw__.excalidrawAPI.getSceneElements().length,
  );
}

test("make two maps, list them, open the first, delete the second", async ({
  page,
}) => {
  await openEditor(page);

  // The first map.
  await drawRectangle(page, RECT);
  await setTool(page, "selection");
  await nameMap(page, "First map");

  // A second map, from the My maps dialog.
  await openMyMapsFromMenu(page);
  const dialog = page.getByRole("dialog", { name: "My maps" });
  await expect(dialog.getByTestId("my-maps-row")).toHaveCount(1);
  await expect(dialog.getByTestId("my-maps-row")).toContainText("First map");
  await dialog.getByRole("button", { name: "New map" }).click();
  await expect(dialog).toHaveCount(0);
  expect(await sceneCount(page)).toBe(0);

  await drawRectangle(page, RECT);
  await setTool(page, "selection");
  await nameMap(page, "Second map");

  // The list, from the palette: the last changed first.
  await page.keyboard.press("ControlOrMeta+k");
  await page.keyboard.type("My maps");
  await page.keyboard.press("Enter");
  await expect(dialog).toBeVisible();
  const rows = dialog.getByTestId("my-maps-row");
  await expect(rows).toHaveCount(2);
  await expect(rows.nth(0)).toContainText("Second map");
  await expect(rows.nth(0)).toContainText("Open now");
  await expect(rows.nth(1)).toContainText("First map");

  // Open the first. Its own changes stay in the list, so nothing is asked.
  await dialog.getByRole("button", { name: "Open First map" }).click();
  await expect(dialog).toHaveCount(0);
  await expect(page.getByTestId("confirm-dialog")).toHaveCount(0);
  await expect(page.getByTestId("collar-sheet-name")).toHaveText("First map");
  expect(await sceneCount(page)).toBe(1);

  // Delete the second, through the in-page confirm, by keyboard.
  await openMyMapsFromMenu(page);
  await dialog.getByRole("button", { name: "Delete Second map" }).click();
  const confirm = page.getByRole("alertdialog", { name: "Delete map?" });
  await expect(confirm).toBeVisible();
  await confirm.getByRole("button", { name: "Delete map" }).focus();
  await page.keyboard.press("Enter");
  await expect(rows).toHaveCount(1);
  await expect(rows.nth(0)).toContainText("First map");

  // Escape closes the list, and focus goes back to the page.
  await page.keyboard.press("Escape");
  await expect(dialog).toHaveCount(0);

  // The list is the browser's: a reload shows the same maps.
  await openEditor(page);
  await expect(page.getByTestId("collar-sheet-name")).toHaveText("First map");
  await openMyMapsFromMenu(page);
  await expect(rows).toHaveCount(1);
  await expect(rows.nth(0)).toContainText("First map");
});
