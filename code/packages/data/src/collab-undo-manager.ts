// @atlasdraw/data — CollabUndoManager, wrapping Y.UndoManager with per-user
// origin scoping for collaborative undo under distributed state.
//
// Phase 5 Task 12: Yjs UndoManager scopes to local-origin ops only —
// User A's undo never silently removes User B's work. Remote updates (from
// relay) arrive without origin tag and are automatically ignored by the
// UndoManager's trackedOrigins filter.
//
// For SCENE_UPDATE channel (Excalidraw LWW): the undo manager tracks Yjs-layer
// operations (features, vertices, properties). Excalidraw's own undo stack
// handles scene-level undo separately.
//
// Usage:
//   const um = new CollabUndoManager(ydoc, socket.id);
//
//   // All local mutations must be tagged:
//   ydoc.transact(() => {
//     addFeature(layer, "feat-1", "Polygon", [...]);
//   }, socket.id);
//
//   um.undo(); // reverts only ops tagged with socket.id
//   um.redo(); // re-applies last-undone local ops

import * as Y from "yjs";

// ---------------------------------------------------------------------------
// CollabUndoManager
// ---------------------------------------------------------------------------

export class CollabUndoManager {
  private _undoManager: Y.UndoManager;

  /**
   * @param doc         The shared Y.Doc for this collab session.
   * @param localOrigin An opaque identifier unique to this client (typically
   *                    the Socket.IO socket.id). Only operations tagged with
   *                    this origin via `doc.transact(fn, localOrigin)` are
   *                    tracked for undo/redo.
   */
  constructor(doc: Y.Doc, localOrigin: unknown) {
    // Scope to the top-level "layers" Y.Map where all data-layer features
    // and geometry live. The UndoManager recursively tracks operations on
    // nested types (feature maps, geometry maps, Y.Arrays of coordinates).
    const layers = doc.getMap("layers");

    this._undoManager = new Y.UndoManager(layers, {
      trackedOrigins: new Set([localOrigin]),
    });
  }

  /** Revert the most recent local mutation. No-op if the undo stack is empty. */
  undo(): void {
    this._undoManager.undo();
  }

  /** Re-apply the most recently undone local mutation. No-op if empty. */
  redo(): void {
    this._undoManager.redo();
  }

  /** True when the undo stack has at least one tracked item. */
  get canUndo(): boolean {
    return this._undoManager.undoStack.length > 0;
  }

  /** True when the redo stack has at least one tracked item. */
  get canRedo(): boolean {
    return this._undoManager.redoStack.length > 0;
  }

  /**
   * Stop merging subsequent operations into the current undo stack item.
   * Useful when you want a clean boundary (e.g. after completing a vertex
   * drag, before starting a new one).
   */
  stopCapturing(): void {
    this._undoManager.stopCapturing();
  }
}
