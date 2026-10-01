// SPDX-License-Identifier: AGPL-3.0-only
// The autosave's state, for the editor's views: one store per editor
// session (session/EditorSession.ts#persistence).
//
// The imperative `PersistenceStore` (state/persistence.ts: IndexedDB, file
// pickers, the autosave timer) is the source of truth for I/O and stays
// framework-free. This store holds what the views read: the dirty flag (the
// status bar's "Unsaved"), whether a save is in flight, the last save time,
// and the handle usePersistenceWiring makes.
//
// markDirty() is forwarded to the underlying PersistenceStore so the auto-save
// debounce timer kicks. Without that forward, edits would set the indicator
// red but never actually persist.

import { immer } from "zustand/middleware/immer";
import { createStore, type StoreApi } from "zustand/vanilla";

import type { PersistenceStore } from "./persistence";

export type PersistenceState = {
  persistenceStore: PersistenceStore | null;
  isDirty: boolean;
  /**
   * True while a save is in flight (from first markDirty after a quiet
   * window until the save callback resolves). Distinct from `isDirty`: the
   * canvas can be dirty for 5s before the trailing-edge debounce fires, and
   * `isDraining` reflects "a save is actively flushing right now" so the
   * Share UI knows to wait.
   */
  isDraining: boolean;
  /** ms since the epoch of the last successful local save. */
  lastSavedAt: number | null;
  /** True when the last remoteSave failed (IDB ok, server stale). */
  remoteSaveFailed: boolean;
  /**
   * False while the autosave reads and opens the user's own map at start.
   * A room waits for it (hooks/useRoom.ts), so the map the user comes back
   * to when they leave the room is their own, not the blank one the editor
   * starts with. True where no autosave runs.
   */
  ownMapLoaded: boolean;
  /**
   * True when this tab must not write the open map: another tab holds it
   * (session/mapOwnership.ts). The autosave saves nothing and the drawing
   * is in view mode.
   */
  readOnly: boolean;
  /**
   * Save now, set by usePersistenceWiring when it makes the persistence
   * store. Calls `store.save(getDoc())` directly, bypassing the
   * debounce timer. Returns a promise that resolves when the IDB write (and
   * remoteSave, if configured) completes.
   */
  forceSave: () => Promise<void>;
  setPersistenceStore: (store: PersistenceStore | null) => void;
  markDirty: () => void;
  clearDirty: () => void;
  setDraining: (v: boolean) => void;
  setLastSavedAt: (ts: number | null) => void;
  setForceSave: (fn: () => Promise<void>) => void;
  setRemoteSaveFailed: (v: boolean) => void;
  setOwnMapLoaded: (v: boolean) => void;
  setReadOnly: (v: boolean) => void;
};

export type PersistenceStateStore = StoreApi<PersistenceState>;

export function createPersistenceState(): PersistenceStateStore {
  return createStore<PersistenceState>()(
    immer((set, get) => ({
      persistenceStore: null,
      isDirty: false,
      isDraining: false,
      lastSavedAt: null,
      remoteSaveFailed: false,
      ownMapLoaded: true,
      readOnly: false,
      // A no-op until usePersistenceWiring sets it, so an early call is safe.
      forceSave: () => Promise.resolve(),

      setPersistenceStore: (store) =>
        set((s) => {
          s.persistenceStore = store;
        }),

      markDirty: () => {
        // Forward to underlying PersistenceStore *first* so the debounce timer
        // starts before any React re-render the isDirty flip might trigger.
        // Reading via get() avoids capturing a stale closure.
        const underlying = get().persistenceStore;
        if (underlying) {
          underlying.markDirty();
        }
        set((s) => {
          s.isDirty = true;
          // Observably synchronous: by the time the React tree sees the
          // markDirty -> isDirty=true flip, isDraining is already true so the
          // UI never paints a "clean" frame between user edit and save start.
          s.isDraining = true;
        });
      },

      clearDirty: () =>
        set((s) => {
          s.isDirty = false;
        }),

      setDraining: (v) =>
        set((s) => {
          s.isDraining = v;
        }),

      setLastSavedAt: (ts) =>
        set((s) => {
          s.lastSavedAt = ts;
        }),

      setForceSave: (fn) =>
        set((s) => {
          s.forceSave = fn;
        }),

      setRemoteSaveFailed: (v) =>
        set((s) => {
          s.remoteSaveFailed = v;
        }),

      setOwnMapLoaded: (v) =>
        set((s) => {
          s.ownMapLoaded = v;
        }),

      setReadOnly: (v) =>
        set((s) => {
          s.readOnly = v;
        }),
    })),
  );
}
