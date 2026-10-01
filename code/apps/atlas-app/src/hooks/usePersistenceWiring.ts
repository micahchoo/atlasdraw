// SPDX-License-Identifier: AGPL-3.0-only
//
// Persistence wiring. When Excalidraw is ready: create the PersistenceStore,
// load the last autosaved document and open it (documentIO.loadDocument),
// start autosave, and mirror the dirty and drain state into
// usePersistenceStore for the "Unsaved" indicator and the share flush.
//
// What marks the document dirty: a change of the open Document's revision
// (its layers, payloads, title), a change of the basemap, and, from
// useExcalidrawChangeHandler, a change of the drawing. A pan is none of these.

import { useEffect } from "react";

import type { ExcalidrawImperativeAPI } from "@atlasdraw/excalidraw";

import { createPersistenceStore, startAutoSave } from "../state/persistence";
import { usePersistenceStore } from "../state/usePersistenceStore";
import { useBasemapStore } from "../state/basemap";
import { currentDocument, followDocument } from "../state/document";
import { loadDocument, restoreCamera, toFile } from "../state/documentIO";
import { useMapInstanceStore } from "../state/mapInstance";
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
      onRemoteSaveFailed: () => {
        // Edge-triggered: notify once on the ok->failed transition, not on
        // every subsequent autosave tick while the server stays down (that
        // would spam a toast every debounce cycle).
        const wasFailed = usePersistenceStore.getState().remoteSaveFailed;
        usePersistenceStore.getState().setRemoteSaveFailed(true);
        if (!wasFailed) {
          documentNotify.error(
            "Couldn't sync to the server — your changes are saved locally but not backed up",
          );
        }
      },
    });
    usePersistenceStore.getState().setPersistenceStore(store);

    // T13: register an imperative `forceSave` that bypasses the debounce
    // (option (b) from the T13 brief — hold the store + getDoc pair here,
    // call store.save(getDoc())). useShareLink consumes this via
    // usePersistenceStore to guarantee a fresh snapshot before
    // share-link minting.
    const getDoc = () => toFile(currentDocument());
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
    let unsubCamera: () => void = () => {};
    void (async () => {
      try {
        const loaded = await store.load();
        if (cancelled) {
          return;
        }
        if (loaded) {
          await loadDocument(loaded, excalidrawAPI);
          // hydrate moved the map if there was one. The autosave can load
          // before the map exists; then the saved camera waits for the map,
          // for as long as this editor is mounted.
          if (!useMapInstanceStore.getState().map) {
            unsubCamera = useMapInstanceStore.subscribe(() => {
              if (restoreCamera(loaded.manifest.camera)) {
                unsubCamera();
              }
            });
          }
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
        documentNotify.error(
          "Couldn't load your saved map — starting from a blank canvas",
        );
      }
    })();

    const unsubDirty = store.onDirty(() => {
      // The underlying store's onDirty fires on its own markDirty(); mirror
      // into Zustand for the MainMenu indicator. Wrapped in setState rather
      // than markDirty() to avoid re-forwarding back into the store.
      // T13: also flip isDraining so consumers know a save will fire.
      usePersistenceStore.setState({ isDirty: true, isDraining: true });
    });

    // A command on the open document is an edit. Opening another document
    // is not; whoever opens one decides whether it needs a save.
    let followed = currentDocument();
    let followedRevision = followed.revision;
    const unsubDocument = followDocument((doc) => {
      if (doc === followed && doc.revision !== followedRevision) {
        usePersistenceStore.getState().markDirty();
      }
      followed = doc;
      followedRevision = doc.revision;
    });
    // The basemap is saved in the manifest, so choosing another one is an
    // edit too.
    const unsubBasemap = useBasemapStore.subscribe((state, prev) => {
      if (state.activeBasemapId !== prev.activeBasemapId) {
        usePersistenceStore.getState().markDirty();
      }
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
      unsubDocument();
      unsubBasemap();
      unsubCamera();
      dispose();
      usePersistenceStore.getState().setAutosaveDispose(null);
      usePersistenceStore.getState().setPersistenceStore(null);
      void store.close();
    };
  }, [excalidrawAPI, documentNotify]);
}
