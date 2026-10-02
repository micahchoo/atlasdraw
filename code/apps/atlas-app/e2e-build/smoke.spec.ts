/**
 * The production smoke suite: what a visitor does first, on the build that
 * ships, under its base path (/ hosted, /atlasdraw/ on Pages).
 *
 * Only the UI drives it. A production build has no development hook, and
 * the first test proves that. Every test also proves that the page broke
 * no content security policy rule, logged no error, and asked other hosts
 * only for what its own policy names (the basemap's label glyphs). Other
 * hosts get an empty answer here, so the suite needs no network; a CDN
 * the policy does not name, such as a font fallback, fails it.
 */

import { test, expect, type Page } from "@playwright/test";

import { skipOnboarding } from "../e2e/helpers/onboarding";

const TARGET = process.env.E2E_TARGET === "pages" ? "pages" : "hosted";
const RECT = { x0: 560, y0: 330, x1: 720, y1: 450 };

/**
 * Console errors that are not the app's: the GPU driver's notes, and the
 * browser's line for a failed response, which carries no URL. Failed
 * responses are recorded with their URL instead (watch).
 */
const NOT_OURS = [/GL Driver Message/, /^Failed to load resource/];

interface Seen {
  errors: string[];
  foreign: string[];
}

/**
 * Watch one page: policy violations (read from the page at the end), console
 * errors and uncaught exceptions, and requests to any other origin, which
 * get an empty 200 (MapLibre reads an empty glyph file as no glyphs).
 */
async function watch(page: Page): Promise<Seen> {
  const seen: Seen = { errors: [], foreign: [] };
  const own = new URL(test.info().project.use.baseURL ?? "").origin;
  await page.addInitScript(() => {
    const w = window as unknown as { __violations: string[] };
    w.__violations = [];
    document.addEventListener("securitypolicyviolation", (e) => {
      w.__violations.push(`${e.effectiveDirective} ${e.blockedURI}`);
    });
  });
  page.on("console", (m) => {
    if (m.type() === "error" && !NOT_OURS.some((r) => r.test(m.text()))) {
      seen.errors.push(m.text().slice(0, 300));
    }
  });
  page.on("pageerror", (e) => seen.errors.push(`pageerror: ${e.message}`));
  page.on("response", (r) => {
    // GitHub Pages answers a deep link (/atlasdraw/m#...) with 404.html and
    // status 404; the page then boots from it. That is the one 404 allowed.
    const pagesDeepLink =
      TARGET === "pages" && r.request().resourceType() === "document";
    if (r.status() >= 400 && !pagesDeepLink) {
      seen.errors.push(`HTTP ${r.status()} ${r.url()}`);
    }
  });
  await page.route(
    (url) => url.origin !== own,
    (route) => {
      seen.foreign.push(route.request().url());
      return route.fulfill({ status: 200, body: "" });
    },
  );
  return seen;
}

async function expectClean(page: Page, seen: Seen): Promise<void> {
  const violations = await page.evaluate(
    () => (window as unknown as { __violations: string[] }).__violations,
  );
  expect(violations, "content security policy violations").toEqual([]);
  expect(seen.errors, "console errors").toEqual([]);
  const policy =
    (await page
      .locator('meta[http-equiv="Content-Security-Policy"]')
      .getAttribute("content")) ?? "";
  const named = seen.foreign.filter((u) => policy.includes(new URL(u).origin));
  expect(seen.foreign, "requests to hosts the policy does not name").toEqual(
    named,
  );
}

/** Open the editor at the base path and wait for the map and the canvas. */
async function openEditor(page: Page): Promise<void> {
  await skipOnboarding(page);
  await page.goto("./");
  await expect(page.locator("canvas.maplibregl-canvas")).toBeVisible();
  await expect(page.locator(".excalidraw canvas").first()).toBeVisible();
  await expect(page.getByTestId("main-menu-trigger")).toBeVisible();
  await expect(page.locator("#boot-shell")).toHaveCount(0);
}

/** Pick a tool on the toolbar: its radio sits under the icon, so click the label. */
async function tool(page: Page, name: string): Promise<void> {
  await page.getByTestId(`toolbar-${name}`).locator("..").click();
}

/** Pick the rectangle on the toolbar and drag one out, then go back to select. */
async function drawRectangle(page: Page): Promise<void> {
  await tool(page, "rectangle");
  await page.mouse.move(RECT.x0, RECT.y0);
  await page.mouse.down();
  await page.mouse.move(RECT.x1, RECT.y1, { steps: 8 });
  await page.mouse.up();
  await page.keyboard.press("Escape");
}

/** The painted box on Excalidraw's static canvas, in CSS pixels; null if blank. */
function paintedBox(page: Page) {
  return page.evaluate(() => {
    const canvas = document.querySelector<HTMLCanvasElement>(
      "canvas.excalidraw__canvas.static",
    );
    const ctx = canvas?.getContext("2d");
    if (!canvas || !ctx) {
      return null;
    }
    const { width, height, data } = ctx.getImageData(
      0,
      0,
      canvas.width,
      canvas.height,
    );
    let x0 = Infinity;
    let x1 = -Infinity;
    let y0 = Infinity;
    let y1 = -Infinity;
    for (let y = 0; y < height; y++) {
      for (let x = 0; x < width; x++) {
        if (data[(y * width + x) * 4 + 3] !== 0) {
          x0 = Math.min(x0, x);
          x1 = Math.max(x1, x);
          y0 = Math.min(y0, y);
          y1 = Math.max(y1, y);
        }
      }
    }
    if (x1 < 0) {
      return null;
    }
    const scale = canvas.width / canvas.getBoundingClientRect().width;
    return { width: (x1 - x0) / scale, height: (y1 - y0) / scale };
  });
}

async function expectRectangle(page: Page): Promise<void> {
  await expect
    .poll(() => paintedBox(page), { message: "the rectangle is drawn" })
    .not.toBeNull();
  const box = (await paintedBox(page))!;
  expect(box.width).toBeGreaterThan(RECT.x1 - RECT.x0 - 8);
  expect(box.width).toBeLessThan(RECT.x1 - RECT.x0 + 8);
}

/** Draw, then make a read-only share link through the Share dialog. */
async function shareLink(page: Page): Promise<string> {
  await openEditor(page);
  await drawRectangle(page);
  await page.getByTestId("main-menu-trigger").click();
  await page.getByTestId("main-menu-share").click();
  await page.getByTestId("share-dialog-pick-readonly").click();
  return page.getByTestId("share-dialog-url").inputValue();
}

test("the editor boots under its base path, with no development hook", async ({
  page,
}) => {
  const seen = await watch(page);
  await openEditor(page);
  expect(
    await page.evaluate(() => "__atlasdraw__" in window),
    "a production build exposes no development hook",
  ).toBe(false);
  // MapLibre's worker loads from the build (lib/maplibreWorker.ts); a wrong
  // worker URL logs "Worker failed to load" and the map paints no tiles.
  await page.waitForTimeout(1500);
  await expectClean(page, seen);
});

test("a drawing is saved and is there after a reload", async ({ page }) => {
  const seen = await watch(page);
  await openEditor(page);
  await drawRectangle(page);
  const dot = page.getByTestId("status-bar-save-dot");
  await expect(dot).toHaveAttribute("aria-label", "Saved", { timeout: 20_000 });

  await page.reload();
  await expect(page.locator(".excalidraw canvas").first()).toBeVisible();
  await expectRectangle(page);
  await expectClean(page, seen);
});

test("a share link opens the drawing in the viewer, under the base path", async ({
  page,
}) => {
  const seen = await watch(page);
  const url = await shareLink(page);
  const base = test.info().project.use.baseURL ?? "";
  expect(url.startsWith(`${base}m#v2:`), url).toBe(true);

  const viewer = await page.context().newPage();
  const viewerSeen = await watch(viewer);
  await viewer.goto(url);
  await expect(viewer.getByTestId("viewer-head")).toBeVisible();
  await expect(viewer.locator("canvas.maplibregl-canvas")).toBeVisible();
  await expectRectangle(viewer);
  await expectClean(page, seen);
  await expectClean(viewer, viewerSeen);
});

test("an embed link shows the drawing without the editor, under the base path", async ({
  page,
}) => {
  const seen = await watch(page);
  const url = await shareLink(page);
  const embedUrl = url.replace("/m#", "/embed#");
  // Embeds are on by default (VITE_EMBED_ENABLED): the dialog offers the
  // snippet for this same URL.
  await expect(page.getByTestId("embed-snippet")).toHaveValue(
    new RegExp(`src="${embedUrl.replace(/[.*+?^${}()|[\]\\]/g, "\\$&")}"`),
  );

  const embed = await page.context().newPage();
  const embedSeen = await watch(embed);
  await embed.goto(embedUrl);
  await expect(embed.locator("canvas.maplibregl-canvas")).toBeVisible();
  await expectRectangle(embed);
  await expect(embed.getByRole("radio", { name: "Rectangle" })).toHaveCount(0);
  await expect(embed.getByTestId("viewer-head")).toHaveCount(0);
  await expectClean(page, seen);
  await expectClean(embed, embedSeen);
});

test("text takes the drawing font from the page's own origin", async ({
  page,
}) => {
  const seen = await watch(page);
  const fonts: string[] = [];
  page.on("request", (r) => {
    if (r.resourceType() === "font") {
      fonts.push(r.url());
    }
  });
  await openEditor(page);
  await tool(page, "text");
  await page.mouse.click(600, 400);
  await page.keyboard.type("Atlas");
  await page.keyboard.press("Escape");

  await expect
    .poll(() => page.evaluate(() => document.fonts.check("20px Excalifont")))
    .toBe(true);
  const own = new URL(test.info().project.use.baseURL ?? "").origin;
  expect(fonts.length, "a font was fetched").toBeGreaterThan(0);
  expect(fonts.filter((f) => !f.startsWith(own))).toEqual([]);
  await expectClean(page, seen);
});
