/**
 * Phase 5 Task 16 — CRDT Convergence E2E Test.
 *
 * Verifies that concurrent Yjs `appendVertex` calls from two isolated browser
 * contexts converge without data loss or duplication.
 *
 * Flow:
 *   1. Two isolated BrowserContexts (ctxA, ctxB) navigate to the same room URL.
 *   2. Wait for Yjs doc to exist on both (collab connection established).
 *   3. ctxA creates a test polygon with 4 initial vertices.
 *   4. ctxB observes the polygon appear via Yjs sync.
 *   5. Concurrently (no await between the `evaluate` calls):
 *        ctxA appends a vertex to ring 0.
 *        ctxB appends a different vertex to ring 0.
 *   6. Both contexts wait for their own Yjs observe callback to confirm the
 *      merged state (6 vertices = 4 initial + 1 from A + 1 from B).
 *   7. Assert: both contexts see exactly 6 vertices in ring 0.
 *   8. Assert: no duplicate vertex pairs.
 *
 * Prerequisites:
 *   - Full realtime stack:
 *       docker compose --profile realtime -f infra/docker-compose.yml up -d
 *   - VITE_REALTIME_ENABLED=true in atlas-app env
 *   - window.__atlasdraw__.collabState exposed (CollabState singleton, added
 *     in MapEditor.tsx's DEV-only window expose block, same pattern as map
 *     and excalidrawAPI)
 *   - Room URL fragment pattern: #<roomId>,<base64url-32byte-key>
 *
 * Playwright projects: chromium is the primary target; firefox and webkit
 * should pass identically (y-websocket and Socket.IO are browser-agnostic at
 * the WebSocket API level).
 */

import { test, expect, type Page } from "@playwright/test";

// ---------------------------------------------------------------------------
// Constants
// ---------------------------------------------------------------------------

/** 32 zero bytes base64url-encoded. Replace with a real key in CI. */
const KEY_B64 = "AAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAA";

const FEATURE_ID = "convergence-polygon";

// ---------------------------------------------------------------------------
// Helpers
// ---------------------------------------------------------------------------

function roomUrl(roomId: string): string {
  return `http://localhost:5174/#${roomId},${KEY_B64}`;
}

/**
 * Wait until the page's collab state has a live Y.Doc (meaning `connect()`
 * has been called and both WebSocket connections are initialising).
 *
 * This does NOT wait for the Yjs sync to finish — just for the connection
 * lifecycle to begin. Callers that need the initial state synced should
 * add a follow-up waitForFunction on the feature count.
 */
async function waitForCollabActive(page: Page): Promise<void> {
  await page.waitForFunction(
    () => {
      const cs = (window as any).__atlasdraw__?.collabState;
      return cs?.yjsDoc != null;
    },
    { timeout: 15_000 },
  );
  // Allow the Socket.IO and y-websocket handshakes to settle.
  await page.waitForTimeout(500);
}

/**
 * Create a test polygon with `vertexCount` initial vertices on the "default"
 * layer of the page's shared Y.Doc.  Uses dynamic import() because `page.evaluate`
 * runs in the browser's ESM context (Vite dev server).
 */
async function createTestPolygon(
  page: Page,
  vertexCount: number,
  featureId: string,
): Promise<void> {
  await page.evaluate(
    async ({ fid, vtxCount }) => {
      const cs = (window as any).__atlasdraw__.collabState;
      if (!cs?.yjsDoc) throw new Error("Collab not active");

      // Build initial ring vertices.
      const ring: Array<[number, number]> = [];
      for (let i = 0; i < vtxCount; i++) {
        const angle = (i / vtxCount) * Math.PI * 2;
        ring.push([Math.cos(angle), Math.sin(angle)]);
      }

      // Dynamic import works in Vite dev server — @atlasdraw/data is already
      // loaded by the app as an ESM chunk so this resolves from cache.
      const data = await import("@atlasdraw/data");
      const layer = new data.YjsLayer(cs.yjsDoc).getOrCreateLayer("default");
      data.addFeature(layer, fid, "Polygon", [ring], {
        label: "convergence-test",
      });
    },
    { fid: featureId, vtxCount: vertexCount },
  );
}

/**
 * Return the number of vertices in ring 0 of the given feature.
 * Returns -1 when the feature does not exist.
 */
async function getRingVertexCount(
  page: Page,
  featureId: string,
): Promise<number> {
  return page.evaluate((fid) => {
    const cs = (window as any).__atlasdraw__?.collabState;
    if (!cs?.yjsDoc) return -1;

    const layers = cs.yjsDoc.getMap("layers");
    const defaultLayer = layers.get("default");
    if (!defaultLayer) return -1;

    const feature = defaultLayer.get(fid);
    if (!feature) return -1;

    const geometry = feature.get("geometry");
    if (!geometry) return -1;

    const coords = geometry.get("coordinates");
    const ring = coords?.get(0);
    if (!ring) return -1;

    return ring.length;
  }, featureId);
}

/**
 * Return the vertex pairs of ring 0 for deduplication checking.
 */
async function getRingVertices(
  page: Page,
  featureId: string,
): Promise<Array<[number, number]>> {
  return page.evaluate((fid) => {
    const cs = (window as any).__atlasdraw__?.collabState;
    if (!cs?.yjsDoc) return [];

    const layers = cs.yjsDoc.getMap("layers");
    const defaultLayer = layers.get("default");
    if (!defaultLayer) return [];

    const feature = defaultLayer.get(fid);
    if (!feature) return [];

    const geometry = feature.get("geometry");
    if (!geometry) return [];

    const coords = geometry.get("coordinates");
    const ring = coords?.get(0);
    if (!ring) return [];

    const vertices: Array<[number, number]> = [];
    for (let i = 0; i < ring.length; i++) {
      const pt = ring.get(i);
      // pt is a Y.Array<number> — get(0) = lng, get(1) = lat
      vertices.push([pt.get(0), pt.get(1)]);
    }
    return vertices;
  }, featureId);
}

// ===========================================================================
// Tests
// ===========================================================================

test.describe("Phase 5 — CRDT convergence (Task 16)", () => {
  test("concurrent appendVertex merges without data loss or duplication", async ({
    browser,
  }) => {
    // Derive a unique room id so parallel runs don't collide.
    const roomId = `e2e-convergence-${Date.now()}`;

    // 1. Two browser contexts — fully isolated storage/cookies.
    const ctxA = await browser.newContext();
    const ctxB = await browser.newContext();
    const pageA = await ctxA.newPage();
    const pageB = await ctxB.newPage();

    // 2. Both navigate to the same room URL.
    await pageA.goto(roomUrl(roomId));
    await pageB.goto(roomUrl(roomId));

    // 3. Wait for collab connection on both sides.
    await waitForCollabActive(pageA);
    await waitForCollabActive(pageB);

    // 4. Create the test polygon on page A (4 initial vertices).
    const INITIAL_VERTICES = 4;
    await createTestPolygon(pageA, INITIAL_VERTICES, FEATURE_ID);
    expect(await getRingVertexCount(pageA, FEATURE_ID)).toBe(INITIAL_VERTICES);

    // 5. Wait for the polygon to propagate to page B via Yjs sync.
    await pageB.waitForFunction(
      ({ fid }) => {
        const cs = (window as any).__atlasdraw__?.collabState;
        if (!cs?.yjsDoc) return false;
        const layers = cs.yjsDoc.getMap("layers");
        const defaultLayer = layers.get("default");
        if (!defaultLayer) return false;
        return defaultLayer.get(fid) != null;
      },
      { fid: FEATURE_ID },
      { timeout: 10_000 },
    );

    // Small settle for Yjs to establish bidirectional sync.
    await pageA.waitForTimeout(300);
    await pageB.waitForTimeout(300);

    // 6. Fire concurrent appendVertex — no await between the two calls.
    //
    //    Each context appends a distinct vertex to ring 0 of the same
    //    polygon.  Because Yjs uses CRDT merge (not LWW), both concurrent
    //    inserts survive — no data loss.
    const APPEND_A: [number, number] = [2.5, 0];
    const APPEND_B: [number, number] = [-0.5, 0.5];

    const appendTaskA = pageA.evaluate(
      async ({ fid, vertex }) => {
        const cs = (window as any).__atlasdraw__?.collabState;
        if (!cs?.yjsDoc) throw new Error("Collab not active on context A");
        const data = await import("@atlasdraw/data");
        const layer = new data.YjsLayer(cs.yjsDoc).getOrCreateLayer("default");
        data.appendVertex(layer, fid, 0, vertex);
      },
      { fid: FEATURE_ID, vertex: APPEND_A },
    );

    const appendTaskB = pageB.evaluate(
      async ({ fid, vertex }) => {
        const cs = (window as any).__atlasdraw__?.collabState;
        if (!cs?.yjsDoc) throw new Error("Collab not active on context B");
        const data = await import("@atlasdraw/data");
        const layer = new data.YjsLayer(cs.yjsDoc).getOrCreateLayer("default");
        data.appendVertex(layer, fid, 0, vertex);
      },
      { fid: FEATURE_ID, vertex: APPEND_B },
    );

    // Both operations are now in-flight concurrently (no await between the
    // evaluate calls above).  Wait for both to complete.
    await Promise.all([appendTaskA, appendTaskB]);

    // 7. Wait for convergence: each page observes the merged CRDT state.
    const EXPECTED_TOTAL = INITIAL_VERTICES + 2; // 4 + 1 + 1 = 6
    await pageA.waitForFunction(
      ({ fid, expected }) => {
        const cs = (window as any).__atlasdraw__?.collabState;
        if (!cs?.yjsDoc) return false;
        const layers = cs.yjsDoc.getMap("layers");
        const defaultLayer = layers.get("default");
        if (!defaultLayer) return false;
        const feature = defaultLayer.get(fid);
        if (!feature) return false;
        const geometry = feature.get("geometry");
        const coords = geometry?.get("coordinates");
        const ring = coords?.get(0);
        return ring && ring.length >= expected;
      },
      { fid: FEATURE_ID, expected: EXPECTED_TOTAL },
      { timeout: 10_000 },
    );

    await pageB.waitForFunction(
      ({ fid, expected }) => {
        const cs = (window as any).__atlasdraw__?.collabState;
        if (!cs?.yjsDoc) return false;
        const layers = cs.yjsDoc.getMap("layers");
        const defaultLayer = layers.get("default");
        if (!defaultLayer) return false;
        const feature = defaultLayer.get(fid);
        if (!feature) return false;
        const geometry = feature.get("geometry");
        const coords = geometry?.get("coordinates");
        const ring = coords?.get(0);
        return ring && ring.length >= expected;
      },
      { fid: FEATURE_ID, expected: EXPECTED_TOTAL },
      { timeout: 10_000 },
    );

    // 8. Assert: both contexts see exactly 6 vertices (no loss).
    const countA = await getRingVertexCount(pageA, FEATURE_ID);
    const countB = await getRingVertexCount(pageB, FEATURE_ID);
    expect(countA).toBe(EXPECTED_TOTAL);
    expect(countB).toBe(EXPECTED_TOTAL);

    // 9. Assert: no vertex appears twice (no duplication).
    const verticesA = await getRingVertices(pageA, FEATURE_ID);
    const verticesB = await getRingVertices(pageB, FEATURE_ID);

    const serializePair = (v: [number, number]): string =>
      `${v[0].toFixed(6)},${v[1].toFixed(6)}`;

    const dedupA = new Set(verticesA.map(serializePair));
    const dedupB = new Set(verticesB.map(serializePair));

    expect(dedupA.size).toBe(verticesA.length);
    expect(dedupB.size).toBe(verticesB.length);

    // Also confirm both contexts converged to the same set of vertices
    // (CRDT deterministic merge).
    for (const v of verticesA) {
      expect(dedupB.has(serializePair(v))).toBe(true);
    }

    // Cleanup.
    await ctxA.close();
    await ctxB.close();
  });
});
