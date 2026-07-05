/**
 * Phase 5 Step 10 — Collab Integration Smoke E2E (Wave D).
 *
 * Exercises the full Fragment → Connect → Snapshot → Update flow that lights
 * up when a user clicks Share → Collaborate and another tab opens the
 * resulting URL. This is the regression net for Waves A–C: the relay,
 * ShareDialog, useCollabRoom hook, CollabState snapshot election and live
 * SCENE_UPDATE rebroadcast must all interoperate.
 *
 * Test 1 — joiner sees pre-existing scene via SCENE_SNAPSHOT (Q-P5-1):
 *   1. Tab A loads `/`, draws a rectangle by mutating the Excalidraw scene
 *      via the imperative API (window.__atlasdraw__.excalidrawAPI).
 *   2. Tab A opens Share dialog, clicks Collaborate, captures the share URL
 *      from `[data-testid="share-dialog-url"]`.
 *   3. Tab B opens the captured URL. useCollabRoom decodes the fragment and
 *      calls CollabState.connect(). The relay elects Tab A as snapshot
 *      sender, Tab A replies with SCENE_SNAPSHOT, Tab B's scene receiver
 *      applies it.
 *   4. Assert: Tab B's scene contains the same rectangle id as Tab A.
 *
 * Test 2 — bidirectional SCENE_UPDATE after snapshot:
 *   After joining, Tab A adds a second element, Tab B observes it, then Tab
 *   B adds a third and Tab A observes it. Asserts both tabs converge on 3
 *   matching element ids.
 *
 * Test 3 — snapshot retry path when first elected peer disconnects:
 *   SKIPPED — the joiner-pull election is a 5s window inside the relay; this
 *   client cannot directly observe re-election timing without internal hooks.
 *   Convergence-style multi-tab simulation is feasible but timing-dependent;
 *   see TODO in the test body.
 *
 * Prerequisites:
 *   - Full realtime stack:
 *       docker compose --profile realtime -f infra/docker-compose.yml up -d
 *     OR a locally-running `yarn workspace @atlasdraw/realtime dev`.
 *   - VITE_REALTIME_ENABLED=true in atlas-app env (sets CollabState.active).
 *   - The atlas-app dev server is launched by the Playwright webServer block
 *     in apps/atlas-app/playwright.config.ts.
 *   - window.__atlasdraw__.{map, excalidrawAPI} exposed by MapEditor.tsx
 *     (DEV-only seam, same one used by Tasks 12 and 16).
 *
 * Selectors (verified against ShareDialog.tsx at write time):
 *   - [data-testid="share-dialog-pick-collab"] — Collaborate mode button
 *   - [data-testid="share-dialog-url"]         — input carrying the URL
 *   - [data-testid="share-dialog-close"]       — close button
 *
 * URL fragment format (verified against parseRoomFragment + useCollabRoom):
 *   `#room:<roomId>,<base64url-32byte-key>`  — the `room:` prefix is mandatory
 *   (Q-P5-2). Tab A obtains this from the dialog; Tab B navigates to it
 *   verbatim.
 *
 * Playwright projects: chromium is the primary target. Firefox and WebKit
 * exercise the same Socket.IO / WebSocket APIs and should pass identically.
 */

import { test, expect, type Page } from "@playwright/test";

// ---------------------------------------------------------------------------
// Helpers
// ---------------------------------------------------------------------------

/**
 * Wait for `window.__atlasdraw__.excalidrawAPI` to exist on the page. This
 * is the DEV-only seam exposed by MapEditor.tsx once the Excalidraw imperative
 * API has bound and the MapLibre instance has mounted.
 */
async function waitForExcalidrawAPI(page: Page): Promise<void> {
  await page.waitForFunction(
    () => {
      const w = window as unknown as {
        __atlasdraw__?: { excalidrawAPI?: unknown };
      };
      return w.__atlasdraw__?.excalidrawAPI != null;
    },
    { timeout: 20_000 },
  );
}

/**
 * Programmatically inject an Excalidraw element into the scene via the
 * imperative API. We use `updateScene` rather than canvas pointer events
 * because the canvas is layered under MapLibre and Excalidraw's pointer
 * coordinates depend on viewport transforms that vary across browsers.
 *
 * Returns the injected element's id so the joining tab's scene can be
 * checked for an exact match.
 */
async function injectElement(
  page: Page,
  shape: "rectangle" | "ellipse" | "diamond",
  x: number,
  y: number,
): Promise<string> {
  return page.evaluate(
    async ({ shapeKind, posX, posY }) => {
      const api = (
        window as unknown as {
          __atlasdraw__: {
            excalidrawAPI: {
              getSceneElements: () => readonly { id: string }[];
              updateScene: (input: { elements: unknown[] }) => void;
            };
          };
        }
      ).__atlasdraw__.excalidrawAPI;

      // Use the element factory exposed by @atlasdraw/element — already
      // loaded into the Vite module graph by the app, so this resolves
      // from the import cache and does not refetch. We use a string
      // expression on the dynamic import to bypass TS module resolution
      // (the package is source-only inside the monorepo; Vite resolves it
      // via alias at runtime). Typing as `any` is safe — this only runs
      // inside the Playwright-driven browser context.
      const modPath: string = "@atlasdraw/element";
      const elementMod: any = await import(/* @vite-ignore */ modPath);

      // Per .claude/rules/excalidraw-api.md: use the typed factory functions
      // (newElement / newTextElement / newRectangleElement), NOT
      // `newElementWith` (which MUTATES an existing element). The generic
      // `newElement` factory accepts a type discriminant.
      const created = elementMod.newElement({
        type: shapeKind,
        x: posX,
        y: posY,
        width: 80,
        height: 60,
        strokeColor: "#1971c2",
        backgroundColor: "transparent",
        fillStyle: "solid",
        strokeWidth: 2,
        strokeStyle: "solid",
        roundness: null,
        roughness: 1,
        opacity: 100,
      });

      const existing = api.getSceneElements();
      api.updateScene({ elements: [...existing, created] });
      return (created as { id: string }).id;
    },
    { shapeKind: shape, posX: x, posY: y },
  );
}

/**
 * Return the ids of all non-deleted elements currently in the local scene.
 */
async function getSceneElementIds(page: Page): Promise<string[]> {
  return page.evaluate(() => {
    const api = (
      window as unknown as {
        __atlasdraw__: {
          excalidrawAPI: {
            getSceneElements: () => readonly {
              id: string;
              isDeleted?: boolean;
            }[];
          };
        };
      }
    ).__atlasdraw__.excalidrawAPI;
    return api
      .getSceneElements()
      .filter((el) => !el.isDeleted)
      .map((el) => el.id);
  });
}

/**
 * Poll until the page's scene contains `expectedId`. Used by the joining tab
 * to detect arrival of a SCENE_SNAPSHOT or SCENE_UPDATE.
 *
 * The relay's joining window is 5s; we give an extra 5s for handshake +
 * network jitter to stay well below the 60s test timeout.
 */
async function waitForElement(
  page: Page,
  expectedId: string,
  timeoutMs = 10_000,
): Promise<void> {
  await page.waitForFunction(
    (id) => {
      const api = (
        window as unknown as {
          __atlasdraw__?: {
            excalidrawAPI?: {
              getSceneElements: () => readonly {
                id: string;
                isDeleted?: boolean;
              }[];
            };
          };
        }
      ).__atlasdraw__?.excalidrawAPI;
      if (!api) {
        return false;
      }
      return api.getSceneElements().some((el) => el.id === id && !el.isDeleted);
    },
    expectedId,
    { timeout: timeoutMs },
  );
}

/**
 * Drive ShareDialog through the Collaborate path and return the room URL
 * shown in the share-dialog-url input. Leaves the dialog open; caller may
 * close it (testid `share-dialog-close`) if subsequent UI interaction is
 * needed.
 */
async function openCollabAndCaptureUrl(page: Page): Promise<string> {
  // The Share dialog is opened by the Share button in the Excalidraw footer.
  // We trigger it via the keyboard shortcut equivalent if available; in
  // practice the dialog is rendered conditionally on a state flag in App.tsx
  // and toggled by a Share button. We look for the dialog overlay testid to
  // know when it's open.
  //
  // Implementation note: rather than depend on the exact location of the
  // Share button in the Excalidraw footer (which moves between Excalidraw
  // versions), we click any element with text "Share" inside the toolbar
  // surface. The dialog itself is keyed by `share-dialog-overlay`.
  await page.getByRole("button", { name: /share/i }).first().click();

  // Wait for the dialog to render its mode picker (Collaborate + Read-only).
  const collabButton = page.locator('[data-testid="share-dialog-pick-collab"]');
  await collabButton.waitFor({ state: "visible", timeout: 5_000 });
  await collabButton.click();

  // After Collaborate is clicked, ShareDialog enters collab-loading then
  // populates the share-dialog-url input with the `#room:<id>,<key>` URL.
  const urlInput = page.locator('[data-testid="share-dialog-url"]');
  await urlInput.waitFor({ state: "visible", timeout: 10_000 });

  // Read the input value via DOM rather than `inputValue()` — both work,
  // but `inputValue()` is the documented Playwright accessor for readonly
  // inputs.
  const url = await urlInput.inputValue();
  if (!url || !url.includes("#room:")) {
    throw new Error(
      `share-dialog-url did not contain a #room: fragment, got: ${url}`,
    );
  }
  return url;
}

// ===========================================================================
// Suite
// ===========================================================================

test.describe("Phase 5 Step 10 — collab integration smoke (Wave D)", () => {
  test("joiner sees pre-existing scene via SCENE_SNAPSHOT", async ({
    browser,
  }) => {
    // Two isolated browser contexts simulate two users.
    const ctxA = await browser.newContext();
    const ctxB = await browser.newContext();
    const pageA = await ctxA.newPage();
    const pageB = await ctxB.newPage();

    try {
      // 1. Tab A loads the editor.
      await pageA.goto("/");
      await waitForExcalidrawAPI(pageA);

      // 2. Tab A draws a rectangle into its local scene (pre-collab state).
      const rectId = await injectElement(pageA, "rectangle", 100, 100);
      expect(await getSceneElementIds(pageA)).toContain(rectId);

      // 3. Tab A opens Share → Collaborate and captures the URL.
      const roomUrl = await openCollabAndCaptureUrl(pageA);

      // 4. Tab B navigates to the captured URL. useCollabRoom on Tab B's
      //    MapEditor reads window.location.hash, decodes the room key, and
      //    calls collabState.connect(). The relay elects Tab A (the only
      //    member) to send the snapshot; Tab A's CollabState replies with
      //    SCENE_SNAPSHOT; Tab B's setSceneReceiver applies it.
      await pageB.goto(roomUrl);
      await waitForExcalidrawAPI(pageB);

      // 5. Assert: Tab B's scene contains Tab A's rectangle id. The
      //    snapshot window is 5s; allow extra slack for handshake.
      await waitForElement(pageB, rectId, 12_000);
      const idsB = await getSceneElementIds(pageB);
      expect(idsB).toContain(rectId);
    } finally {
      await ctxA.close();
      await ctxB.close();
    }
  });

  test("bidirectional SCENE_UPDATE after snapshot", async ({ browser }) => {
    const ctxA = await browser.newContext();
    const ctxB = await browser.newContext();
    const pageA = await ctxA.newPage();
    const pageB = await ctxB.newPage();

    try {
      // Setup: same as Test 1 — A draws, shares, B joins.
      await pageA.goto("/");
      await waitForExcalidrawAPI(pageA);
      const rectId = await injectElement(pageA, "rectangle", 100, 100);
      const roomUrl = await openCollabAndCaptureUrl(pageA);
      await pageB.goto(roomUrl);
      await waitForExcalidrawAPI(pageB);
      await waitForElement(pageB, rectId, 12_000);

      // 1. After Tab B has joined, Tab A adds an ellipse. The local
      //    excalidrawAPI.updateScene triggers CollabState's onSceneUpdate
      //    callback, which broadcasts SCENE_UPDATE on Socket.IO. The relay
      //    rebroadcasts to Tab B; Tab B's setSceneReceiver applies it.
      const ellipseId = await injectElement(pageA, "ellipse", 220, 100);
      await waitForElement(pageB, ellipseId, 5_000);

      // 2. Tab B adds a diamond. The symmetric flow brings it back to A.
      const diamondId = await injectElement(pageB, "diamond", 340, 100);
      await waitForElement(pageA, diamondId, 5_000);

      // 3. Both tabs converge on the same set of 3 element ids.
      const idsA = await getSceneElementIds(pageA);
      const idsB = await getSceneElementIds(pageB);
      expect(idsA).toEqual(
        expect.arrayContaining([rectId, ellipseId, diamondId]),
      );
      expect(idsB).toEqual(
        expect.arrayContaining([rectId, ellipseId, diamondId]),
      );
    } finally {
      await ctxA.close();
      await ctxB.close();
    }
  });

  test.skip("snapshot retry path when first elected peer disconnects", async ({
    browser,
  }) => {
    // TODO: This test exercises the relay's joiner-pull re-election path —
    // when the elected snapshot sender disconnects mid-flight, the relay
    // should elect another peer. Implementing it reliably requires either
    //   (a) a hook into the relay's election state (not currently exposed),
    //   (b) deterministic socket.id ordering across browser contexts (not
    //       guaranteed; Socket.IO assigns ids server-side),
    //   (c) a fault-injection seam in CollabState to simulate snapshot
    //       request timeout.
    // Skipped pending one of (a)–(c). The convergence and update tests
    // above already cover the Q-P5-1 election happy path; the retry branch
    // is currently exercised only by relay unit tests.
    void browser;
  });
});
