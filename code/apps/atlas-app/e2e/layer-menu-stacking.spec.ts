/**
 * A layer's ⋯ menu paints above the rows below it.
 *
 * An expanded row pins its header (`.rowTopSticky`, z-index 2). That header is
 * a stacking context, and so is the next one, so a menu that opened downward
 * from one row went under the next row's pinned header. A click on its lower
 * items landed on the other layer. CI found it on 2026-10-02, when the menu
 * grew a seventh item ("Show attribute table").
 *
 * Only a browser lays the rows out, so this is an e2e test: it asks the page
 * which element is on top at the centre of every item.
 */

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

const POINTS_CSV = ["name,lat,lng", "A,48.85,2.35", "B,48.86,2.36"].join("\n");

test("the ⋯ menu of a row is on top of the expanded row below it", async ({
  page,
}) => {
  await openEditor(page);
  await dropFile(page, "first.csv", POINTS_CSV);
  await expect(
    page.locator('[data-testid^="layer-disclosure-dl:"]'),
  ).toHaveCount(1, {
    timeout: 15_000,
  });
  await dropFile(page, "second.csv", POINTS_CSV);
  const rows = page.locator('[data-testid^="layer-disclosure-dl:"]');
  await expect(rows).toHaveCount(2, { timeout: 15_000 });
  const [upper, lower] = (
    await rows.evaluateAll((els) =>
      els.map((el) => el.getAttribute("data-testid")!),
    )
  ).map((t) => t.replace("layer-disclosure-", ""));

  // The lower row expanded pins its header; the upper row's menu opens over it.
  await page.getByTestId(`layer-disclosure-${lower}`).click();
  await page.getByTestId(`layer-menu-${upper}`).click();
  const menu = page.getByTestId(`layer-menu-list-${upper}`);
  await expect(menu).toBeVisible();

  const covered = await menu.evaluate((list) =>
    Array.from(list.querySelectorAll('[role="menuitem"]'))
      .filter((item) => {
        const r = item.getBoundingClientRect();
        const top = document.elementFromPoint(
          r.left + r.width / 2,
          r.top + r.height / 2,
        );
        return !top || !item.contains(top);
      })
      .map((item) => item.textContent),
  );
  expect(covered).toEqual([]);
});
