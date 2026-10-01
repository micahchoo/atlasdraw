/**
 * KML and GPX import through the real import worker. A worker has no
 * DOMParser, which unit tests in jsdom cannot show.
 */

import * as fs from "node:fs";
import * as path from "node:path";

import { test, expect, type Page } from "@playwright/test";

import { openEditor } from "./helpers/atlas";

// Playwright runs from apps/atlas-app.
const fixtures = path.resolve("../../packages/data/__fixtures__");

async function dropFile(page: Page, name: string, bytes: number[]) {
  await page.evaluate(
    ({ name, bytes }) => {
      const dt = new DataTransfer();
      dt.items.add(new File([new Uint8Array(bytes)], name));
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

for (const file of ["parks.kml", "hike.gpx"]) {
  test(`a dropped ${path.extname(file)} file becomes data layers`, async ({
    page,
  }) => {
    await openEditor(page);
    const bytes = [...fs.readFileSync(path.join(fixtures, file))];
    await dropFile(page, file, bytes);

    await expect(
      page.locator('[data-testid^="layer-name-dl:"]').first(),
    ).toBeAttached({
      timeout: 15_000,
    });
    await expect(page.getByText(/import failed/i)).toHaveCount(0);
  });
}
