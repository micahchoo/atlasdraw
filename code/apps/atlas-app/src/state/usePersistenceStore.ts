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
  autosaveDispose: (() => void) | null;
  setPersistenceStore: (store: PersistenceStore | null) => void;
  markDirty: () => void;
  clearDirty: () => void;
  setAutosaveDispose: (fn: (() => void) | null) => void;
};

export const usePersistenceStore = create<PersistenceState>()(
  immer((set, get) => ({
    persistenceStore: null,
    isDirty: false,
    autosaveDispose: null,

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
      });
    },

    clearDirty: () =>
      set((s) => {
        s.isDirty = false;
      }),

    setAutosaveDispose: (fn) =>
      set((s) => {
        s.autosaveDispose = fn;
      }),
  })),
);
