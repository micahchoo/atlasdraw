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

test("a link for this version only asks the server to freeze it on the revision just saved", async ({
  page,
}) => {
  // A stand-in storage API: the dev build saves to no server.
  let shareBody: unknown = null;
  await page.route(/\/maps$/, (route) =>
    route.fulfill({
      status: 201,
      contentType: "application/json",
      headers: { ETag: '"1"' },
      body: JSON.stringify({
        id: "abcdefghij1234567890K",
        created_at: "2026-10-01T00:00:00.000Z",
        updated_at: "2026-10-01T00:00:00.000Z",
        byte_size: 10,
        revision: 1,
        write_key: "k".repeat(43),
      }),
    }),
  );
  await page.route(/\/maps\/abcdefghij1234567890K\/share$/, (route) => {
    shareBody = route.request().postDataJSON();
    return route.fulfill({
      status: 201,
      contentType: "application/json",
      body: JSON.stringify({
        token: "tokentokentokentokenA",
        url: "/m/tokentokentokentokenA",
        expires_at: null,
        revision: 1,
      }),
    });
  });
  await openEditor(page);
  await drawRectangle(page, RECT);
  await setTool(page, "selection");
  await page.getByTestId("main-menu-trigger").click();
  await page.getByTestId("main-menu-share").click();

  await page.getByTestId("share-dialog-shows").selectOption("frozen");
  await page.getByTestId("share-dialog-pick-readonly").click();

  await expect(page.getByTestId("share-dialog-url")).toHaveValue(
    /\/m\/tokentokentokentokenA$/,
  );
  await expect(page.getByTestId("share-dialog-mode-hint")).toContainText(
    "later saves do not change it",
  );
  expect(shareBody).toEqual({ revision: 1 });
});
