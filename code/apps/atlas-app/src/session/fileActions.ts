// SPDX-License-Identifier: AGPL-3.0-only
//
// Save and Open: the .atlasdraw file is the one way to keep a map in a file
// and the one way to open one. Excalidraw's own load, save and export are
// closed (MapEditor's UIOptions), so the menu, the palette and the keys all
// reach these two.

import {
  hasUnsavedWork,
  liveCamera,
  loadDocument,
  markSavedToFile,
  toFile,
} from "../state/documentIO";
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
    // eslint-disable-next-line no-console
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
  const { api, map } = s.view.getState();
  const store = s.persistence.getState().persistenceStore;
  if (!api || !store) {
    return;
  }
  try {
    if (hasUnsavedWork(s.store.getState().doc) && !(await confirmReplace())) {
      return;
    }
    const loaded = await store.openFromDisk(liveCamera(map));
    if (!loaded) {
      return;
    }
    const opened = await loadDocument(loaded, api, { map });
    if (opened) {
      markSavedToFile(opened);
    }
    // The opened file becomes the autosaved map.
    s.persistence.getState().markDirty();
    const n = loaded.manifest.layers.length;
    notify?.success(
      `Opened "${loaded.manifest.title}" — ${n} layer${n === 1 ? "" : "s"}`,
    );
  } catch (err) {
    if (isPickerCancel(err)) {
      return;
    }
    // eslint-disable-next-line no-console
    console.warn("[atlasdraw] openFromDisk failed", err);
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
