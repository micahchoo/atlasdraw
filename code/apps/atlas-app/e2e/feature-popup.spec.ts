/**
 * The attribute popup, in a real browser.
 *
 * The unit tests prove the popup against a fake map. What only a browser can
 * settle is the chain: a real click on the plate passes through the
 * Excalidraw layer (selection tool), reaches MapLibre, hits the rendered
 * feature, and the popup takes the focus and lets it go again on Escape.
 */

import { test, expect, type Page } from "@playwright/test";

import { openEditor, setTool, type AtlasdrawHook } from "./helpers/atlas";

type HookWithLayers = AtlasdrawHook & {
  map: AtlasdrawHook["map"] & {
    getStyle: () => { layers: Array<{ id: string }> };
  };
};

/** Drop a file on the editor root, the way useDataFileImport listens. */
async function dropFile(page: Page, name: string, text: string) {
  await page.evaluate(
    ({ name, text }) => {
      const dt = new DataTransfer();
      dt.items.add(new File([text], name));
      const root = document.querySelector('[data-testid="map-editor-root"]');
      if (!root) {
        throw new Error("map-editor-root not in the DOM");
      }
      root.dispatchEvent(
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

/** A square of `half` degrees around the camera's centre. */
async function squareAtCentre(page: Page, half: number) {
  const c = await page.evaluate(() =>
    (
      window as unknown as { __atlasdraw__: AtlasdrawHook }
    ).__atlasdraw__.map.getCenter(),
  );
  const ring = [
    [c.lng - half, c.lat - half],
    [c.lng + half, c.lat - half],
    [c.lng + half, c.lat + half],
    [c.lng - half, c.lat + half],
    [c.lng - half, c.lat - half],
  ];
  return { centre: [c.lng, c.lat] as [number, number], ring };
}

/** The page position of a lng/lat on the map. */
async function pageAt(page: Page, lngLat: [number, number]) {
  return page.evaluate((ll) => {
    const map = (window as unknown as { __atlasdraw__: AtlasdrawHook })
      .__atlasdraw__.map;
    const canvas = document.querySelector(".maplibregl-canvas");
    const rect = canvas!.getBoundingClientRect();
    const p = map.project(ll);
    return { x: rect.left + p.x, y: rect.top + p.y };
  }, lngLat);
}

/** Open the editor with one parcel layer; return the parcel's page point. */
async function editorWithParcel(page: Page) {
  await openEditor(page);
  const { centre, ring } = await squareAtCentre(page, 10);
  const geojson = JSON.stringify({
    type: "FeatureCollection",
    features: [
      {
        type: "Feature",
        properties: { name: "Parcel <b>7</b>", owner: "City of Leeds" },
        geometry: { type: "Polygon", coordinates: [ring] },
      },
    ],
  });
  await dropFile(page, "parcels.geojson", geojson);

  // The layer is in the style before a click can hit it.
  await page.waitForFunction(
    () =>
      (window as unknown as { __atlasdraw__: HookWithLayers }).__atlasdraw__.map
        .getStyle()
        .layers.some((l) => l.id.startsWith("dl:")),
    undefined,
    { timeout: 15_000 },
  );
  await page.waitForTimeout(300);
  return {
    at: await pageAt(page, centre),
    // West of the parcel, by three tenths of its width: empty map.
    empty: await pageAt(page, [centre[0] - 13, centre[1]]),
  };
}

test.describe("attribute popup", () => {
  test("selection tool: a click on a feature shows its attributes", async ({
    page,
  }) => {
    const { at, empty } = await editorWithParcel(page);
    await setTool(page, "selection");
    await page.mouse.click(at.x, at.y);

    const popup = page.getByTestId("feature-popup");
    await expect(popup).toBeVisible();
    await expect(popup).toContainText("parcels");
    // Escaped: the value is text, there is no <b> element.
    await expect(popup.locator("td").first()).toHaveText("Parcel <b>7</b>");
    await expect(popup.locator("b")).toHaveCount(0);
    await expect(popup.locator("tbody tr")).toHaveCount(2);

    // Keyboard: the popup holds the focus, Tab reaches its close button.
    expect(
      await popup.evaluate((el) => el.contains(document.activeElement)),
    ).toBe(true);
    await page.keyboard.press("Tab");
    await expect(page.getByTestId("feature-popup-close")).toBeFocused();

    await page.keyboard.press("Escape");
    await expect(popup).toHaveCount(0);

    // A click on the empty map closes it too.
    await page.mouse.click(at.x, at.y);
    await expect(popup).toBeVisible();
    await page.mouse.click(empty.x, empty.y);
    await expect(popup).toHaveCount(0);
  });

  test("hand tool: a click on a feature shows its attributes", async ({
    page,
  }) => {
    const { at } = await editorWithParcel(page);
    await setTool(page, "hand");
    await page.mouse.click(at.x, at.y);

    const popup = page.getByTestId("feature-popup");
    await expect(popup).toBeVisible();
    await expect(popup.locator("td").nth(1)).toHaveText("City of Leeds");
  });
});
