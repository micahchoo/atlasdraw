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
import { usePersistenceStore } from "../state/usePersistenceStore";

import type { EditorSession } from "./EditorSession";

/** Where an action tells the user how it went. */
export interface Notify {
  success: (msg: string) => void;
  error: (msg: string) => void;
}

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
  const store = usePersistenceStore.getState().persistenceStore;
  if (!api || !store) {
    return;
  }
  try {
    const doc = s.store.getState().doc;
    await store.saveToDisk(toFile(doc, undefined, liveCamera(map)));
    markSavedToFile(doc);
    usePersistenceStore.getState().clearDirty();
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

/**
 * Open a file the user picks in place of the open map. When the open map
 * holds work that is not in a file, `confirmReplace` is asked first; without
 * a yes, nothing opens.
 */
export async function openMap(
  s: EditorSession,
  notify?: Notify,
  confirmReplace: () => Promise<boolean> = async () => false,
): Promise<void> {
  const { api, map } = s.view.getState();
  const store = usePersistenceStore.getState().persistenceStore;
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
    usePersistenceStore.getState().markDirty();
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
