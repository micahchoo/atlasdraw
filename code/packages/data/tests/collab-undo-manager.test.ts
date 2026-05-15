// @atlasdraw/data — CollabUndoManager distributed-state undo scoping tests.
//
// Phase 5 Task 12: Yjs UndoManager must scope to local-origin ops only so
// User A's undo never silently removes User B's work.
//
// Test A: User A mutates, User B mutates, User A undoes -> A's mutation gone,
//         B's mutation present
// Test B: User A undoes with empty local stack -> no-op, no error
// Test C: User A redoes after undo -> A's mutation restored without touching
//         B's state

import { describe, it, expect } from "vitest";
import * as Y from "yjs";
import { CollabUndoManager } from "../src/collab-undo-manager";
import { addFeature } from "../src/yjs-layer";

// ---------------------------------------------------------------------------
// Helpers
// ---------------------------------------------------------------------------

/** Apply all pending updates from `srcDoc` into `tgtDoc`. */
function sync(srcDoc: Y.Doc, tgtDoc: Y.Doc): void {
  const update = Y.encodeStateAsUpdate(srcDoc);
  Y.applyUpdate(tgtDoc, update);
}

/**
 * Ensure that a named layer map exists in the given doc's "layers" map.
 * Returns the layer Y.Map. Creates with origin null if absent (untracked
 * by any CollabUndoManager that tracks a non-null origin).
 */
function ensureLayer(
  doc: Y.Doc,
  layerName: string,
): Y.Map<Y.Map<unknown>> {
  const layers = doc.getMap("layers") as Y.Map<Y.Map<unknown>>;
  let layer = layers.get(layerName) as Y.Map<Y.Map<unknown>> | undefined;
  if (!layer) {
    // Create outside any tracked origin (implicit origin = null).
    // This ensures the layer structure itself is never captured by
    // a CollabUndoManager that tracks a non-null origin.
    layer = new Y.Map() as Y.Map<Y.Map<unknown>>;
    layers.set(layerName, layer);
  }
  return layer;
}

/**
 * Get all feature IDs present in the "layers" map of a Y.Doc under a
 * given layer name. Returns as a sorted array for deterministic comparison.
 */
function getFeatureIds(doc: Y.Doc, layerName: string): string[] {
  const layers = doc.getMap("layers") as Y.Map<Y.Map<unknown>>;
  const layer = layers.get(layerName) as Y.Map<unknown> | undefined;
  if (!layer) return [];
  const ids: string[] = [];
  for (const [key] of layer) {
    ids.push(key);
  }
  return ids.sort();
}

// ---------------------------------------------------------------------------
// Tests
// ---------------------------------------------------------------------------

describe("CollabUndoManager — distributed state scoping", () => {
  const originA = "socket-A";
  const originB = "socket-B";
  const LAYER = "shapes";

  // ---------- Test A ----------

  it("Test A: User A undoes only their own mutations, leaving B's intact", () => {
    // 1. Create docA with a pre-existing "shapes" layer (created outside
    //    tracked origins so the UndoManager never undoes the layer itself).
    const docA = new Y.Doc();
    ensureLayer(docA, LAYER);

    // Create CollabUndoManager AFTER the layer exists.
    const umA = new CollabUndoManager(docA, originA);

    // Create docB from A's initial state (layer exists, no features yet).
    const docB = new Y.Doc();
    sync(docA, docB);
    ensureLayer(docB, LAYER);

    // 2. User A adds feat-A (tagged with originA)
    const layerA = docA.getMap("layers").get(LAYER) as Y.Map<Y.Map<unknown>>;
    docA.transact(() => {
      addFeature(layerA, "feat-A", "Polygon", [
        [[0, 0], [1, 0], [1, 1], [0, 1], [0, 0]],
      ], { owner: "A" });
    }, originA);

    // Sync A -> B so B sees feat-A
    sync(docA, docB);

    // 3. User B adds feat-B (tagged with originB on docB)
    const layerB = docB.getMap("layers").get(LAYER) as Y.Map<Y.Map<unknown>>;
    docB.transact(() => {
      addFeature(layerB, "feat-B", "Polygon", [
        [[10, 10], [20, 10], [20, 20], [10, 20], [10, 10]],
      ], { owner: "B" });
    }, originB);

    // Sync B -> A so A's doc also contains feat-B
    sync(docB, docA);

    // Verify both features exist before undo
    expect(getFeatureIds(docA, LAYER)).toEqual(["feat-A", "feat-B"]);

    // 4. User A undoes — should remove feat-A, keep feat-B
    umA.undo();

    const afterUndo = getFeatureIds(docA, LAYER);
    expect(afterUndo).toContain("feat-B");
    expect(afterUndo).not.toContain("feat-A");
  });

  // ---------- Test B ----------

  it("Test B: undo with empty local stack is a no-op (no error)", () => {
    const doc = new Y.Doc();
    const um = new CollabUndoManager(doc, originA);

    // No operations tracked by this UndoManager — should not throw
    expect(() => um.undo()).not.toThrow();

    // canUndo / canRedo are both false
    expect(um.canUndo).toBe(false);
    expect(um.canRedo).toBe(false);
  });

  // ---------- Test C ----------

  it("Test C: User A redoes after undo — A's mutation restored, B's untouched", () => {
    const docA = new Y.Doc();
    ensureLayer(docA, LAYER);
    const umA = new CollabUndoManager(docA, originA);

    const docB = new Y.Doc();
    sync(docA, docB);
    ensureLayer(docB, LAYER);

    // User A adds feat-A (originA)
    const layerA = docA.getMap("layers").get(LAYER) as Y.Map<Y.Map<unknown>>;
    docA.transact(() => {
      addFeature(layerA, "feat-A", "Polygon", [
        [[0, 0], [1, 0], [1, 1], [0, 1], [0, 0]],
      ], { owner: "A" });
    }, originA);

    sync(docA, docB);

    // User B adds feat-B (originB)
    const layerB = docB.getMap("layers").get(LAYER) as Y.Map<Y.Map<unknown>>;
    docB.transact(() => {
      addFeature(layerB, "feat-B", "Polygon", [
        [[10, 10], [20, 10], [20, 20], [10, 20], [10, 10]],
      ], { owner: "B" });
    }, originB);

    sync(docB, docA);

    // Both features present
    expect(getFeatureIds(docA, LAYER)).toEqual(["feat-A", "feat-B"]);

    // User A undoes — feat-A removed, feat-B stays
    expect(umA.canUndo).toBe(true);
    umA.undo();
    expect(getFeatureIds(docA, LAYER)).toEqual(["feat-B"]);

    // User A redoes — feat-A restored, feat-B still present
    expect(umA.canRedo).toBe(true);
    umA.redo();
    const afterRedo = getFeatureIds(docA, LAYER);
    expect(afterRedo).toContain("feat-A");
    expect(afterRedo).toContain("feat-B");
  });
});
