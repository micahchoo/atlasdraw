/**
 * The crash screen keeps its promise (audit2-05 H2): an edit made inside
 * the autosave delay is saved when a render error takes the editor down,
 * and Reload brings it back.
 */

import { test, expect, type Page } from "@playwright/test";

import { drawRectangle, openEditor, setTool } from "./helpers/atlas";

type Hook = {
  excalidrawAPI: { getSceneElements: () => unknown[] };
  isDirty: () => boolean;
  session: { view: { setState: (s: object) => void } };
};

const count = (page: Page) =>
  page.evaluate(
    () =>
      (
        window as unknown as { __atlasdraw__: Hook }
      ).__atlasdraw__.excalidrawAPI.getSceneElements().length,
  );

test("an edit inside the autosave delay survives a crash and a reload", async ({
  page,
}) => {
  await openEditor(page);
  await drawRectangle(page, { x0: 560, y0: 300, x1: 700, y1: 380 });
  await setTool(page, "selection");
  await expect
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

  // A second rectangle, then a render error before the autosave runs.
  await drawRectangle(page, { x0: 560, y0: 500, x1: 700, y1: 580 });
  await setTool(page, "selection");
  expect(await count(page)).toBe(2);
  await page.evaluate(() => {
    // A dialog whose title is an object: React cannot render it.
    (
      window as unknown as { __atlasdraw__: Hook }
    ).__atlasdraw__.session.view.setState({
      dialog: {
        kind: "confirm",
        title: { boom: 1 },
        body: "x",
        confirmLabel: "y",
        answer() {},
      },
    });
  });
  const crash = page.getByTestId("error-boundary");
  await expect(crash).toBeVisible();
  await expect(crash).toContainText("saved in this browser");

  await page.getByTestId("error-boundary-reload").click();
  await page.waitForFunction(
    () =>
      Boolean(
        (window as unknown as { __atlasdraw__?: Hook }).__atlasdraw__
          ?.excalidrawAPI,
      ),
    undefined,
    { timeout: 30_000 },
  );
  await expect.poll(() => count(page), { timeout: 10_000 }).toBe(2);
});
