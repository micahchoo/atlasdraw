// SPDX-License-Identifier: AGPL-3.0-only
// Phase 4 T13 — thin React hook exposing autosave drain state.
//
// Scope (per 2026-05-06 scrub note): WIRE-ONLY. The debounce + ceiling
// logic lives in state/persistence.ts:startAutoSave; the Zustand-backed
// reactive flags live in state/usePersistenceStore.ts. This hook is the
// React-facing facade that ShareDialog (T8) and useShareLink (T9) consume.
//
// Exposes:
//   - isDraining: synchronously-observable "save in flight" flag
//   - lastSavedAt: ms-since-epoch of the last successful save
//   - forceSave():  Promise that bypasses the debounce and flushes now
//
// `forceSave` is registered into the Zustand store by MapEditor when it
// instantiates the underlying PersistenceStore (option (b) per T13 brief —
// hold a ref to (store, getDoc) at the wire site, call store.save(getDoc())).
// Until that registration happens, `forceSave` is a no-op promise.

import { usePersistenceStore } from "../state/usePersistenceStore";

export interface AutosaveState {
  isDraining: boolean;
  lastSavedAt: number | null;
  forceSave: () => Promise<void>;
}

export function useAutosave(): AutosaveState {
  // Select narrowly so the hook only re-renders when these specific fields
  // flip. The `forceSave` field is intentionally read via getState() inside
  // the returned function rather than via the selector, so the hook doesn't
  // re-render when MapEditor replaces the imperative flush (which happens
  // exactly once at mount but still triggers a Zustand state change).
  const isDraining = usePersistenceStore((s) => s.isDraining);
  const lastSavedAt = usePersistenceStore((s) => s.lastSavedAt);
  const forceSave = (): Promise<void> =>
    usePersistenceStore.getState().forceSave();
  return { isDraining, lastSavedAt, forceSave };
}
