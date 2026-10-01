// SPDX-License-Identifier: AGPL-3.0-only
//
// Persistence wiring. When Excalidraw is ready: create the PersistenceStore,
// load the last autosaved document and open it (documentIO.loadDocument),
// start autosave, and mirror the dirty and drain state into the session's
// persistence state for the "Unsaved" indicator and the share flush.
//
// What marks the document dirty: a change of the open Document's revision
// (its layers, payloads, title, basemap), and, from
// useExcalidrawChangeHandler, a change of the drawing. A pan is none of these.

import { useEffect, useLayoutEffect, useRef } from "react";

import type { ExcalidrawImperativeAPI } from "@atlasdraw/excalidraw";

import type { AtlasdrawDocument } from "@atlasdraw/data";

import {
  createPersistenceStore,
  isNewerBuildError,
  startAutoSave,
} from "../state/persistence";
import { currentDocument, followDocument } from "../state/document";
import {
  liveCamera,
  loadDocument,
  restoreCamera,
  toFile,
} from "../state/documentIO";
import { admit, type Admitted } from "../state/documentGate";
import { isRoomDocument } from "../state/room";
import { getAppConfig } from "../config/app-config";
import { createHttpStorageClient } from "../services/createHttpStorageClient";
import { buildRemoteSaveCallback } from "../state/remoteMapIdCache";
import {
  loadShareDocument,
  type ShareLoadResult,
} from "../state/loadShareDocument";
import { copyOfSharedMap } from "../state/myMaps";
import { answerConflict, holdOpenMaps } from "../session/mapOwnership";
import { buildRoute, type SharedMap } from "../routes";
import { trackSave } from "../state/lastSave";

import type { EditorSession } from "../session/EditorSession";
import type { Conflict } from "../state/documentStore";

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

/** What the wiring needs of the editor's session. */
export type PersistenceSession = Pick<EditorSession, "view" | "persistence">;

/**
 * Wires the persistence lifecycle to `excalidrawAPI`: constructs the
 * PersistenceStore (with optional backend remote-save), loads and opens the
 * last autosaved document, starts auto-save, and mirrors dirty/drain state
 * into the session's persistence state. A save reads the camera from the
 * session's map; a load moves it.
 */
export function usePersistenceWiring(
  session: PersistenceSession,
  excalidrawAPI: ExcalidrawImperativeAPI | null,
  documentNotify: PersistenceWiringNotify,
  /** A shared map to open as a copy in place of the autosave. */
  open: SharedMap | null = null,
): void {
  const { view, persistence } = session;
  // Read once: the link is consumed by the first open.
  const openRef = useRef(open);
  // Save what is unsaved, now. Set by the effect below; called when the
  // editor goes away (unmountSave).
  const flushRef = useRef<(() => Promise<unknown> | null) | null>(null);
  // That save, so the store closes only after it.
  const unmountSave = useRef<Promise<unknown> | null>(null);

  // The editor is going away: an error took it down, or the route changed.
  // A layout effect's cleanup runs before the children unmount, while
  // Excalidraw still holds the drawing; after that its scene is empty, and
  // the passive cleanup below would save an empty map.
  useLayoutEffect(
    () => () => {
      let save: Promise<unknown> | null;
      try {
        save = flushRef.current?.() ?? null;
      } catch (err) {
        // A cleanup must not throw: the crash screen says the save failed.
        console.error("[persistence] save on unmount failed", err);
        save = Promise.reject(err);
        save.catch(() => undefined);
      }
      unmountSave.current = save;
      if (save) {
        trackSave(save);
      }
    },
    [excalidrawAPI],
  );

  useEffect(() => {
    if (!excalidrawAPI) {
      return;
    }

    // A build that saves to a server pushes each save there too. The first
    // push of a map creates it (POST /maps); later pushes update it
    // (PUT /maps/:id). The id and write key are kept in IndexedDB
    // (state/remoteMapIdCache.ts), so a reload goes on updating the same map.
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
        const wasFailed = persistence.getState().remoteSaveFailed;
        persistence.getState().setRemoteSaveFailed(true);
        if (!wasFailed) {
          documentNotify.error(
            "Couldn't sync to the server — your changes are saved locally but not backed up",
          );
        }
      },
    });
    persistence.getState().setPersistenceStore(store);

    // `forceSave` saves now, past the autosave delay: My maps and a room
    // call it before the open map leaves the editor. A room's document is the
    // relay's to keep (docs/architecture/adr/0018-rooms-persist-in-relay-sqlite.md):
    // the autosave writes only the user's own maps. A tab that does not hold
    // the map (session/mapOwnership.ts) writes nothing either.
    const getDoc = () => {
      const doc = currentDocument();
      return isRoomDocument(doc) || persistence.getState().readOnly
        ? null
        : toFile(doc, undefined, liveCamera(view.getState().map));
    };
    // A save that met a newer copy asks the user, once at a time; the
    // autosave's later saves of the same map wait for the answer.
    const ownership = {
      view,
      persistence,
      notify: {
        success: documentNotify.success ?? (() => {}),
        error: documentNotify.error,
      },
    };
    let answering: Promise<void> | null = null;
    const onConflict = (conflict: Conflict, doc: AtlasdrawDocument) => {
      answering ??= answerConflict(ownership, store, conflict, doc)
        .catch((err) => {
          console.warn("[atlasdraw] could not settle a save conflict", err);
        })
        .finally(() => {
          answering = null;
        });
      return answering;
    };
    const unholdMaps = holdOpenMaps(ownership, store);
    persistence.getState().setForceSave(async () => {
      try {
        const doc = getDoc();
        if (doc) {
          const result = await store.save(doc);
          if (result.kind === "conflict") {
            await onConflict(result, doc);
          }
        }
        persistence.getState().setLastSavedAt(Date.now());
        persistence.getState().setDraining(false);
      } catch (err) {
        // Surface the failure but always clear isDraining — leaving it
        // stuck would silently freeze the Share button forever.
        persistence.getState().setDraining(false);
        throw err;
      }
    });

    let cancelled = false;
    const abort = new AbortController();
    let unsubCamera: () => void = () => {};
    persistence.getState().setOwnMapLoaded(false);
    // A copy of a shared map, or null when there is none or it did not load.
    const sharedCopy = async (): Promise<Admitted | null> => {
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
      // A new id and new dates; the content is what the gate admitted.
      return {
        ...shared.admitted,
        doc: copyOfSharedMap(shared.admitted.doc),
      };
    };

    void (async () => {
      try {
        const copy = await sharedCopy();
        const stored = copy ? null : await store.load();
        const admitted = copy ?? (stored ? await admit(stored, "file") : null);
        if (cancelled) {
          return;
        }
        if (admitted && !admitted.ok) {
          documentNotify.error(
            `Couldn't open your saved map: ${admitted.reason}`,
          );
          return;
        }
        const loaded = admitted?.doc ?? null;
        // A room joined while the autosave was read: the room stays open.
        if (admitted && loaded && !isRoomDocument(currentDocument())) {
          const opened = await loadDocument(admitted, excalidrawAPI, {
            signal: abort.signal,
            map: view.getState().map,
            onDropped: (message) => documentNotify.error(message),
          });
          if (!opened) {
            return;
          }
          if (copy) {
            // The copy is a new map: save it, and drop the link so a reload
            // opens the copy, not another one.
            persistence.getState().markDirty();
            window.history.replaceState(
              window.history.state,
              "",
              buildRoute({ kind: "editor", room: null, open: null }),
            );
            documentNotify.success?.(
              `Opened a copy of "${copy.doc.manifest.title}"`,
            );
          }
          // loadDocument moved the map if there was one. The autosave can load
          // before the map exists; then the saved camera waits for the map,
          // for as long as this editor is mounted.
          if (!view.getState().map) {
            unsubCamera = view.subscribe((state) => {
              if (restoreCamera(state.map, loaded.manifest.camera)) {
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
        console.warn("[atlasdraw] persistence.load() failed", err);
        documentNotify.error(
          isNewerBuildError(err)
            ? "A newer version of Atlasdraw saved your last map. It is kept in My maps; update Atlasdraw to open it."
            : "Couldn't load your saved map — starting from a blank canvas",
        );
      } finally {
        persistence.getState().setOwnMapLoaded(true);
      }
    })();

    const unsubDirty = store.onDirty(() => {
      // The underlying store's onDirty fires on its own markDirty(); mirror
      // it for the indicator. setState, not markDirty(), which would forward
      // back into the store. isDraining: a save will fire.
      persistence.setState({ isDirty: true, isDraining: true });
    });

    // A command on the open document is an edit. Opening another document
    // is not; whoever opens one decides whether it needs a save.
    let followed = currentDocument();
    let followedRevision = followed.revision;
    const unsubDocument = followDocument((doc) => {
      if (doc === followed && doc.revision !== followedRevision) {
        persistence.getState().markDirty();
      }
      followed = doc;
      followedRevision = doc.revision;
    });

    const dispose = startAutoSave(
      store,
      getDoc,
      undefined,
      undefined,
      () => {
        persistence.getState().clearDirty();
        persistence.getState().setDraining(false);
        persistence.getState().setLastSavedAt(Date.now());
        if (!store.remoteSaveFailed()) {
          persistence.getState().setRemoteSaveFailed(false);
        }
      },
      () => {
        // The store already logged the error; the user just needs to know
        // the "Saved" indicator is stale.
        documentNotify.error(
          "Auto-save failed — recent changes may not be saved",
        );
      },
      (conflict, doc) => void onConflict(conflict, doc),
    );

    // Closing or leaving the tab: write unsaved changes now, not after the
    // autosave delay. 'visibilitychange' to hidden comes first and leaves the
    // most time; 'pagehide' covers a close that skips it.
    const flushOnLeave = (): Promise<unknown> | null => {
      const doc = store.isDirty() ? getDoc() : null;
      if (!doc) {
        return null;
      }
      const save = store.save(doc);
      save.catch((err) => {
        console.error("[persistence] save on leave failed", err);
      });
      return save;
    };
    flushRef.current = flushOnLeave;
    const onVisibility = () => {
      if (document.visibilityState === "hidden") {
        flushOnLeave();
      }
    };
    document.addEventListener("visibilitychange", onVisibility);
    const onPageHide = () => void flushOnLeave();
    window.addEventListener("pagehide", onPageHide);

    return () => {
      cancelled = true;
      abort.abort();
      document.removeEventListener("visibilitychange", onVisibility);
      window.removeEventListener("pagehide", onPageHide);
      unsubDirty();
      unsubDocument();
      unsubCamera();
      unholdMaps();
      persistence.getState().setOwnMapLoaded(true);
      dispose();
      flushRef.current = null;
      persistence.getState().setPersistenceStore(null);
      // The unmount's save (above) still writes through this connection.
      const pending = unmountSave.current ?? Promise.resolve();
      unmountSave.current = null;
      void pending.catch(() => undefined).then(() => store.close());
    };
  }, [excalidrawAPI, documentNotify, view, persistence]);
}
