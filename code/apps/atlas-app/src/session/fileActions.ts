// SPDX-License-Identifier: AGPL-3.0-only
//
// Save and Open: the .atlasdraw file is the one way to keep a map in a file
// and the one way to open one. Excalidraw's own load, save and export are
// closed (MapEditor's UIOptions), so the menu, the palette and the keys all
// reach these two.

import type { AtlasdrawDocument, Camera } from "@atlasdraw/data";

import {
  documentFromExcalidrawJson,
  documentFromExcalidrawScene,
  hasUnsavedWork,
  liveCamera,
  loadDocument,
  markSavedToFile,
  toFile,
} from "../state/documentIO";
import { admit } from "../state/documentGate";
import { restoreServerBackup } from "../state/myMaps";
import { getAppConfig } from "../config/app-config";
import { createHttpStorageClient } from "../services/createHttpStorageClient";

import type { EditorSession, Notify } from "./EditorSession";

/** A dismissed picker is the user's choice, not a failure. */
function isPickerCancel(err: unknown): boolean {
  return (
    err instanceof DOMException &&
    (err.name === "AbortError" || err.name === "NotAllowedError")
  );
}

/** Write the open map to a .atlasdraw file the user picks. */
export async function saveMap(
  s: EditorSession,
  notify?: Notify,
): Promise<void> {
  const { api, map } = s.view.getState();
  const store = s.persistence.getState().persistenceStore;
  if (!api || !store) {
    return;
  }
  try {
    const doc = s.store.getState().doc;
    await store.saveToDisk(toFile(doc, undefined, liveCamera(map)));
    markSavedToFile(doc);
    s.persistence.getState().clearDirty();
    notify?.success("Map saved as .atlasdraw");
  } catch (err) {
    if (isPickerCancel(err)) {
      return;
    }
    console.warn("[atlasdraw] saveToDisk failed", err);
    notify?.error(
      `Couldn't save the map${err instanceof Error ? ` — ${err.message}` : ""}`,
    );
  }
}

/** Asked before Open replaces a map that holds work not in a file. */
export const REPLACE_QUESTION = {
  title: "Open another map?",
  body: "This map has changes you have not saved to a file. Opening another map closes it.",
  confirmLabel: "Open anyway",
};

/**
 * Open a file the user picks in place of the open map. When the open map
 * holds work that is not in a file, `confirmReplace` is asked first; without
 * a yes, nothing opens.
 */
export async function openMap(
  s: EditorSession,
  notify: Notify = s.notify,
  confirmReplace: () => Promise<boolean> = () =>
    s.view.getState().ask(REPLACE_QUESTION),
): Promise<void> {
  const store = s.persistence.getState().persistenceStore;
  if (!store) {
    return;
  }
  await openInPlace(s, notify, confirmReplace, (camera) =>
    store.openFromDisk(camera),
  );
}

/**
 * Open a scene file dropped on the canvas: an `.excalidraw` file, or a PNG
 * or SVG that carries one (the fork hands it over, `onSceneFileDrop`). It
 * opens as Open does: a question first when the open map holds unsaved
 * work, then a new map with a new id, placed where the user is looking. The
 * open map is never written over.
 */
export async function openSceneFile(
  s: EditorSession,
  file: File,
  notify: Notify = s.notify,
  confirmReplace: () => Promise<boolean> = () =>
    s.view.getState().ask(REPLACE_QUESTION),
): Promise<void> {
  await openInPlace(s, notify, confirmReplace, (camera) =>
    sceneFileDocument(file, camera),
  );
}

/** A scene file as a new document at `camera`. Throws on malformed input. */
async function sceneFileDocument(
  file: File,
  camera: Camera | null,
): Promise<AtlasdrawDocument> {
  const name = file.name.toLowerCase();
  if (name.endsWith(".excalidraw") || file.type === "application/json") {
    return documentFromExcalidrawJson(await textOf(file), camera);
  }
  // Only the fork reads a scene out of PNG or SVG metadata. It is loaded
  // here, on demand, so the document code does not depend on it.
  const { loadFromBlob } = await import("@atlasdraw/excalidraw");
  const scene = await loadFromBlob(file, null, null);
  return documentFromExcalidrawScene(
    { elements: scene.elements, files: scene.files },
    camera,
  );
}

/** A file's text. FileReader, because not every runtime has Blob.text. */
function textOf(file: Blob): Promise<string> {
  return new Promise((resolve, reject) => {
    const reader = new FileReader();
    reader.onload = () => resolve(reader.result as string);
    reader.onerror = () =>
      reject(reader.error ?? new Error("FileReader failed"));
    reader.readAsText(file);
  });
}

/**
 * The one way Open replaces the open map: ask about unsaved work, read the
 * new document, open it, report.
 */
async function openInPlace(
  s: EditorSession,
  notify: Notify | undefined,
  confirmReplace: () => Promise<boolean>,
  produce: (camera: Camera | null) => Promise<AtlasdrawDocument | null>,
): Promise<void> {
  const { api, map } = s.view.getState();
  if (!api || !s.persistence.getState().persistenceStore) {
    return;
  }
  try {
    if (hasUnsavedWork(s.store.getState().doc) && !(await confirmReplace())) {
      return;
    }
    const produced = await produce(liveCamera(map));
    if (!produced) {
      return;
    }
    const admitted = await admit(produced, "file");
    if (!admitted.ok) {
      notify?.error(`Couldn't open the file: ${admitted.reason}`);
      return;
    }
    const loaded = admitted.doc;
    // The open map's last edits may still wait for the autosave delay. Keep
    // them in its own slot before the new map takes the editor; a failure
    // throws, and nothing opens.
    const persistence = s.persistence.getState();
    if (persistence.persistenceStore?.isDirty()) {
      await persistence.forceSave();
    }
    const opened = await loadDocument(admitted, api, {
      map,
      onDropped: (message) => notify?.error(message),
    });
    if (!opened) {
      return;
    }
    markSavedToFile(opened);
    // The opened file becomes the autosaved map.
    s.persistence.getState().markDirty();
    const n = loaded.manifest.layers.length;
    notify?.success(
      `Opened "${loaded.manifest.title}" — ${n} layer${n === 1 ? "" : "s"}`,
    );
    // Save now, not after the autosave delay: when this browser holds a
    // newer copy of the same map, the user is asked while the open is fresh
    // (session/mapOwnership.ts).
    void s.persistence
      .getState()
      .forceSave()
      .catch(() => {
        /* the autosave reports a failed save */
      });
  } catch (err) {
    if (isPickerCancel(err)) {
      return;
    }
    console.warn("[atlasdraw] open failed", err);
    notify?.error(
      "Couldn't open the file — it doesn't look like a valid .atlasdraw or .excalidraw document",
    );
  }
}

/**
 * Replace the open map with the copy the server holds of it, after a yes.
 * The restored map is saved again, so both copies agree.
 */
export async function restoreBackup(s: EditorSession): Promise<void> {
  const { api, map } = s.view.getState();
  if (!api) {
    return;
  }
  await restoreServerBackup({
    api,
    map,
    persistence: s.persistence,
    notify: s.notify,
    client: createHttpStorageClient({
      baseUrl: getAppConfig().storageBaseUrl ?? "",
    }),
    confirm: () =>
      s.view.getState().ask({
        title: "Restore from server backup?",
        body: "The server copy of this map replaces the map you see. Changes that are not on the server are lost.",
        confirmLabel: "Restore",
      }),
  });
}
