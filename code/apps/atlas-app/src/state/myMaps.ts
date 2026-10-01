// SPDX-License-Identifier: AGPL-3.0-only
//
// My maps: what the editor does when the user opens, starts, deletes or
// restores a map. The maps are the PersistenceStore's `doc:<id>` slots; the
// MyMapsDialog shows them and calls these.
//
// The open map is kept before another one replaces it: its pending changes
// are saved to its own slot first. The user is asked only when that save
// fails and the map holds work that is not in a file (hasUnsavedWork), since
// only then does the switch lose anything.

import { ulid } from "ulid";

import { CURRENT_MANIFEST_VERSION } from "@atlasdraw/data";
import { documentFrame } from "@atlasdraw/geo";

import type { ExcalidrawImperativeAPI } from "@atlasdraw/excalidraw";

import type { AtlasdrawDocument, Camera } from "@atlasdraw/data";

import { useBasemapStore } from "./basemap";
import {
  DEFAULT_CAMERA,
  DEFAULT_DOCUMENT_TITLE,
  currentDocument,
} from "./document";
import { decode, hasUnsavedWork, loadDocument } from "./documentIO";
import { useMapInstanceStore } from "./mapInstance";
import { restoreFromServer } from "./remoteMapIdCache";
import { usePersistenceStore } from "./usePersistenceStore";

import type { StorageClient } from "../services/createHttpStorageClient";

export interface MapActionContext {
  api: ExcalidrawImperativeAPI;
  notify?: { success: (msg: string) => void; error: (msg: string) => void };
  /**
   * Asked when the open map's changes cannot be kept. True lets the action
   * go on and lose them. Without it, the action stops.
   */
  confirmLoss?: () => Promise<boolean>;
}

/**
 * Save the open map's pending changes to its slot. False when they could
 * not be saved and the user did not agree to lose them.
 */
async function keepOpenMap(ctx: MapActionContext): Promise<boolean> {
  const persistence = usePersistenceStore.getState();
  if (!persistence.persistenceStore?.isDirty()) {
    return true;
  }
  try {
    await persistence.forceSave();
    return true;
  } catch (err) {
    // eslint-disable-next-line no-console
    console.warn("[atlasdraw] could not keep the open map", err);
    if (!hasUnsavedWork(currentDocument())) {
      return true;
    }
    return (await ctx.confirmLoss?.()) ?? false;
  }
}

/** Open a saved map in place of the open one. True when it opened. */
export async function openSavedMap(
  ctx: MapActionContext,
  id: string,
): Promise<boolean> {
  const store = usePersistenceStore.getState().persistenceStore;
  if (!store || id === currentDocument().id) {
    return false;
  }
  if (!(await keepOpenMap(ctx))) {
    return false;
  }
  try {
    const file = await store.open(id);
    if (!file) {
      ctx.notify?.error("This map is not saved in this browser now.");
      return false;
    }
    const opened = await loadDocument(file, ctx.api);
    if (!opened) {
      return false;
    }
    ctx.notify?.success(`Opened "${file.manifest.title}"`);
    return true;
  } catch (err) {
    // eslint-disable-next-line no-console
    console.warn("[atlasdraw] could not open a saved map", err);
    ctx.notify?.error("This map is damaged and cannot open.");
    return false;
  }
}

/** Where the map is looking now, so a new map starts there. */
function cameraNow(): Camera {
  const map = useMapInstanceStore.getState().map;
  if (!map) {
    return DEFAULT_CAMERA;
  }
  const center = map.getCenter();
  return {
    center: [center.lng, center.lat],
    zoom: map.getZoom(),
    bearing: map.getBearing(),
    pitch: map.getPitch(),
  };
}

function blankFile(): AtlasdrawDocument {
  const now = new Date().toISOString();
  const camera = cameraNow();
  return {
    manifest: {
      id: ulid(),
      version: CURRENT_MANIFEST_VERSION,
      title: DEFAULT_DOCUMENT_TITLE,
      createdAt: now,
      updatedAt: now,
      basemap: {
        type: "registry",
        id: useBasemapStore.getState().activeBasemapId,
      },
      camera,
      // The world frame starts where the user is looking (ADR-0015).
      world: documentFrame(camera.center[0], camera.center[1]),
      layers: [],
      permissions: { publicView: false },
    },
    scene: [],
    layers: new Map(),
    styleRef: {},
    files: new Map(),
  };
}

/**
 * A shared map as a map of the user's own: a new id, so its saves never
 * reach the owner's copy, and new dates.
 */
export function copyOfSharedMap(
  shared: AtlasdrawDocument,
  now: Date = new Date(),
): AtlasdrawDocument {
  const at = now.toISOString();
  return {
    ...shared,
    manifest: { ...shared.manifest, id: ulid(), createdAt: at, updatedAt: at },
  };
}

/**
 * Open a new, blank map. It is saved at once, so it is in My maps and a
 * reload opens it. True when it opened.
 */
export async function startNewMap(ctx: MapActionContext): Promise<boolean> {
  if (!(await keepOpenMap(ctx))) {
    return false;
  }
  const opened = await loadDocument(blankFile(), ctx.api);
  if (!opened) {
    return false;
  }
  usePersistenceStore.getState().markDirty();
  return true;
}

/**
 * Delete a saved map from this browser. Deleting the open map first opens a
 * new one, so the deleted map cannot be saved again.
 */
export async function deleteSavedMap(
  ctx: MapActionContext,
  id: string,
): Promise<void> {
  const store = usePersistenceStore.getState().persistenceStore;
  if (!store) {
    return;
  }
  const title = (await store.list()).find((m) => m.id === id)?.title;
  if (id === currentDocument().id) {
    // Its changes go with it: nothing to keep, nothing to ask.
    const opened = await loadDocument(blankFile(), ctx.api);
    if (!opened) {
      return;
    }
    usePersistenceStore.getState().markDirty();
  }
  try {
    await store.remove(id);
    ctx.notify?.success(title ? `Deleted "${title}"` : "Map deleted");
  } catch (err) {
    // eslint-disable-next-line no-console
    console.warn("[atlasdraw] could not delete a saved map", err);
    ctx.notify?.error("The map could not be deleted.");
  }
}

export interface RestoreContext extends MapActionContext {
  client: StorageClient;
  /** Asked before the server copy replaces the open map. */
  confirm: () => Promise<boolean>;
}

/**
 * Replace the open map with the copy the server holds of it. The restored
 * map is then saved locally and pushed again, so both copies agree.
 */
export async function restoreServerBackup(ctx: RestoreContext): Promise<void> {
  const id = currentDocument().id;
  if (!(await ctx.confirm())) {
    return;
  }
  let bytes: Uint8Array | null;
  try {
    bytes = await restoreFromServer(ctx.client, id);
  } catch (err) {
    // eslint-disable-next-line no-console
    console.warn("[atlasdraw] server backup read failed", err);
    ctx.notify?.error(
      "Could not get the server backup. Your map did not change.",
    );
    return;
  }
  if (!bytes) {
    ctx.notify?.error("This map has no server backup.");
    return;
  }
  const decoded = await decode(new Blob([bytes as BlobPart]));
  if (!decoded.ok) {
    ctx.notify?.error("The server backup is damaged. Your map did not change.");
    return;
  }
  const opened = await loadDocument(decoded.file, ctx.api);
  if (!opened) {
    return;
  }
  usePersistenceStore.getState().markDirty();
  ctx.notify?.success(
    `Restored "${decoded.file.manifest.title}" from the server backup`,
  );
}
