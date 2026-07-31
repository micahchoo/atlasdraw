/**
 * Dropping a GeoTIFF, in a real browser.
 *
 * The unit tests prove each piece: the decoder against real TIFF bytes, the
 * map write against a stub, the panel against a seeded registry, the round trip
 * against a synthesised document. What none of them can prove is the chain —
 * drop → decode → OffscreenCanvas encode → object URL → MapLibre `image` source
 * → a layer that is actually in the style. Three of those five links do not
 * exist in jsdom at all, which is exactly the case the UI conventions rule was
 * written for: a claim about something being on the map is not a claim jsdom
 * can settle.
 *
 * The fixture is generated here with geotiff's writer and handed to the page as
 * bytes, so there is no committed binary and the CRS under test is a literal.
 */

import { test, expect } from "@playwright/test";
import { writeArrayBuffer } from "geotiff";

interface AtlasdrawWindow {
  __atlasdraw__?: {
    map: {
      getLayer: (id: string) => unknown;
      getStyle: () => { layers: Array<{ id: string; type: string }> };
    };
  };
}

/** A solid-grey north-up RGB GeoTIFF over the given WGS84 extent. */
function makeGeoTiff(
  bbox: [number, number, number, number] = [10, 20, 11, 21],
  crsKey: Record<string, number> = { GeographicTypeGeoKey: 4326 },
): number[] {
  const [west, south, east, north] = bbox;
  const width = 8;
  const height = 8;
  const buf = writeArrayBuffer(new Uint8Array(width * height * 3).fill(120), {
    width,
    height,
    SamplesPerPixel: 3,
    BitsPerSample: [8, 8, 8],
    PhotometricInterpretation: 2,
    ModelTiepoint: [0, 0, 0, west, north, 0],
    ModelPixelScale: [(east - west) / width, (north - south) / height, 0],
    ...crsKey,
  } as never);
  // Plain array so it survives Playwright's structured-clone into the page.
  return Array.from(new Uint8Array(buf));
}

async function waitForApp(page: import("@playwright/test").Page) {
  await page.addInitScript(() => {
    localStorage.setItem("atlasdraw-onboarding-dismissed", "1");
  });
  await page.goto("/");
  await expect(page.getByTestId("onboarding-scrim")).toHaveCount(0);
  await page.waitForSelector(".maplibregl-canvas-container", {
    state: "attached",
    timeout: 30_000,
  });
  await page.waitForFunction(
    () => (window as unknown as AtlasdrawWindow).__atlasdraw__ != null,
    { timeout: 30_000 },
  );
  await page.waitForTimeout(2000);
}

/**
 * A real `drop` on the editor root, which is the path a user takes.
 *
 * Playwright cannot synthesise an OS drag carrying a file, so the DataTransfer
 * is built in the page — but the event itself is dispatched on the real element
 * and travels through the app's own capture-phase listener, which is the part
 * under test.
 */
async function dropFile(
  page: import("@playwright/test").Page,
  name: string,
  bytes: number[],
) {
  await page.evaluate(
    ({ name, bytes }) => {
      const file = new File([new Uint8Array(bytes)], name);
      const dt = new DataTransfer();
      dt.items.add(file);
      // `[data-testid="map-editor-root"]` is the element useDataFileImport
      // attaches its capture-phase listener to. Dispatching on a guess — the
      // excalidraw container's parent, say — silently does nothing: the event
      // fires, nothing handles it, and every assertion downstream fails with
      // "element not found" rather than anything pointing here.
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
    { name, bytes },
  );
}

test.describe("GeoTIFF import", () => {
  test("a dropped GeoTIFF lands on the map and in the panel", async ({
    page,
  }) => {
    await waitForApp(page);
    await dropFile(page, "survey-sheet.tif", makeGeoTiff());

    // The panel row. Its testid carries the registry id, so matching `rl:`
    // also proves the id namespace survived the whole path.
    const row = page.locator('[data-testid^="layer-name-rl:"]');
    await expect(row).toHaveCount(1, { timeout: 15_000 });
    await expect(row).toHaveText("survey-sheet.tif");

    // And the part only a browser knows: a raster layer really is in the
    // MapLibre style. The unit tests assert addSource was called; this asserts
    // MapLibre accepted it.
    const layer = await page.evaluate(() => {
      const w = window as unknown as AtlasdrawWindow;
      return (
        w.__atlasdraw__?.map
          .getStyle()
          .layers.find((l) => l.id.startsWith("rl:")) ?? null
      );
    });
    expect(layer).not.toBeNull();
    expect(layer?.type).toBe("raster");
  });

  test("the image sits below the vector layers", async ({ page }) => {
    await waitForApp(page);
    await dropFile(page, "sheet.tif", makeGeoTiff());
    await expect(page.locator('[data-testid^="layer-name-rl:"]')).toHaveCount(
      1,
      { timeout: 15_000 },
    );

    await page.evaluate(() => {
      const fc = {
        type: "FeatureCollection",
        features: [
          {
            type: "Feature",
            properties: {},
            geometry: {
              type: "Polygon",
              coordinates: [
                [
                  [10.2, 20.2],
                  [10.8, 20.2],
                  [10.8, 20.8],
                  [10.2, 20.2],
                ],
              ],
            },
          },
        ],
      };
      const file = new File([JSON.stringify(fc)], "parcels.geojson");
      const dt = new DataTransfer();
      dt.items.add(file);
      document.querySelector('[data-testid="map-editor-root"]')!.dispatchEvent(
        new DragEvent("drop", {
          bubbles: true,
          cancelable: true,
          dataTransfer: dt,
        }),
      );
    });
    await expect(page.locator('[data-testid^="layer-name-dl:"]')).toHaveCount(
      1,
      { timeout: 15_000 },
    );

    const order = await page.evaluate(() => {
      const w = window as unknown as AtlasdrawWindow;
      return w.__atlasdraw__!.map.getStyle().layers.map((l) => l.id);
    });
    const rasterAt = order.findIndex((id) => id.startsWith("rl:"));
    const vectorAt = order.findIndex((id) => id.startsWith("dl:"));
    expect(rasterAt).toBeGreaterThanOrEqual(0);
    expect(vectorAt).toBeGreaterThanOrEqual(0);
    // MapLibre draws in style order, so earlier is lower. A raster that can
    // cover your own work is a way to lose it without deleting anything.
    expect(rasterAt).toBeLessThan(vectorAt);
  });

  test("a UTM file is refused by name, not placed in the wrong ocean", async ({
    page,
  }) => {
    await waitForApp(page);
    await dropFile(
      page,
      "utm-survey.tif",
      // EPSG:32643, UTM zone 43N, with a real UTM extent in metres. Read as
      // degrees this lands in the Gulf of Guinea — and it RENDERS, which is
      // what makes accepting it the worst available outcome.
      makeGeoTiff([500000, 1900000, 501000, 1901000], {
        ProjectedCSTypeGeoKey: 32643,
      }),
    );

    const toast = page.getByTestId("toast-error");
    await expect(toast).toBeVisible({ timeout: 15_000 });
    await expect(toast).toContainText("EPSG:32643");
    await expect(toast).toContainText(/reproject/i);
    await expect(page.locator('[data-testid^="layer-name-rl:"]')).toHaveCount(
      0,
    );
  });
});
