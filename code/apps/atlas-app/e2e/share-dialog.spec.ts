/**
 * The Share dialog, driven with real input. The dialog once closed itself
 * when Read-only was chosen: the picker button unmounts during its own click,
 * and a document-level click-outside test saw a detached target. Only real
 * input shows this (the browser renders between listeners), so jsdom cannot.
 */

import { test, expect } from "@playwright/test";

import { drawRectangle, openEditor, setTool } from "./helpers/atlas";

const RECT = { x0: 560, y0: 330, x1: 720, y1: 450 };

test("choosing Read-only in the Share dialog shows the link", async ({
  page,
}) => {
  await openEditor(page);
  await drawRectangle(page, RECT);
  await setTool(page, "selection");
  await page.getByTestId("main-menu-trigger").click();
  await page.getByTestId("main-menu-share").click();
  await expect(page.getByTestId("share-dialog-panel")).toBeVisible();

  await page.getByTestId("share-dialog-pick-readonly").click();

  await expect(page.getByTestId("share-dialog-url")).toBeVisible({
    timeout: 5_000,
  });
  await expect(page.getByTestId("share-dialog-mode-hint")).toBeVisible();
});

test("a press on the backdrop closes the Share dialog", async ({ page }) => {
  await openEditor(page);
  await page.getByTestId("main-menu-trigger").click();
  await page.getByTestId("main-menu-share").click();
  await expect(page.getByTestId("share-dialog-panel")).toBeVisible();

  await page.mouse.click(20, 20);

  await expect(page.getByTestId("share-dialog-panel")).toHaveCount(0);
});
