/**
 * The right-click menus in a real browser. The unit tests prove that the
 * menus are built from the command list (src/commands/contextMenus.ts). What
 * only a browser can settle: the right-click reaches the drawing over the
 * map, the menu shows the items, and an item acts where the menu opened.
 */

import { test, expect, type Page } from "@playwright/test";

import {
  drawRectangle,
  openEditor,
  setTool,
  type AtlasdrawHook,
} from "./helpers/atlas";

const MOD = process.platform === "darwin" ? "Meta" : "Control";

type Hook = AtlasdrawHook & {
  map: AtlasdrawHook["map"] & {
    getStyle: () => { layers: Array<{ id: string }> };
  };
  excalidrawAPI: AtlasdrawHook["excalidrawAPI"] & {
    getAppState: () => { objectsSnapModeEnabled: boolean };
  };
};

const hook = (page: Page) =>
  page.evaluate(() => {
    const w = window as unknown as { __atlasdraw__: Hook };
    const api = w.__atlasdraw__.excalidrawAPI;
    return {
      elements: api
        .getSceneElements()
        .map((e) => ({ id: e.id, type: e.type, customData: e.customData })),
      snap: api.getAppState().objectsSnapModeEnabled,
      zoom: w.__atlasdraw__.map.getZoom(),
    };
  });

const menu = (page: Page) => page.locator(".context-menu");

/** The menu's items, as `data-testid` (the item's name) and label. */
const items = (page: Page) =>
  menu(page)
    .locator("li")
    .evaluateAll((lis) =>
      lis.map((li) => ({
        name: li.getAttribute("data-testid") ?? "",
        label: li.querySelector(".context-menu-item__label")?.textContent ?? "",
      })),
    );

/** The page point of a lng/lat. */
async function pageAt(page: Page, lngLat: [number, number]) {
  return page.evaluate((ll) => {
    const map = (window as unknown as { __atlasdraw__: Hook }).__atlasdraw__
      .map;
    const rect = document
      .querySelector(".maplibregl-canvas")!
      .getBoundingClientRect();
    const p = map.project(ll);
    return { x: rect.left + p.x, y: rect.top + p.y };
  }, lngLat);
}

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

/** One square parcel, 10 degrees each way around the camera's centre. */
async function addParcel(page: Page) {
  const c = await page.evaluate(() =>
    (
      window as unknown as { __atlasdraw__: Hook }
    ).__atlasdraw__.map.getCenter(),
  );
  const h = 10;
  const ring = [
    [c.lng - h, c.lat - h],
    [c.lng + h, c.lat - h],
    [c.lng + h, c.lat + h],
    [c.lng - h, c.lat + h],
    [c.lng - h, c.lat - h],
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
  await page.waitForFunction(
    () =>
      (window as unknown as { __atlasdraw__: Hook }).__atlasdraw__.map
        .getStyle()
        .layers.some((l) => l.id.startsWith("dl:")),
    undefined,
    { timeout: 15_000 },
  );
  await page.waitForTimeout(300);
  return pageAt(page, [c.lng, c.lat]);
}

test("the canvas menu: the registry's items, none of the upstream toggles, and each one is in the palette", async ({
  page,
}) => {
  await openEditor(page);
  await setTool(page, "selection");
  await page.mouse.click(300, 650, { button: "right" });
  await expect(menu(page)).toBeVisible();

  const shown = await items(page);
  const labels = shown.map((i) => i.label);
  for (const label of [
    "Paste",
    "Pin here",
    "Measure distance",
    "Import data…",
    "Layers panel",
    "Zoom in",
    "Zoom out",
    "Snap to objects",
    "Arrow binding",
    "Snap to midpoints",
  ]) {
    expect(labels, label).toContain(label);
  }
  for (const gone of ["gridMode", "zenMode", "viewMode", "stats"]) {
    expect(shown.map((i) => i.name)).not.toContain(gone);
  }

  // Every item the registry put here is a command the palette lists.
  const commands = shown
    .filter((i) => i.name.includes(":"))
    .map((i) => i.name.split(":")[1]);
  expect(commands.length).toBeGreaterThan(5);
  await page.keyboard.press("Escape");
  await page.keyboard.press(`${MOD}+k`);
  await expect(page.getByTestId("quick-actions-panel")).toBeVisible();
  for (const id of commands) {
    await expect(page.getByTestId(`quick-action-${id}`), id).toHaveCount(1);
  }
});

test("Pin here places a pin where the menu opened", async ({ page }) => {
  await openEditor(page);
  await setTool(page, "selection");
  await page.mouse.click(640, 420, { button: "right" });
  await menu(page).getByText("Pin here").click();

  await expect
    .poll(async () =>
      (
        await hook(page)
      ).elements.filter(
        (e) => (e.customData as { tool?: string })?.tool === "pin",
      ),
    )
    .toHaveLength(1);
  // The pin is under the point: a left click there selects it.
  await page.mouse.click(640, 420);
  await page.mouse.click(640, 420, { button: "right" });
  await expect(menu(page).getByText("Edit pin details…")).toBeVisible();
  await menu(page).getByText("Edit pin details…").click();
  await expect(page.getByTestId("pin-details-dialog")).toBeVisible();
});

test("a shape's menu keeps the drawing's own items and adds the registry's", async ({
  page,
}) => {
  await openEditor(page);
  await drawRectangle(page, { x0: 560, y0: 330, x1: 720, y1: 450 });
  await setTool(page, "selection");
  await page.mouse.click(640, 330, { button: "right" });

  const labels = (await items(page)).map((i) => i.label);
  for (const label of [
    "Cut",
    "Copy",
    "Delete",
    "Comment mode",
    "Zoom to selection",
    "Convert selection to data layer",
  ]) {
    expect(labels, label).toContain(label);
  }

  await menu(page).getByText("Convert selection to data layer").click();
  await expect
    .poll(async () => (await hook(page)).elements.map((e) => e.type))
    .toEqual([]);
});

test("a feature's menu: Show attribute table and Zoom to feature", async ({
  page,
}) => {
  await openEditor(page);
  const parcel = await addParcel(page);
  await setTool(page, "selection");

  await page.mouse.click(parcel.x, parcel.y, { button: "right" });
  const labels = (await items(page)).map((i) => i.label);
  expect(labels).toContain("Show attribute table");
  expect(labels).toContain("Zoom to feature");
  await menu(page).getByText("Show attribute table").click();
  await expect(page.getByTestId("attribute-table-count")).toBeVisible();
  await page.getByTestId("attribute-table-close").click();

  const before = (await hook(page)).zoom;
  await page.mouse.click(parcel.x, parcel.y, { button: "right" });
  await menu(page).getByText("Zoom to feature").click();
  await expect.poll(async () => (await hook(page)).zoom).not.toBe(before);

  // Off the feature, the canvas menu has no feature items.
  await page.mouse.click(60, 700, { button: "right" });
  const off = (await items(page)).map((i) => i.label);
  expect(off).not.toContain("Show attribute table");
  expect(off).toContain("Pin here");
});

test("Snap to objects, from the canvas menu, turns the drawing's snapping on and shows it checked", async ({
  page,
}) => {
  await openEditor(page);
  await setTool(page, "selection");
  expect((await hook(page)).snap).toBe(false);

  await page.mouse.click(300, 650, { button: "right" });
  await menu(page).getByText("Snap to objects").click();
  expect((await hook(page)).snap).toBe(true);

  await page.mouse.click(300, 650, { button: "right" });
  await expect(
    menu(page).locator('[data-testid="canvas:edit.snap-objects"] .checkmark'),
  ).toHaveCount(1);
});
