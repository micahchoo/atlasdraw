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

import { useEffect, useRef } from "react";

import type { ExcalidrawImperativeAPI } from "@atlasdraw/excalidraw";

import type { AtlasdrawDocument } from "@atlasdraw/data";

import { createPersistenceStore, startAutoSave } from "../state/persistence";
import { usePersistenceStore } from "../state/usePersistenceStore";
import { useBasemapStore } from "../state/basemap";
import { currentDocument, followDocument } from "../state/document";
import { loadDocument, restoreCamera, toFile } from "../state/documentIO";
import { useMapInstanceStore } from "../state/mapInstance";
import { isRoomDocument } from "../state/room";
import { getAppConfig } from "../config/app-config";
import { createHttpStorageClient } from "../services/createHttpStorageClient";
import { buildRemoteSaveCallback } from "../state/remoteMapIdCache";
import {
  loadShareDocument,
  type ShareLoadResult,
} from "../state/loadShareDocument";
import { copyOfSharedMap } from "../state/myMaps";
import { buildRoute, type SharedMap } from "../routes";

export interface PersistenceWiringNotify {
  error: (msg: string) => void;
  success?: (msg: string) => void;
}

/** Why a shared map did not load, as the end of a sentence. */
function shareFailure(result: Exclude<ShareLoadResult, { kind: "ready" }>) {
  switch (result.kind) {
    case "not-found":
      return "the link does not point to a map.";
    case "expired":
      return "the link has expired.";
    case "error":
      return result.message
        .replace(/\.?$/, ".")
        .replace(/^./, (c) => c.toLowerCase());
  }
}

/**
 * Wires the persistence lifecycle to `excalidrawAPI`: constructs the
 * PersistenceStore (with optional backend remote-save), loads and opens the
 * last autosaved document, starts auto-save, and mirrors dirty/drain
 * state into the Zustand usePersistenceStore for the MainMenu indicator and
 * useShareLink's pre-share flush.
 */
export function usePersistenceWiring(
  excalidrawAPI: ExcalidrawImperativeAPI | null,
  documentNotify: PersistenceWiringNotify,
  /** A shared map to open as a copy in place of the autosave. */
  open: SharedMap | null = null,
): void {
  // Read once: the link is consumed by the first open.
  const openRef = useRef(open);

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
    // A room's document is the relay's to keep (ADR-0018): the autosave
    // writes only the user's own maps.
    const getDoc = () => {
      const doc = currentDocument();
      return isRoomDocument(doc) ? null : toFile(doc);
    };
    usePersistenceStore.getState().setForceSave(async () => {
      try {
        const doc = getDoc();
        if (doc) {
          await store.save(doc);
        }
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
    const abort = new AbortController();
    let unsubCamera: () => void = () => {};
    usePersistenceStore.getState().setOwnMapLoaded(false);
    // A copy of a shared map, or null when there is none or it did not load.
    const sharedCopy = async (): Promise<AtlasdrawDocument | null> => {
      const link = openRef.current;
      openRef.current = null;
      if (!link) {
        return null;
      }
      const shared = await loadShareDocument(link);
      if (shared.kind !== "ready") {
        documentNotify.error(
          `Couldn't open the shared map: ${shareFailure(shared)}`,
        );
        return null;
      }
      return copyOfSharedMap(shared.doc);
    };

    void (async () => {
      try {
        const copy = await sharedCopy();
        const loaded = copy ?? (await store.load());
        if (cancelled) {
          return;
        }
        // A room joined while the autosave was read: the room stays open.
        if (loaded && !isRoomDocument(currentDocument())) {
          const opened = await loadDocument(loaded, excalidrawAPI, {
            signal: abort.signal,
          });
          if (!opened) {
            return;
          }
          if (copy) {
            // The copy is a new map: save it, and drop the link so a reload
            // opens the copy, not another one.
            usePersistenceStore.getState().markDirty();
            window.history.replaceState(
              window.history.state,
              "",
              buildRoute({ kind: "editor", room: null, open: null }),
            );
            documentNotify.success?.(
              `Opened a copy of "${copy.manifest.title}"`,
            );
          }
          // loadDocument moved the map if there was one. The autosave can load
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
          console.info("[atlasdraw] autosaved document opened", {
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
      } finally {
        usePersistenceStore.getState().setOwnMapLoaded(true);
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

    // Closing or leaving the tab: write unsaved changes now, not after the
    // autosave delay. 'visibilitychange' to hidden comes first and leaves the
    // most time; 'pagehide' covers a close that skips it.
    const flushOnLeave = () => {
      const doc = store.isDirty() ? getDoc() : null;
      if (doc) {
        void store.save(doc).catch((err) => {
          // eslint-disable-next-line no-console
          console.error("[persistence] save on leave failed", err);
        });
      }
    };
    const onVisibility = () => {
      if (document.visibilityState === "hidden") {
        flushOnLeave();
      }
    };
    document.addEventListener("visibilitychange", onVisibility);
    window.addEventListener("pagehide", flushOnLeave);

    return () => {
      cancelled = true;
      abort.abort();
      document.removeEventListener("visibilitychange", onVisibility);
      window.removeEventListener("pagehide", flushOnLeave);
      unsubDirty();
      unsubDocument();
      unsubBasemap();
      unsubCamera();
      usePersistenceStore.getState().setOwnMapLoaded(true);
      dispose();
      usePersistenceStore.getState().setAutosaveDispose(null);
      usePersistenceStore.getState().setPersistenceStore(null);
      void store.close();
    };
  }, [excalidrawAPI, documentNotify]);
}
