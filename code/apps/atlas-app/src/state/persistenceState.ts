// SPDX-License-Identifier: AGPL-3.0-only
// The autosave's state, for the editor's views: one store per editor
// session (session/EditorSession.ts#persistence).
//
// The imperative `PersistenceStore` (state/persistence.ts: IndexedDB, file
// pickers, the autosave timer) is the source of truth for I/O and stays
// framework-free. This store holds what the views read: the last save time,
// whether the server copy is behind, and the handle usePersistenceWiring
// makes. Whether the map has unsaved changes is not here: it is the
// history's (session/history.ts#dirty), the one source.

import { immer } from "zustand/middleware/immer";
import { createStore, type StoreApi } from "zustand/vanilla";

import type { PersistenceStore } from "./persistence";

export type PersistenceState = {
  persistenceStore: PersistenceStore | null;
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
   * Save the open map now, dirty or not, past the autosave delay. Set by
   * usePersistenceWiring when it makes the persistence store. Resolves
   * when the IDB write (and remoteSave, if configured) completes. A map
   * that was just made or opened from outside the browser (a new map, a
   * file, a copy of a shared map) is saved with it: opening is not an
   * edit, so the history does not ask for that save.
   */
  forceSave: () => Promise<void>;
  setPersistenceStore: (store: PersistenceStore | null) => void;
  setLastSavedAt: (ts: number | null) => void;
  setForceSave: (fn: () => Promise<void>) => void;
  setRemoteSaveFailed: (v: boolean) => void;
  setOwnMapLoaded: (v: boolean) => void;
  setReadOnly: (v: boolean) => void;
};

export type PersistenceStateStore = StoreApi<PersistenceState>;

export function createPersistenceState(): PersistenceStateStore {
  return createStore<PersistenceState>()(
    immer((set) => ({
      persistenceStore: null,
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
