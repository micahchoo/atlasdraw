/**
 * Pin details in a real editor: select a pin, edit its details from the
 * palette, and Ctrl+Z takes the edit back as one step while the pin stays.
 *
 * The unit tests hold the write (state/pinDetails.ts) and the form
 * (PinDetailsDialog) against a fake. Only a browser shows that the edit
 * reaches the drawing's real history through the one undo (historyHost).
 */

import { test, expect, type Page } from "@playwright/test";

import { openEditor, setTool } from "./helpers/atlas";

const MOD = process.platform === "darwin" ? "Meta" : "Control";

/** The pins in the scene, with their details. */
async function pins(page: Page) {
  return page.evaluate(() =>
    (
      window as unknown as {
        __atlasdraw__: {
          excalidrawAPI: {
            getSceneElements: () => Array<{
              id: string;
              customData?: { tool?: string; pin?: { title?: string } };
            }>;
          };
        };
      }
    ).__atlasdraw__.excalidrawAPI
      .getSceneElements()
      .filter((e) => e.customData?.tool === "pin")
      .map((e) => ({ id: e.id, title: e.customData?.pin?.title ?? null })),
  );
}

test("edit a pin's details from the palette; undo takes the edit back", async ({
  page,
}) => {
  await openEditor(page);

  await page.getByTestId("pin-tool-button").click();
  await expect(page.getByTestId("atlas-tool-overlay")).toBeVisible();
  await page.mouse.click(640, 400);
  await expect(page.getByTestId("atlas-tool-overlay")).toBeHidden();
  await expect.poll(() => pins(page)).toHaveLength(1);

  // Select the pin as a user does: the selection tool, a click on it.
  await setTool(page, "selection");
  await page.mouse.click(640, 400);

  await page.keyboard.press(`${MOD}+k`);
  await page.getByTestId("quick-actions-search").fill("pin details");
  await page.keyboard.press("Enter");

  const title = page.getByTestId("pin-details-title");
  await expect(title).toBeFocused();
  await title.fill("Well 4");
  await page.getByTestId("pin-details-save").click();
  await expect(page.getByTestId("pin-details-dialog")).toHaveCount(0);
  await expect.poll(async () => (await pins(page))[0]?.title).toBe("Well 4");

  await page.evaluate(() =>
    document.querySelector<HTMLElement>(".excalidraw-container")?.focus(),
  );
  await page.keyboard.press(`${MOD}+z`);
  await expect.poll(async () => (await pins(page))[0]?.title).toBeNull();
  expect(await pins(page)).toHaveLength(1);

  await page.keyboard.press(`${MOD}+Shift+z`);
  await expect.poll(async () => (await pins(page))[0]?.title).toBe("Well 4");
});
