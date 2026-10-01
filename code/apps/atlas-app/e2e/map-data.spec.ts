/**
 * Tile layers, labels and filters, in a real browser.
 *
 * The unit tests prove the spec against MapLibre's validator and a fake map.
 * What only a browser settles: the real MapLibre accepts the raster source
 * and the symbol layer, a filter really hides features, and the credit
 * reaches the status bar. Tile requests are answered here, so the test
 * calls no tile server.
 */

import { test, expect, type Page } from "@playwright/test";

import { openEditor, type AtlasdrawHook } from "./helpers/atlas";

type LiveMap = AtlasdrawHook["map"] & {
  getStyle: () => {
    layers: Array<{ id: string; type: string }>;
    sources: Record<string, { type: string; tiles?: string[] }>;
  };
  getFilter: (id: string) => unknown;
  queryRenderedFeatures: (o: { layers: string[] }) => unknown[];
};

/** The live map, read inside page.evaluate (closures do not cross). */
type Win = { __atlasdraw__: { map: LiveMap } };

// A 1×1 transparent PNG.
const PNG = Buffer.from(
  "iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAYAAAAfFcSJAAAADUlEQVR42mNkYPhfDwAChwGA60e6kgAAAABJRU5ErkJggg==",
  "base64",
);

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

test.describe("map data", () => {
  test("a tile layer from a URL lands on the map, and its credit in the status bar", async ({
    page,
  }) => {
    let tileRequests = 0;
    await page.route("https://tiles.e2e.example/**", (route) => {
      tileRequests++;
      return route.fulfill({ contentType: "image/png", body: PNG });
    });
    await openEditor(page);
    await page.evaluate(() =>
      (
        window as unknown as {
          __atlasdraw__: {
            excalidrawAPI: {
              toggleSidebar: (o: { name: string; tab: string }) => void;
            };
          };
        }
      ).__atlasdraw__.excalidrawAPI.toggleSidebar({
        name: "default",
        tab: "layers",
      }),
    );

    await page.getByTestId("tile-add-open").click();
    await page
      .getByTestId("tile-url")
      .fill("https://tiles.e2e.example/{z}/{x}/{y}.png");
    await page.getByTestId("tile-attribution").fill("© E2E Aerials");
    await page.getByTestId("tile-add-submit").click();

    await expect
      .poll(() =>
        page.evaluate(
          () =>
            (window as unknown as Win).__atlasdraw__.map
              .getStyle()
              .layers.filter((l) => l.id.startsWith("tl:"))
              .map((l) => l.type),
          undefined,
        ),
      )
      .toEqual(["raster"]);
    await expect(page.getByTestId("status-bar-attribution")).toContainText(
      "© E2E Aerials",
    );
    await expect.poll(() => tileRequests).toBeGreaterThan(0);
  });

  test("a filter hides features, and a label layer is drawn from a property", async ({
    page,
  }) => {
    await openEditor(page);
    const c = await page.evaluate(() =>
      (window as unknown as Win).__atlasdraw__.map.getCenter(),
    );
    const point = (dx: number, kind: string, name: string) => ({
      type: "Feature",
      properties: { kind, name },
      geometry: { type: "Point", coordinates: [c.lng + dx, c.lat] },
    });
    await dropFile(
      page,
      "sites.geojson",
      JSON.stringify({
        type: "FeatureCollection",
        features: [
          point(-1, "school", "North School"),
          point(0, "well", "Well 4"),
          point(1, "school", "South School"),
        ],
      }),
    );

    const id = await page
      .locator('[data-testid^="layer-disclosure-dl:"]')
      .getAttribute("data-testid", { timeout: 15_000 })
      .then((t) => t!.replace("layer-disclosure-", ""));
    const rendered = () =>
      page.evaluate(
        (layer) =>
          (window as unknown as Win).__atlasdraw__.map.queryRenderedFeatures({
            layers: [layer],
          }).length,
        id,
      );
    await expect.poll(rendered).toBe(3);

    await page.getByTestId(`layer-disclosure-${id}`).click();

    await page.getByTestId("filter-property").selectOption("kind");
    await page.getByTestId("filter-op").selectOption("==");
    await page.getByTestId("filter-value").fill("school");
    await page.getByTestId("filter-apply").click();
    await expect.poll(rendered).toBe(2);

    await page.getByTestId("label-property").selectOption("name");
    await page.getByTestId("label-apply").click();
    await expect
      .poll(() =>
        page.evaluate(
          (layer) =>
            (window as unknown as Win).__atlasdraw__.map
              .getStyle()
              .layers.find((l) => l.id === `${layer}::label`)?.type,
          id,
        ),
      )
      .toBe("symbol");
    // The label layer carries the same filter.
    expect(
      await page.evaluate(
        (layer) =>
          JSON.stringify(
            (window as unknown as Win).__atlasdraw__.map.getFilter(
              `${layer}::label`,
            ),
          ) ===
          JSON.stringify(
            (window as unknown as Win).__atlasdraw__.map.getFilter(layer),
          ),
        id,
      ),
    ).toBe(true);
    await expect(page.getByTestId("style-rejected")).toHaveCount(0);

    await page.getByTestId("filter-remove").click();
    await expect.poll(rendered).toBe(3);
  });
});
