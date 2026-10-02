/**
 * The fork's doors that skipped the product's rules, closed:
 *
 * - A `.excalidraw` file dropped on the canvas opens as Open does: a new map
 *   with a new id, where the user is looking. Upstream replaced the open
 *   drawing and threw the camera to zoom 22.
 * - An `iframe` element that carries script HTML renders nothing, from a
 *   file or put straight into the scene.
 */

import { test, expect, type Page } from "@playwright/test";

import {
  drawRectangle,
  openEditor,
  readCamera,
  setTool,
  type AtlasdrawHook,
} from "./helpers/atlas";

const RECT = { x0: 560, y0: 330, x1: 720, y1: 450 };

type Hook = AtlasdrawHook & {
  session: { store: { getState: () => { doc: { id: string } } } };
};

const docId = (page: Page) =>
  page.evaluate(
    () =>
      (
        window as unknown as { __atlasdraw__: Hook }
      ).__atlasdraw__.session.store.getState().doc.id,
  );

const sceneIds = (page: Page) =>
  page.evaluate(() =>
    (window as unknown as { __atlasdraw__: Hook }).__atlasdraw__.excalidrawAPI
      .getSceneElements()
      .map((e) => e.id),
  );

const element = (id: string, type: string, extra: object = {}) => ({
  id,
  type,
  x: 0,
  y: 0,
  width: 300,
  height: 200,
  angle: 0,
  strokeColor: "#1e1e1e",
  backgroundColor: "transparent",
  fillStyle: "solid",
  strokeWidth: 2,
  strokeStyle: "solid",
  roughness: 1,
  opacity: 100,
  groupIds: [],
  frameId: null,
  roundness: null,
  seed: 1,
  version: 1,
  versionNonce: 1,
  isDeleted: false,
  boundElements: null,
  updated: 1,
  link: null,
  locked: false,
  ...extra,
});

const SCRIPT = {
  customData: {
    generationData: {
      status: "done",
      html: "<form action='https://evil.example'></form><script>1</script>",
    },
  },
};

/** Drop a file on the drawing's canvas, as a user would. */
async function dropFile(page: Page, name: string, text: string) {
  await page.evaluate(
    ({ name, text }) => {
      const dt = new DataTransfer();
      dt.items.add(
        new File([text], name, { type: "application/vnd.excalidraw+json" }),
      );
      const target =
        document.querySelector(".excalidraw .excalidraw__canvas.interactive") ??
        document.querySelector(".excalidraw");
      target!.dispatchEvent(
        new DragEvent("drop", {
          dataTransfer: dt,
          bubbles: true,
          cancelable: true,
          clientX: 600,
          clientY: 400,
        }),
      );
    },
    { name, text },
  );
}

const sceneFile = (elements: object[]) =>
  JSON.stringify({
    type: "excalidraw",
    version: 2,
    source: "https://excalidraw.com",
    elements,
    appState: { viewBackgroundColor: "#ffffff", zoom: { value: 1 } },
    files: {},
  });

test("a dropped .excalidraw file opens as a new map; the open map and the camera stay", async ({
  page,
}) => {
  await openEditor(page);
  await drawRectangle(page, RECT);
  await setTool(page, "selection");
  const ownId = await docId(page);
  const ownScene = await sceneIds(page);
  expect(ownScene).toHaveLength(1);
  const before = await readCamera(page);

  await dropFile(
    page,
    "drawing.excalidraw",
    sceneFile([element("dropped", "rectangle")]),
  );

  // The open map holds a drawing that is not in a file: the user is asked.
  await page.getByTestId("confirm-dialog-confirm").click();
  await expect.poll(() => docId(page)).not.toBe(ownId);
  expect(await sceneIds(page)).toEqual(["dropped"]);

  const after = await readCamera(page);
  expect(after.zoom).toBeCloseTo(before.zoom, 3);
  expect(after.lng).toBeCloseTo(before.lng, 4);
  expect(after.lat).toBeCloseTo(before.lat, 4);

  // The first map is still in My maps, with its own drawing.
  await page.getByTestId("main-menu-trigger").click();
  await page.getByTestId("main-menu-my-maps").click();
  const dialog = page.getByRole("dialog", { name: "My maps" });
  await expect(dialog.getByTestId("my-maps-row")).toHaveCount(2);
  // The other row: the open map's own button is disabled.
  await dialog.locator('[data-testid="my-maps-open"]:not([disabled])').click();
  await expect.poll(() => docId(page)).toBe(ownId);
  expect(await sceneIds(page)).toEqual(ownScene);
});

test("an iframe element with script HTML renders nothing", async ({ page }) => {
  await openEditor(page);

  // From a file: the element is dropped, the rest opens, the user is told.
  await dropFile(
    page,
    "planted.excalidraw",
    sceneFile([element("evil", "iframe", SCRIPT), element("ok", "rectangle")]),
  );
  await expect.poll(() => sceneIds(page)).toEqual(["ok"]);
  await expect(
    page.getByText(/were left out: 1 drawing element\./),
  ).toBeVisible();
  await expect(page.locator("iframe")).toHaveCount(0);

  // Straight into the scene, past every check: the renderer draws no page.
  await page.evaluate(
    ({ el }) => {
      const api = (
        window as unknown as {
          __atlasdraw__: {
            excalidrawAPI: { updateScene: (d: { elements: object[] }) => void };
          };
        }
      ).__atlasdraw__.excalidrawAPI;
      api.updateScene({ elements: [el] });
    },
    { el: element("evil2", "iframe", SCRIPT) },
  );
  await page.waitForTimeout(300);
  await expect(page.locator("iframe")).toHaveCount(0);
  expect(await page.content()).not.toContain("evil.example");
});
