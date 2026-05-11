// SPDX-License-Identifier: AGPL-3.0-only
// Phase 3 Wave 2 Task T9 — Persistence Zustand store.
//
// Bridges the imperative `PersistenceStore` (state/persistence.ts — the IDB +
// FSA + auto-save machinery) into React-reactive state. The underlying store
// is the source of truth for I/O; this Zustand store is the source of truth
// for UI-visible flags (isDirty for the MainMenu indicator) and lifecycle
// handles (autosaveDispose for unmount cleanup).
//
// Why a separate Zustand store rather than refactoring persistence.ts: the
// imperative store is unit-tested in isolation against fake-indexeddb and
// must remain framework-free. Wrapping it here keeps that contract intact.
//
// markDirty() is forwarded to the underlying PersistenceStore so the auto-save
// debounce timer kicks. Without that forward, edits would set the indicator
// red but never actually persist.

import { create } from "zustand";
import { immer } from "zustand/middleware/immer";

import type { PersistenceStore } from "./persistence";

export type PersistenceState = {
  persistenceStore: PersistenceStore | null;
  isDirty: boolean;
  /**
   * T13: True while a save is in flight (from first markDirty after a quiet
   * window until the save callback resolves). Distinct from `isDirty`: the
   * canvas can be dirty for 5s before the trailing-edge debounce fires, and
   * `isDraining` reflects "a save is actively flushing right now" so the
   * Share UI knows to wait.
   */
  isDraining: boolean;
  /** T13: ms-since-epoch of the last successful local save. */
  lastSavedAt: number | null;
  autosaveDispose: (() => void) | null;
  /**
   * T13: Imperative flush wired by MapEditor when it instantiates the
   * persistence store. Calls `store.save(getDoc())` directly, bypassing the
   * debounce timer. Returns a promise that resolves when the IDB write (and
   * remoteSave, if configured) completes.
   */
  forceSave: () => Promise<void>;
  setPersistenceStore: (store: PersistenceStore | null) => void;
  markDirty: () => void;
  clearDirty: () => void;
  setDraining: (v: boolean) => void;
  setLastSavedAt: (ts: number | null) => void;
  setAutosaveDispose: (fn: (() => void) | null) => void;
  setForceSave: (fn: () => Promise<void>) => void;
};

export const usePersistenceStore = create<PersistenceState>()(
  immer((set, get) => ({
    persistenceStore: null,
    isDirty: false,
    isDraining: false,
    lastSavedAt: null,
    autosaveDispose: null,
    // Default no-op so calling forceSave() before MapEditor wires it is safe.
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
      if (underlying) underlying.markDirty();
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

    setAutosaveDispose: (fn) =>
      set((s) => {
        s.autosaveDispose = fn;
      }),

    setForceSave: (fn) =>
      set((s) => {
        s.forceSave = fn;
      }),
  })),
);
