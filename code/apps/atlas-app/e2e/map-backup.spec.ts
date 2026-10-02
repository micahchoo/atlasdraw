/**
 * Back up my maps, in real browsers: one browser downloads the backup, a
 * second browser with empty storage restores it from the file and lists the
 * map. The download and the file input are the browser's, so jsdom cannot
 * show this.
 */

import { test, expect, type Page } from "@playwright/test";

import { drawRectangle, openEditor, setTool } from "./helpers/atlas";

const RECT = { x0: 560, y0: 330, x1: 720, y1: 450 };

async function openMyMaps(page: Page) {
  await page.getByTestId("main-menu-trigger").click();
  await page.getByTestId("main-menu-my-maps").click();
  const dialog = page.getByRole("dialog", { name: "My maps" });
  await expect(dialog).toBeVisible();
  return dialog;
}

test("a backup made in one browser restores the map in a cleared one", async ({
  page,
  browser,
}, testInfo) => {
  await openEditor(page);
  await drawRectangle(page, RECT);
  await setTool(page, "selection");
  await page.getByTestId("collar-sheet-name").click();
  await page.getByTestId("collar-sheet-name-input").fill("Backed up map");
  await page.getByTestId("collar-sheet-name-input").press("Enter");

  const dialog = await openMyMaps(page);
  await expect(dialog.getByTestId("my-maps-row")).toContainText(
    "Backed up map",
  );
  const [download] = await Promise.all([
    page.waitForEvent("download"),
    dialog.getByTestId("my-maps-backup").click(),
  ]);
  expect(download.suggestedFilename()).toMatch(
    /^atlasdraw-backup-\d{4}-\d{2}-\d{2}\.json$/,
  );
  const file = await download.path();

  // A second browser, with nothing stored.
  const cleared = await browser.newContext({
    baseURL: testInfo.project.use.baseURL,
  });
  const other = await cleared.newPage();
  await openEditor(other);
  const otherDialog = await openMyMaps(other);
  await expect(otherDialog.getByTestId("my-maps-row")).not.toContainText([
    "Backed up map",
  ]);

  await otherDialog.getByTestId("my-maps-restore-input").setInputFiles(file);

  await expect(
    otherDialog.getByTestId("my-maps-row").filter({ hasText: "Backed up map" }),
  ).toHaveCount(1);
  await cleared.close();
});
