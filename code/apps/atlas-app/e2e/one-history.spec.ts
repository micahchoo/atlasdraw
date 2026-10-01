/**
 * One history (R4): the drawing and the document share one undo order, and
 * "unsaved" is the history's position against the last save.
 *
 * A unit test holds each half against a fake. Only a browser shows that the
 * real keys reach the one history through the drawing (`historyHost`), and
 * that opening a map in a real editor is not an edit.
 */

import { test, expect, type Page } from "@playwright/test";

import {
  drawRectangle,
  openEditor,
  setTool,
  type AtlasdrawHook,
} from "./helpers/atlas";

type Overlay = {
  id: string;
  kind: string;
  style?: { strokeWidth?: number };
};

type Hook = AtlasdrawHook & {
  isDirty: () => boolean;
  session: {
    store: {
      getState: () => {
        doc: { snapshot: () => { overlays: Overlay[] } };
      };
    };
    persistence: {
      getState: () => { forceSave: () => Promise<void> };
    };
  };
  excalidrawAPI: AtlasdrawHook["excalidrawAPI"] & {
    toggleSidebar: (opts: { name: string; tab: string }) => void;
  };
};

const hook = (page: Page) =>
  page.evaluateHandle(
    () => (window as unknown as { __atlasdraw__: Hook }).__atlasdraw__,
  );

const overlays = (page: Page): Promise<Overlay[]> =>
  page.evaluate(() =>
    (window as unknown as { __atlasdraw__: Hook }).__atlasdraw__.session.store
      .getState()
      .doc.snapshot()
      .overlays.map((e) => ({
        id: e.id,
        kind: e.kind,
        style: e.style ? { strokeWidth: e.style.strokeWidth } : undefined,
      })),
  );

const isDirty = (page: Page): Promise<boolean> =>
  page.evaluate(() =>
    (window as unknown as { __atlasdraw__: Hook }).__atlasdraw__.isDirty(),
  );

const shapes = (page: Page): Promise<number> =>
  page.evaluate(
    () =>
      (
        window as unknown as { __atlasdraw__: Hook }
      ).__atlasdraw__.excalidrawAPI.getSceneElements().length,
  );

/** Drop a file on the editor root, the way useDataFileImport listens. */
async function dropFile(page: Page, name: string, text: string) {
  await page.evaluate(
    ({ name, text }) => {
      const dt = new DataTransfer();
      dt.items.add(new File([text], name));
      document.querySelector('[data-testid="map-editor-root"]')!.dispatchEvent(
        new DragEvent("drop", {
          bubbles: true,
          cancelable: true,
          dataTransfer: dt,
        }),
      );
    },
    { name, text },
  );
}

/**
 * A key the drawing hears. In a text field Ctrl+Z is the field's own undo,
 * so focus goes to the drawing first, as a click on the map would.
 */
async function press(page: Page, key: string) {
  await page.evaluate(() =>
    document.querySelector<HTMLElement>(".excalidraw-container")?.focus(),
  );
  await page.keyboard.press(key);
}

test("import a layer, restyle it, undo twice, redo", async ({ page }) => {
  await openEditor(page);
  const c = await page.evaluate(() =>
    (
      window as unknown as { __atlasdraw__: Hook }
    ).__atlasdraw__.map.getCenter(),
  );
  const ring = [
    [c.lng - 5, c.lat - 5],
    [c.lng + 5, c.lat - 5],
    [c.lng + 5, c.lat + 5],
    [c.lng - 5, c.lat + 5],
    [c.lng - 5, c.lat - 5],
  ];
  await dropFile(
    page,
    "parcels.geojson",
    JSON.stringify({
      type: "FeatureCollection",
      features: [
        {
          type: "Feature",
          properties: { name: "Parcel 7" },
          geometry: { type: "Polygon", coordinates: [ring] },
        },
      ],
    }),
  );
  await expect.poll(() => overlays(page)).toHaveLength(1);
  const [{ id, style }] = await overlays(page);
  const width = style?.strokeWidth;

  // Restyle in the Layers panel, as a user does. An import may open it.
  if ((await page.getByTestId("layer-panel-body").count()) === 0) {
    await (
      await hook(page)
    ).evaluate((h) =>
      h.excalidrawAPI.toggleSidebar({ name: "default", tab: "layers" }),
    );
  }
  await page.getByTestId(`layer-disclosure-${id}`).click();
  await page.getByTestId(`layer-width-${id}`).fill("7");
  await expect
    .poll(async () => (await overlays(page))[0]?.style?.strokeWidth)
    .toBe(7);

  await press(page, "Control+z");
  await expect
    .poll(async () => (await overlays(page))[0]?.style?.strokeWidth)
    .toBe(width);

  await press(page, "Control+z");
  await expect.poll(() => overlays(page)).toHaveLength(0);

  await press(page, "Control+Shift+z");
  await expect.poll(() => overlays(page)).toHaveLength(1);
  expect((await overlays(page))[0].id).toBe(id);
});

test("open a map: clean; edit: dirty; save: clean; undo past the save: dirty", async ({
  page,
}) => {
  await openEditor(page);
  await drawRectangle(page, { x0: 560, y0: 300, x1: 700, y1: 380 });
  await setTool(page, "selection");
  await expect.poll(() => isDirty(page), { timeout: 15_000 }).toBe(false);

  // Opening the saved map (a reload) is not an edit.
  await page.reload();
  await page.waitForFunction(
    () =>
      (
        window as unknown as { __atlasdraw__?: Hook }
      ).__atlasdraw__?.excalidrawAPI.getSceneElements().length === 1,
    undefined,
    { timeout: 30_000 },
  );
  await page.waitForTimeout(500);
  expect(await isDirty(page)).toBe(false);

  // An edit.
  await drawRectangle(page, { x0: 560, y0: 450, x1: 700, y1: 530 });
  await setTool(page, "selection");
  expect(await shapes(page)).toBe(2);
  expect(await isDirty(page)).toBe(true);

  // A save.
  await (
    await hook(page)
  ).evaluate((h) => h.session.persistence.getState().forceSave());
  expect(await isDirty(page)).toBe(false);

  // Undo past the save, through the drawing's own key.
  await press(page, "Control+z");
  await expect.poll(() => shapes(page)).toBe(1);
  expect(await isDirty(page)).toBe(true);

  // And redo back to it.
  await press(page, "Control+Shift+z");
  await expect.poll(() => shapes(page)).toBe(2);
  expect(await isDirty(page)).toBe(false);
});
