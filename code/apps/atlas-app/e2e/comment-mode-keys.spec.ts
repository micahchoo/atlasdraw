/**
 * What the keyboard actually does to comment mode, in a real browser.
 *
 * Comment mode used to borrow the `hand` tool and exit when the user picked a
 * tool — that exit was the subject of FU-5 ("`h` can't exit comment mode").
 * Both are gone: the overlay intercepts clicks itself, so the Excalidraw tool
 * is never touched. Entering the mode changes nothing about the editor, and no
 * tool pick can end it — Escape and the rail toggle are the only exits.
 *
 * Only a browser runs the real actions, so the claims get browser probes: the
 * mode must leave the tool alone, Escape must exit, and a tool shortcut must
 * change the tool without ending the mode.
 *
 * Read through `aria-pressed` on the rail toggle rather than any internal — it
 * is what a user (and a screen reader) is told, so it is what has to be true.
 */

import { test, expect } from "@playwright/test";

interface AtlasdrawWindow {
  __atlasdraw__?: {
    excalidrawAPI: {
      getAppState: () => { activeTool?: { type?: string } };
    };
  };
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

function activeTool(page: import("@playwright/test").Page) {
  return page.evaluate(() => {
    const w = window as unknown as AtlasdrawWindow;
    return w.__atlasdraw__?.excalidrawAPI.getAppState()?.activeTool?.type;
  });
}

/**
 * Enter through the `c` shortcut, not the rail button.
 *
 * Do not be tempted to click into the editor first to "give it focus". The
 * top-left of `.excalidraw-container` is the main menu trigger: clicking there
 * opens the dropdown, and an open dropdown swallows Escape in the capture
 * phase to close itself. That reads as "Escape cannot exit comment mode" and
 * is entirely the probe's own doing. Clicking the map plate instead is no
 * better — in comment mode a plate click drops an anchor, so the first Escape
 * belongs to the draft composer.
 *
 * `c` leaves focus wherever it was and opens nothing, which is the only state
 * in which the next keystroke is measuring the mode and nothing else.
 */
async function enterCommentMode(page: import("@playwright/test").Page) {
  await page.keyboard.press("c");
  await expect(page.getByTestId("comment-mode-button")).toHaveAttribute(
    "aria-pressed",
    "true",
  );
}

/**
 * Excalidraw's tool shortcuts only fire for events whose target is inside its
 * own container, so `r` needs the container focused — while comment mode's own
 * `c` and Escape ride atlas-app's window listener and work from anywhere.
 * Focus is set on the element rather than clicked onto it for the reasons in
 * `enterCommentMode`: every clickable point in reach either opens the menu or
 * drops an anchor.
 */
async function focusEditor(page: import("@playwright/test").Page) {
  await page.evaluate(() => {
    const el = document.querySelector<HTMLElement>(".excalidraw-container");
    el?.focus();
  });
  await expect
    .poll(() =>
      page.evaluate(() =>
        document.activeElement?.classList.contains("excalidraw-container"),
      ),
    )
    .toBe(true);
}

test.describe("comment mode — the tool is not borrowed", () => {
  test("Escape leaves the mode and the editor tool is untouched by it", async ({
    page,
  }) => {
    await waitForApp(page);
    const before = await activeTool(page);

    await enterCommentMode(page);
    // Entering the mode borrows nothing — the tool is whatever it was.
    expect(await activeTool(page)).toBe(before);

    await page.keyboard.press("Escape");
    await expect(page.getByTestId("comment-mode-button")).toHaveAttribute(
      "aria-pressed",
      "false",
    );
    expect(await activeTool(page)).toBe(before);
  });

  test("`r` changes the tool without ending the mode; Escape then exits", async ({
    page,
  }) => {
    await waitForApp(page);
    await focusEditor(page);
    await enterCommentMode(page);

    await page.keyboard.press("r");
    // A tool pick is no longer an exit — the mode survives the rectangle.
    await expect(page.getByTestId("comment-mode-button")).toHaveAttribute(
      "aria-pressed",
      "true",
    );
    expect(await activeTool(page)).toBe("rectangle");

    // Escape still exits, and the tool the user picked stays put.
    await page.keyboard.press("Escape");
    await expect(page.getByTestId("comment-mode-button")).toHaveAttribute(
      "aria-pressed",
      "false",
    );
    expect(await activeTool(page)).toBe("rectangle");
  });
});
