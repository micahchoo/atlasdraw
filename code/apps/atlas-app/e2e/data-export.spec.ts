/**
 * Data-layer export in a real browser.
 *
 * The unit tests read the Blob that jsdom is handed. Only a browser settles
 * that the <a download> on a blob URL really saves a file, with the layer's
 * name, and that the file holds what the layer holds.
 */

import { readFile } from "node:fs/promises";

import { test, expect, type Page } from "@playwright/test";

import { openEditor } from "./helpers/atlas";

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

const SITES = {
  type: "FeatureCollection",
  features: [
    {
      type: "Feature",
      properties: { name: "Well 4, north", depth: 12.5 },
      geometry: { type: "Point", coordinates: [2.3522, 48.8566] },
    },
  ],
};

async function saveFromMenu(page: Page, id: string, item: string) {
  await page.getByTestId(`layer-menu-${id}`).click();
  const [download] = await Promise.all([
    page.waitForEvent("download"),
    page.getByRole("menuitem", { name: item, exact: true }).click(),
  ]);
  const path = await download.path();
  return {
    name: download.suggestedFilename(),
    text: await readFile(path!, "utf8"),
  };
}

test("a data layer's ⋯ menu saves it as CSV and as GeoJSON", async ({
  page,
}) => {
  await openEditor(page);
  await dropFile(page, "sites.geojson", JSON.stringify(SITES));

  const id = await page
    .locator('[data-testid^="layer-disclosure-dl:"]')
    .getAttribute("data-testid", { timeout: 15_000 })
    .then((t) => t!.replace("layer-disclosure-", ""));

  const csv = await saveFromMenu(page, id, "Export as CSV");
  expect(csv.name).toBe("sites_geojson.csv");
  expect(csv.text).toBe(
    'longitude,latitude,name,depth\r\n2.3522,48.8566,"Well 4, north",12.5\r\n',
  );

  const geojson = await saveFromMenu(page, id, "Export as GeoJSON");
  expect(geojson.name).toBe("sites_geojson.geojson");
  expect(JSON.parse(geojson.text)).toEqual({
    ...SITES,
    name: "sites.geojson",
  });
});
