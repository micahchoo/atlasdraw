/**
 * The boot shell (index.html, src/bootShell.ts) is painted before any script
 * runs. It must show the editor's frame, the collar, so the page does not
 * change shape when the editor mounts: a head bar, a tool strip, a rail on
 * the right and a foot row.
 */

import { test, expect, type Page } from "@playwright/test";

import { openEditor } from "./helpers/atlas";

type Box = { x: number; y: number; width: number; height: number };

async function boxOf(page: Page, selector: string): Promise<Box> {
  const box = await page.locator(selector).boundingBox({ timeout: 5000 });
  expect(box, selector).not.toBeNull();
  return box!;
}

test("the boot shell paints the collar the editor then draws", async ({
  page,
}) => {
  await openEditor(page);
  const collar = {
    head: await boxOf(page, '[data-testid="collar-head"]'),
    tools: await boxOf(page, '[data-testid="collar-tools"]'),
    tabs: await boxOf(page, '[data-testid="collar-tabs"]'),
    foot: await boxOf(page, '[data-testid="collar-foot"]'),
  };

  // No script runs: the page stays at the boot shell.
  const shell = await page.context().newPage();
  await shell.route(/\.(tsx?|jsx?)(\?.*)?$/, (route) => route.abort());
  await shell.goto("/");
  await expect(shell.locator("#boot-shell")).toBeVisible();
  const boot = {
    head: await boxOf(shell, "#boot-shell .head"),
    tools: await boxOf(shell, "#boot-shell .tools"),
    tabs: await boxOf(shell, "#boot-shell .tabs"),
    foot: await boxOf(shell, "#boot-shell .foot"),
  };

  for (const part of ["head", "tools", "tabs", "foot"] as const) {
    for (const edge of ["x", "y", "width", "height"] as const) {
      expect(
        Math.abs(boot[part][edge] - collar[part][edge]),
        `${part}.${edge}: boot ${boot[part][edge]}, collar ${collar[part][edge]}`,
      ).toBeLessThanOrEqual(2);
    }
  }
});

test("the viewer's boot shell has no editor collar: a head bar on /m, nothing on /embed", async ({
  page,
}) => {
  await page.route(/\.(tsx?|jsx?)(\?.*)?$/, (route) => route.abort());

  await page.goto("/m#v2:AAAA");
  await expect(page.locator("#boot-shell")).toBeVisible();
  expect((await boxOf(page, "#boot-shell .head")).height).toBe(40);
  await expect(page.locator("#boot-shell .tools")).toBeHidden();
  await expect(page.locator("#boot-shell .tabs")).toBeHidden();
  await expect(page.locator("#boot-shell .foot")).toBeHidden();

  await page.goto("/embed#v2:AAAA");
  await expect(page.locator("#boot-shell")).toBeVisible();
  await expect(page.locator("#boot-shell .head")).toBeHidden();
  await expect(page.locator("#boot-shell .tools")).toBeHidden();
});
