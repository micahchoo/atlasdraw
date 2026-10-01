/**
 * A room between two browsers, through a real relay
 * (docs/architecture/adr/0014-collab-trust-model.md).
 *
 * Two browser contexts are two people: separate storage, separate
 * identities. Both use the editor built for rooms (E2E_COLLAB_URL; the
 * Playwright config starts it and a relay on free ports). A shares the map
 * with Share → Collaborate, B opens the link. A stroke, a data layer, a
 * comment and the title go from each to the other, and a third person who
 * joins last finds all of it.
 *
 * Every edit is made with real input. What a browser shows is read back
 * through the dev hook (`window.__atlasdraw__`) and the page.
 */

import { test, expect, type Browser, type Page } from "@playwright/test";

import { drawRectangle, openEditor, setTool } from "./helpers/atlas";

import type { AtlasdrawHook } from "./helpers/atlas";

const COLLAB_URL = process.env.E2E_COLLAB_URL ?? "";

type Hook = AtlasdrawHook & {
  map: AtlasdrawHook["map"] & {
    getStyle: () => { sources: Record<string, unknown> };
  };
};

async function person(browser: Browser): Promise<Page> {
  const context = await browser.newContext({
    baseURL: COLLAB_URL,
    viewport: { width: 1280, height: 800 },
  });
  return context.newPage();
}

/** Ids of the elements the editor shows; none before it mounts. */
function elementIds(page: Page): Promise<string[]> {
  return page.evaluate(
    () =>
      (
        window as unknown as { __atlasdraw__?: Hook }
      ).__atlasdraw__?.excalidrawAPI
        .getSceneElements()
        .map((e) => e.id) ?? [],
  );
}

/** Data-layer sources on the map (ids start with dl:); none before it mounts. */
function dataLayers(page: Page): Promise<string[]> {
  return page.evaluate(() => {
    const map = (window as unknown as { __atlasdraw__?: Hook }).__atlasdraw__
      ?.map;
    return map
      ? Object.keys(map.getStyle().sources).filter((id) => id.startsWith("dl:"))
      : [];
  });
}

function commentCount(page: Page) {
  return page.locator('[data-testid^="comment-anchor-button-"]').count();
}

async function dropGeoJSON(page: Page, name: string, lng: number) {
  const text = JSON.stringify({
    type: "FeatureCollection",
    features: [
      {
        type: "Feature",
        properties: { name },
        geometry: { type: "Point", coordinates: [lng, 0] },
      },
    ],
  });
  await page.evaluate(
    ({ name, text }) => {
      const dt = new DataTransfer();
      dt.items.add(new File([text], `${name}.geojson`));
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

async function addComment(page: Page, x: number, y: number, text: string) {
  await page.keyboard.press("c");
  await expect(page.getByTestId("comment-mode-button")).toHaveAttribute(
    "aria-pressed",
    "true",
  );
  await page.mouse.click(x, y);
  await page.getByTestId("comment-draft-text").fill(text);
  await page.getByTestId("comment-draft-submit").click();
  await page.keyboard.press("Escape");
  await expect(page.getByTestId("comment-mode-button")).toHaveAttribute(
    "aria-pressed",
    "false",
  );
}

async function rename(page: Page, title: string) {
  await page.getByTestId("collar-sheet-name").click();
  await page.getByTestId("collar-sheet-name-input").fill(title);
  await page.getByTestId("collar-sheet-name-input").press("Enter");
}

async function drawBox(page: Page, x: number, y: number) {
  await drawRectangle(page, { x0: x, y0: y, x1: x + 80, y1: y + 60 });
  await setTool(page, "selection");
  await page.keyboard.press("Escape");
}

test.describe("a room between two browsers", () => {
  test.skip(!COLLAB_URL, "needs the collaboration editor (playwright.config)");
  test.setTimeout(180_000);

  test("a stroke, a data layer, a comment and the title travel both ways, and a late joiner catches up", async ({
    browser,
  }) => {
    const a = await person(browser);
    const b = await person(browser);

    // A draws on the own map, then shares it as a room.
    await openEditor(a);
    await drawBox(a, 400, 300);
    const [first] = await elementIds(a);
    await a.getByTestId("main-menu-trigger").click();
    await a.getByTestId("main-menu-share").click();
    await a.getByTestId("share-dialog-pick-collab").click();
    const url = await a.getByTestId("share-dialog-url").inputValue();
    expect(url).toMatch(/#room:[0-9a-f-]{36},[A-Za-z0-9_-]{43}$/);
    await a.getByTestId("share-dialog-close").click();

    // B opens the link and finds A's drawing.
    await b.addInitScript(() =>
      localStorage.setItem("atlasdraw-onboarding-dismissed", "1"),
    );
    await b.goto(url);
    await b.waitForFunction(
      () =>
        Boolean(
          (window as unknown as { __atlasdraw__?: Hook }).__atlasdraw__
            ?.excalidrawAPI,
        ),
      undefined,
      { timeout: 30_000 },
    );
    await expect.poll(() => elementIds(b)).toEqual([first]);

    // Each sees the other.
    await expect(a.getByTestId("presence-list")).toContainText(
      "1 collaborator",
    );
    await expect(b.getByTestId("presence-list")).toContainText(
      "1 collaborator",
    );

    // B sets the name the others see; it stays in B's browser.
    await b.getByTestId("presence-self-name").fill("Bea");
    await b.getByTestId("presence-self-name").press("Enter");
    await expect(a.getByTestId("presence-list")).toContainText("Bea");
    expect(
      await b.evaluate(
        () =>
          JSON.parse(localStorage.getItem("atlasdraw:identity") ?? "{}").name,
      ),
    ).toBe("Bea");

    // Strokes.
    await drawBox(a, 600, 300);
    await expect.poll(async () => (await elementIds(b)).length).toBe(2);
    await drawBox(b, 600, 450);
    await expect.poll(async () => (await elementIds(a)).length).toBe(3);

    // Data layers.
    await dropGeoJSON(a, "wells", 10);
    await expect.poll(async () => (await dataLayers(b)).length).toBe(1);
    await dropGeoJSON(b, "springs", 20);
    await expect.poll(async () => (await dataLayers(a)).length).toBe(2);

    // Comments.
    await addComment(a, 300, 600, "check the culvert");
    await expect.poll(() => commentCount(b)).toBe(1);
    await addComment(b, 900, 600, "culvert is clear");
    await expect.poll(() => commentCount(a)).toBe(2);

    // Title.
    await rename(a, "Survey of the Spree");
    await expect(b.getByTestId("collar-sheet-name")).toHaveText(
      "Survey of the Spree",
    );
    await rename(b, "Spree survey, day 2");
    await expect(a.getByTestId("collar-sheet-name")).toHaveText(
      "Spree survey, day 2",
    );

    // A third person joins last and finds everything.
    const c = await person(browser);
    await c.addInitScript(() =>
      localStorage.setItem("atlasdraw-onboarding-dismissed", "1"),
    );
    await c.goto(url);
    await expect
      .poll(async () => (await elementIds(c)).length, {
        timeout: 30_000,
      })
      .toBe(3);
    await expect.poll(async () => (await dataLayers(c)).length).toBe(2);
    await expect.poll(() => commentCount(c)).toBe(2);
    await expect(c.getByTestId("collar-sheet-name")).toHaveText(
      "Spree survey, day 2",
    );

    await Promise.all([a, b, c].map((p) => p.context().close()));
  });
});
