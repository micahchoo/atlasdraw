/**
 * What the keyboard actually does to comment mode, in a real browser.
 *
 * FU-5 was filed as "`h` can't exit comment mode": the mode borrows `hand`, the
 * exit watcher ignores `hand`, so `h` was reasoned to be swallowed. That
 * reasoning composed two true facts into a false conclusion, and the unit
 * suite agreed with it because its fake API sets the tool directly — the real
 * `h` is `actionToggleHandTool`, a TOGGLE that leaves `hand` rather than
 * selecting it.
 *
 * Only a browser runs the real action, so the claim gets a browser probe. The
 * three keys below are the whole keyboard surface of the mode: one that must
 * exit and restore, one that must exit and keep the tool it picked, and `h`.
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
 * own container, so `r` and `h` need the container focused — while comment
 * mode's own `c` and Escape ride atlas-app's window listener and work from
 * anywhere. Focus is set on the element rather than clicked onto it for the
 * reasons in `enterCommentMode`: every clickable point in reach either opens
 * the menu or drops an anchor.
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

test.describe("comment mode — keyboard exits", () => {
  test("Escape leaves the mode and puts the borrowed tool back", async ({
    page,
  }) => {
    await waitForApp(page);
    const before = await activeTool(page);

    await enterCommentMode(page);
    expect(await activeTool(page)).toBe("hand");

    await page.keyboard.press("Escape");
    await expect(page.getByTestId("comment-mode-button")).toHaveAttribute(
      "aria-pressed",
      "false",
    );
    expect(await activeTool(page)).toBe(before);
  });

  test("`r` leaves the mode and keeps the rectangle you asked for", async ({
    page,
  }) => {
    await waitForApp(page);
    await focusEditor(page);
    await enterCommentMode(page);

    await page.keyboard.press("r");
    await expect(page.getByTestId("comment-mode-button")).toHaveAttribute(
      "aria-pressed",
      "false",
    );
    expect(await activeTool(page)).toBe("rectangle");
  });

  test("`h` leaves the mode — it toggles the hand tool off, it does not re-pick it", async ({
    page,
  }) => {
    await waitForApp(page);
    await focusEditor(page);
    await enterCommentMode(page);
    expect(await activeTool(page)).toBe("hand");

    await page.keyboard.press("h");

    // The claim under test. If `h` were swallowed this stays "true" and the
    // tool stays "hand" — the exact state FU-5 described.
    await expect(page.getByTestId("comment-mode-button")).toHaveAttribute(
      "aria-pressed",
      "false",
    );
    expect(await activeTool(page)).not.toBe("hand");
  });
});
