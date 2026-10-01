/**
 * The command surfaces in a real browser: the ⌘K palette, a command's key,
 * the shortcuts panel and the main menu all come from one command list
 * (src/commands/commands.ts). The keys are the browser's to route, so this
 * is where "the key works" is measured.
 */

import { test, expect, type Page } from "@playwright/test";

import { drawRectangle, openEditor, setTool } from "./helpers/atlas";

const MOD = process.platform === "darwin" ? "Meta" : "Control";

async function commentModeOn(page: Page): Promise<boolean> {
  return (
    (await page
      .getByTestId("map-editor-root")
      .getAttribute("data-comment-mode")) === "on"
  );
}

/** Put the focus in the drawing, as a user does by clicking it. */
async function focusDrawing(page: Page): Promise<void> {
  await setTool(page, "selection");
  await page.mouse.click(300, 650);
}

test("the palette opens with Ctrl+K and runs the picked command", async ({
  page,
}) => {
  await openEditor(page);
  await focusDrawing(page);

  await page.keyboard.press(`${MOD}+k`);
  await expect(page.getByTestId("quick-actions-panel")).toBeVisible();

  await page.getByTestId("quick-actions-search").fill("comment");
  await page.keyboard.press("Enter");

  await expect(page.getByTestId("quick-actions-panel")).toHaveCount(0);
  expect(await commentModeOn(page)).toBe(true);
});

test("Ctrl+K opens the palette even with a shape selected (the drawing's link key loses)", async ({
  page,
}) => {
  await openEditor(page);
  await drawRectangle(page, { x0: 560, y0: 330, x1: 720, y1: 450 });

  await page.keyboard.press(`${MOD}+k`);

  await expect(page.getByTestId("quick-actions-panel")).toBeVisible();
  await expect(page.locator(".excalidraw-hyperlinkContainer")).toHaveCount(0);
});

test("a command's key works from the drawing, and the shortcuts panel lists it", async ({
  page,
}) => {
  await openEditor(page);
  await focusDrawing(page);

  await page.keyboard.press("c");
  expect(await commentModeOn(page)).toBe(true);
  await page.keyboard.press("Escape");
  expect(await commentModeOn(page)).toBe(false);

  await page.keyboard.press("Shift+?");
  const panel = page.getByTestId("keyboard-shortcuts-panel");
  await expect(panel).toBeVisible();
  await expect(panel.getByTestId("shortcut-row-Comment mode")).toContainText(
    "C",
  );
  await expect(panel.getByTestId("shortcut-row-Command palette")).toContainText(
    "K",
  );
  // One help surface: the drawing's own help dialog stays closed.
  await expect(page.locator(".HelpDialog")).toHaveCount(0);
});

test("the main menu lists the commands and runs them", async ({ page }) => {
  await openEditor(page);

  await page.getByTestId("main-menu-trigger").click();
  for (const name of ["open", "save", "my-maps", "import", "export", "share"]) {
    await expect(page.getByTestId(`main-menu-${name}`)).toBeVisible();
  }
  await page.getByTestId("main-menu-shortcuts").click();

  await expect(page.getByTestId("keyboard-shortcuts-panel")).toBeVisible();
});

test("Ctrl+Arrow on a selected shape adds no flowchart node", async ({
  page,
}) => {
  await openEditor(page);
  await drawRectangle(page, { x0: 560, y0: 330, x1: 720, y1: 450 });
  const count = () =>
    page.evaluate(
      () =>
        (
          window as unknown as {
            __atlasdraw__: {
              excalidrawAPI: { getSceneElements: () => unknown[] };
            };
          }
        ).__atlasdraw__.excalidrawAPI.getSceneElements().length,
    );
  expect(await count()).toBe(1);

  await page.keyboard.down(MOD);
  await page.keyboard.press("ArrowRight");
  await page.keyboard.up(MOD);
  await page.waitForTimeout(300);

  expect(await count()).toBe(1);
});
