/**
 * Data in, data out, data read, in a real browser.
 *
 * A CSV whose geometry is Well-Known Text becomes a line layer, and its bad
 * row is counted. That layer saved as KML and dropped back in gives the same
 * features, which the attribute table lists, searches, sorts and zooms to.
 *
 * The unit tests read the importers and writers in jsdom. Only a browser
 * runs the import in its Web Worker, saves the KML through a real download,
 * and lays out the table dialog over the map.
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

/** The ids of the data layers in the panel, in the panel's order. */
async function dataLayerIds(page: Page, count: number): Promise<string[]> {
  const rows = page.locator('[data-testid^="layer-disclosure-dl:"]');
  await expect(rows).toHaveCount(count, { timeout: 15_000 });
  const ids = await rows.evaluateAll((els) =>
    els.map((el) => el.getAttribute("data-testid")!),
  );
  return ids.map((t) => t.replace("layer-disclosure-", ""));
}

const ROADS_CSV = [
  "name,lanes,WKT",
  'Ridge Road,2,"LINESTRING (2.30 48.85, 2.35 48.86)"',
  'Mill Lane,1,"LINESTRING (2.31 48.84, 2.33 48.83, 2.36 48.835)"',
  'Broken,3,"LINESTRING (2.3)"',
].join("\n");

test("a WKT CSV imports as lines; its KML export reads back; the attribute table lists it", async ({
  page,
}) => {
  await openEditor(page);
  await dropFile(page, "roads.csv", ROADS_CSV);
  const [roads] = await dataLayerIds(page, 1);

  await page.getByTestId(`layer-disclosure-${roads}`).click();
  const provenance = page.getByTestId(`layer-provenance-${roads}`);
  await expect(provenance).toContainText("LineString");
  await expect(provenance).toContainText("Dropped1");

  // Save the layer as KML, then import the file that was saved.
  await page.getByTestId(`layer-menu-${roads}`).click();
  const [download] = await Promise.all([
    page.waitForEvent("download"),
    page.getByRole("menuitem", { name: "Export as KML", exact: true }).click(),
  ]);
  expect(download.suggestedFilename()).toBe("roads_csv.kml");
  const kml = await readFile((await download.path())!, "utf8");
  // The KML says lanes holds numbers, so it comes back as numbers.
  expect(kml).toContain('<SimpleField name="lanes" type="double"/>');
  await dropFile(page, "roads.kml", kml);
  const ids = await dataLayerIds(page, 2);
  const back = ids.find((id) => id !== roads)!;

  // The table of the layer read back from KML.
  await page.getByTestId(`layer-menu-${back}`).click();
  await page.getByTestId(`layer-table-${back}`).click();
  const dialog = page.getByRole("dialog", { name: "Attributes: roads.kml" });
  await expect(dialog).toBeVisible();
  const firstColumn = () =>
    dialog
      .locator("tbody tr")
      .evaluateAll((rows) =>
        rows.map((r) => r.querySelector("td")!.textContent),
      );
  expect(await firstColumn()).toEqual(["Ridge Road", "Mill Lane"]);
  await expect(dialog.locator("thead th")).toHaveText([
    "name",
    "lanes",
    "Zoom",
  ]);

  // A column header sorts the rows.
  await dialog.getByTestId("attribute-table-sort-lanes").click();
  expect(await firstColumn()).toEqual(["Mill Lane", "Ridge Road"]);

  await dialog.getByTestId("attribute-table-search").fill("ridge");
  expect(await firstColumn()).toEqual(["Ridge Road"]);
  await expect(dialog.getByTestId("attribute-table-count")).toHaveText(
    "1 of 2 features match",
  );

  // Zoom frames the feature and closes the dialog, so the map shows it.
  await dialog.getByRole("button", { name: "Zoom to Ridge Road" }).click();
  await expect(dialog).toBeHidden();
});
