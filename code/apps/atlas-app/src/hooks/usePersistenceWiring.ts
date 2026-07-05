// SPDX-License-Identifier: AGPL-3.0-only
//
// T9 — Persistence wiring.
//
// On excalidrawAPI ready: create a PersistenceStore, attempt to load() the
// last-persisted document from IDB, start auto-save, and register the dirty
// channel to React state for the MainMenu indicator.
//
// Phase 4 W0 (atlasdraw-3601): scene + layers + FCs are hydrated via
// `hydrate(loaded, excalidrawAPI)` in state/hydrate.ts. The previously
// observe-only stub left a refreshed page with a blank canvas even when an
// IDB doc existed; this closes the round-trip gate.
//
// Extracted from MapEditor.tsx (DEADWOOD.md god-module split, Cut 3). No
// test covered the autosave debounce/forceSave path directly before this
// extraction — indirect coverage came from MapEditor.atlasdraw-export.test.tsx
// exercising saveAtlasDocument/openAtlasDocument, which read the same
// usePersistenceStore contract. New usePersistenceWiring.test.ts adds direct
// characterization coverage.

import { useEffect } from "react";

import type { ExcalidrawImperativeAPI } from "@atlasdraw/excalidraw";

import { createPersistenceStore, startAutoSave } from "../state/persistence";
import { usePersistenceStore } from "../state/usePersistenceStore";
import { useLayerRegistryStore } from "../state/layerRegistry";
import { selectDocument } from "../state/selectDocument";
import { hydrate } from "../state/hydrate";
import { getAppConfig } from "../config/app-config";
import { createHttpStorageClient } from "../services/createHttpStorageClient";
import { buildRemoteSaveCallback } from "../state/remoteMapIdCache";

/** Structurally identical to MapEditor's DocumentNotify — kept local so this
 * hook doesn't import a type from the component file it was extracted from. */
export interface PersistenceWiringNotify {
  error: (msg: string) => void;
}

/**
 * Wires the persistence lifecycle to `excalidrawAPI`: constructs the
 * PersistenceStore (with optional backend remote-save), loads + hydrates any
 * previously-persisted document, starts auto-save, and mirrors dirty/drain
 * state into the Zustand usePersistenceStore for the MainMenu indicator and
 * useShareLink's pre-share flush.
 */
export function usePersistenceWiring(
  excalidrawAPI: ExcalidrawImperativeAPI | null,
  documentNotify: PersistenceWiringNotify,
): void {
  useEffect(() => {
    if (!excalidrawAPI) {
      return;
    }

    // T13 — backend persistence wire-up. Only constructed when the build
    // target opts in (hosted edition); local-only/pages tiers run the IDB
    // path unchanged. The factory holds an in-memory `mapId` ref so the
    // first save mints a new id (POST /maps) and subsequent saves hit
    // PUT /maps/:id. The id is persisted to localStorage under a known
    // key so reloads continue updating the same map.
    const cfg = getAppConfig();
    const remoteSave = cfg.enableBackendPersistence
      ? buildRemoteSaveCallback(
          createHttpStorageClient({ baseUrl: cfg.storageBaseUrl }),
        )
      : undefined;
    const store = createPersistenceStore({
      remoteSave,
      onRemoteSaveFailed: () =>
        usePersistenceStore.getState().setRemoteSaveFailed(true),
    });
    usePersistenceStore.getState().setPersistenceStore(store);

    // T13: register an imperative `forceSave` that bypasses the debounce
    // (option (b) from the T13 brief — hold the store + getDoc pair here,
    // call store.save(getDoc())). useShareLink consumes this via
    // usePersistenceStore to guarantee a fresh snapshot before
    // share-link minting.
    const getDoc = () =>
      selectDocument(excalidrawAPI, useLayerRegistryStore.getState());
    usePersistenceStore.getState().setForceSave(async () => {
      try {
        await store.save(getDoc());
        usePersistenceStore.getState().setLastSavedAt(Date.now());
        usePersistenceStore.getState().setDraining(false);
      } catch (err) {
        // Surface the failure but always clear isDraining — leaving it
        // stuck would silently freeze the Share button forever.
        usePersistenceStore.getState().setDraining(false);
        throw err;
      }
    });

    let cancelled = false;
    void (async () => {
      try {
        const loaded = await store.load();
        if (cancelled) {
          return;
        }
        if (loaded) {
          await hydrate(loaded, excalidrawAPI);
          // eslint-disable-next-line no-console
          console.info("[atlasdraw] persisted document hydrated", {
            id: loaded.manifest.id,
            layerCount: loaded.manifest.layers.length,
            sceneLength: loaded.scene.length,
          });
        }
      } catch (err) {
        // eslint-disable-next-line no-console
        console.warn("[atlasdraw] persistence.load() failed", err);
      }
    })();

    const unsubDirty = store.onDirty(() => {
      // The underlying store's onDirty fires on its own markDirty(); mirror
      // into Zustand for the MainMenu indicator. Wrapped in setState rather
      // than markDirty() to avoid re-forwarding back into the store.
      // T13: also flip isDraining so consumers know a save will fire.
      usePersistenceStore.setState({ isDirty: true, isDraining: true });
    });

    const dispose = startAutoSave(
      store,
      getDoc,
      undefined,
      undefined,
      () => {
        usePersistenceStore.getState().clearDirty();
        usePersistenceStore.getState().setDraining(false);
        usePersistenceStore.getState().setLastSavedAt(Date.now());
        if (!store.remoteSaveFailed()) {
          usePersistenceStore.getState().setRemoteSaveFailed(false);
        }
      },
      () => {
        // The store already logged the error; the user just needs to know
        // the "Saved" indicator is stale.
        documentNotify.error(
          "Auto-save failed — recent changes may not be saved",
        );
      },
    );
    usePersistenceStore.getState().setAutosaveDispose(dispose);

    return () => {
      cancelled = true;
      unsubDirty();
      dispose();
      usePersistenceStore.getState().setAutosaveDispose(null);
      usePersistenceStore.getState().setPersistenceStore(null);
      void store.close();
    };
  }, [excalidrawAPI, documentNotify]);
}
