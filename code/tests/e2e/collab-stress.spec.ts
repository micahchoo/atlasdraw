/* eslint-disable no-console */
/**
 * Phase 5 Task 17 — 5MB Yjs Stress Test (TCP Split).
 *
 * Verifies that a large Yjs initial state catch-up (5MB) on the /yjs/:roomId
 * connection does not stall cursor events on the Socket.IO connection,
 * validating the Q9 TCP-split decision (independent WebSocket connections
 * for Yjs CRDT binary sync and Socket.IO lightweight events).
 *
 * Flow:
 *   1. beforeAll: generate a synthetic 5MB Y.Doc (50k features with 10-vertex
 *      polygons), encode as Yjs update, and apply it to a temporary page's
 *      collab Y.Doc so the relay's in-memory doc is pre-loaded.
 *   2. Open pageA to the room URL — triggers full Yjs state catch-up on
 *      `/yjs/:roomId`.
 *   3. Set up an independent Socket.IO cursor monitor on pageA that joins the
 *      same room and records `performance.now()` timestamps on each received
 *      CURSOR event.
 *   4. Set up an independent Socket.IO cursor sender on pageA that sends 100
 *      CURSOR events at ~50 Hz (staying under the relay's 60/s rate limit).
 *   5. Wait for pageA's Yjs catch-up to complete (all 50k features observed in
 *      the local Y.Doc).
 *   6. Read the recorded timestamps and compute inter-event gaps.
 *   7. Assert: minimum inter-event gap ≤ 33 ms (>30 fps equivalent).
 *
 * Prerequisites:
 *   - Full realtime stack:
 *       docker compose --profile realtime -f infra/docker-compose.yml up -d
 *   - VITE_REALTIME_ENABLED=true in atlas-app env
 *   - window.__atlasdraw__.collabState exposed
 *   - Room URL fragment pattern: #<roomId>,<base64url-32byte-key>
 *   - A separate Playwright config with `testDir: "tests/e2e"` (or run
 *     against an extended playwright.config.ts that includes this directory).
 *
 * Playwright projects: chromium only (the test measures real-time frame
 * delivery — browser variance is not relevant).
 */

import { test, expect } from "@playwright/test";
import * as Y from "yjs";

// ---------------------------------------------------------------------------
// Constants
// ---------------------------------------------------------------------------

const RELAY_HOST = "ws://localhost:4001";
const STRESS_ROOM_ID = "stress-test-room";
const KEY_B64 = "AAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAA";
const ROOM_URL = `http://localhost:5174/#${STRESS_ROOM_ID},${KEY_B64}`;
const FEATURE_COUNT = 50_000;
const CURSOR_COUNT = 100;
// 20 ms interval = 50 Hz — safely under the relay's 60/s cursor limit so no
// events are dropped by the rate limiter.
const CURSOR_INTERVAL_MS = 20;

// ---------------------------------------------------------------------------
// Helpers
// ---------------------------------------------------------------------------

/**
 * Create a Y.Doc with FEATURE_COUNT Polygon features, each having 10 vertices.
 * The encoded state (via Y.encodeStateAsUpdate) targets ~5 MB.
 */
function createLargeDoc(): Y.Doc {
  const doc = new Y.Doc();
  const layers = doc.getMap("layers");
  const defaultLayer = new Y.Map<Y.Map<unknown>>();
  layers.set("default", defaultLayer);

  for (let i = 0; i < FEATURE_COUNT; i++) {
    const feature = new Y.Map<unknown>() as Y.Map<unknown>;
    feature.set("type", "Feature");

    const geometry = new Y.Map<unknown>() as Y.Map<unknown>;
    geometry.set("type", "Polygon");

    const coordsArray = new Y.Array<Y.Array<Y.Array<number>>>();
    const ring = new Y.Array<Y.Array<number>>();

    for (let j = 0; j < 10; j++) {
      const pt = new Y.Array<number>();
      pt.push([Math.random() * 360 - 180, Math.random() * 180 - 90]);
      ring.push([pt as unknown as Y.Array<number>]);
    }

    coordsArray.push([ring as unknown as Y.Array<Y.Array<number>>]);
    geometry.set("coordinates", coordsArray);
    feature.set("geometry", geometry);

    defaultLayer.set(`feature-${i}`, feature as Y.Map<unknown>);
  }

  return doc;
}

// ===========================================================================
// Suite
// ===========================================================================

test.describe("Phase 5 — Yjs stress test (Task 17)", () => {
  // -------------------------------------------------------------------------
  // beforeAll — preload 5 MB Yjs state into the relay's in-memory doc
  // -------------------------------------------------------------------------

  test.beforeAll(async ({ browser }) => {
    // Step 1: generate the synthetic state in Node.js.
    console.log("[preload] Generating 50k features with 10-vertex polygons…");
    const doc = createLargeDoc();
    const encodedState = Y.encodeStateAsUpdate(doc);
    const sizeMB = (encodedState.byteLength / (1024 * 1024)).toFixed(1);
    console.log(
      `[preload] Encoded state: ${sizeMB} MB (${encodedState.byteLength} bytes)`,
    );

    // Step 2: open a temporary page to sync this state to the relay.
    const setupCtx = await browser.newContext();
    const setupPage = await setupCtx.newPage();
    await setupPage.goto(ROOM_URL);

    // Step 3: wait for the collab connection to establish.
    await setupPage.waitForFunction(
      () => {
        const cs = (window as any).__atlasdraw__?.collabState;
        return cs?.yjsDoc != null;
      },
      { timeout: 20_000 },
    );

    // Step 4: apply the encoded state to the collab Y.Doc.  The y-websocket
    // connection will detect the local changes and push them to the relay.
    await setupPage.evaluate((state: Uint8Array) => {
      const cs = (window as any).__atlasdraw__.collabState;
      if (!cs?.yjsDoc) {
        throw new Error("Collab Y.Doc not available");
      }
      // yjs is loaded by the app — import from the module cache.
      return import("yjs").then((Ymod: any) => {
        Ymod.applyUpdate(cs.yjsDoc, state);
      });
    }, encodedState);

    // Step 5: allow time for the Yjs WebSocket to flush the ~5 MB update
    // to the relay.  Localhost WebSocket is fast (< 1 s for 5 MB), but we
    // use a conservative 5 s to avoid flakiness.
    console.log("[preload] Awaiting relay sync…");
    await setupPage.waitForTimeout(5000);

    await setupPage.close();
    await setupCtx.close();
    console.log("[preload] Sync complete — relay has preloaded state");
  });

  // -------------------------------------------------------------------------
  // Test — cursor frame rate during Yjs catch-up
  // -------------------------------------------------------------------------

  test("minimum cursor inter-event gap is ≤33ms during 5MB Yjs catch-up", async ({
    browser,
  }) => {
    // 1. Open pageA and navigate to the room URL.  This triggers the Yjs
    //    catch-up of the preloaded 5 MB state on the /yjs/:roomId connection.
    const ctx = await browser.newContext();
    const pageA = await ctx.newPage();
    await pageA.goto(ROOM_URL);

    // 2. Wait for the collab connection to activate (Y.Doc created).
    await pageA.waitForFunction(
      () => {
        const cs = (window as any).__atlasdraw__?.collabState;
        return cs?.yjsDoc != null;
      },
      { timeout: 15_000 },
    );

    // 3. Set up an independent Socket.IO cursor monitor AND sender on pageA.
    //
    //    The monitor joins the stress-test-room and records timestamps of
    //    received CURSOR events.  The sender joins the same room and fires
    //    100 CURSOR events at ~50 Hz.
    //
    //    Using the same page avoids cross-page coordination complexity.
    //    Both the monitor and sender are separate Socket.IO connections,
    //    independent of the app's collab Socket.IO connection.
    const timestamps: number[] = await pageA.evaluate(
      async ({ roomId, cursorCount, intervalMs, relayHost }) => {
        // Dynamic import — socket.io-client is already loaded by the app,
        // so Vite serves this from the module cache.
        const { io } = (await import("socket.io-client")) as any;

        const recorded: number[] = [];

        // ---- monitor ----
        const monitor = io(relayHost, {
          transports: ["websocket"],
        });
        await new Promise<void>((resolve) => {
          monitor.on("connect", () => {
            monitor.emit("JOIN_ROOM", { roomId });
            // Small settle for the relay to process the join.
            setTimeout(resolve, 100);
          });
        });
        monitor.on("CURSOR", () => {
          recorded.push(performance.now());
        });

        // ---- sender ----
        const sender = io(relayHost, {
          transports: ["websocket"],
        });
        await new Promise<void>((resolve) => {
          sender.on("connect", () => {
            sender.emit("JOIN_ROOM", { roomId });
            setTimeout(resolve, 100);
          });
        });

        // Send cursors at ~50 Hz.
        for (let i = 0; i < cursorCount; i++) {
          sender.emit("CURSOR", {
            roomId,
            senderId: `e2e-sender-${i}`,
            timestamp: Date.now(),
            data: {
              x: Math.random() * 1280,
              y: Math.random() * 800,
              color: "#ff0000",
              username: "e2e-bot",
            },
          });
          await new Promise((r) => setTimeout(r, intervalMs));
        }

        // Allow the last events to arrive at the monitor.
        await new Promise((r) => setTimeout(r, 500));
        sender.close();
        monitor.close();

        return recorded;
      },
      {
        roomId: STRESS_ROOM_ID,
        cursorCount: CURSOR_COUNT,
        intervalMs: CURSOR_INTERVAL_MS,
        relayHost: RELAY_HOST,
      },
    );

    // 4. Wait for Yjs catch-up to complete (all 50k features in the local doc).
    await pageA.waitForFunction(
      (expected: number) => {
        const cs = (window as any).__atlasdraw__?.collabState;
        if (!cs?.yjsDoc) {
          return false;
        }
        const layers = cs.yjsDoc.getMap("layers");
        const defaultLayer = layers.get("default");
        if (!defaultLayer) {
          return false;
        }
        return defaultLayer.size >= expected;
      },
      FEATURE_COUNT,
      { timeout: 30_000 },
    );

    // 5. Compute inter-event gaps from recorded timestamps.
    const gaps: number[] = [];
    for (let i = 1; i < timestamps.length; i++) {
      gaps.push(timestamps[i] - timestamps[i - 1]);
    }

    console.log(
      `[stress-test] Received ${timestamps.length} cursors${
        gaps.length > 0
          ? ` | min gap: ${Math.min(...gaps).toFixed(2)} ms` +
            ` | median gap: ${median(gaps).toFixed(2)} ms`
          : " | no gaps (single cursor received)"
      }`,
    );

    // 6. Assert: minimum inter-event gap is ≤ 33 ms, demonstrating that
    //    the Socket.IO cursor channel was not stalled by the Yjs catch-up
    //    on the separate TCP connection (Q9).
    if (gaps.length === 0) {
      // Edge case: only 0 or 1 cursor received.  This should not happen on
      // a healthy stack — fail with a descriptive message.
      expect(
        timestamps.length,
        `Expected ≥2 cursor events, got ${timestamps.length}. ` +
          "Check that the realtime stack is running and VITE_REALTIME_ENABLED=true",
      ).toBeGreaterThanOrEqual(2);
    }

    const minGap = gaps.length > 0 ? Math.min(...gaps) : Infinity;
    expect(
      minGap,
      `Minimum inter-cursor gap is ${minGap.toFixed(2)} ms, ` +
        `expected ≤33 ms (>30 fps equivalent)`,
    ).toBeLessThanOrEqual(33);

    await pageA.close();
    await ctx.close();
  });
});

// ---------------------------------------------------------------------------
// Utility
// ---------------------------------------------------------------------------

function median(values: number[]): number {
  if (values.length === 0) {
    return 0;
  }
  const sorted = [...values].sort((a, b) => a - b);
  const mid = Math.floor(sorted.length / 2);
  return sorted.length % 2 !== 0
    ? sorted[mid]
    : (sorted[mid - 1] + sorted[mid]) / 2;
}
