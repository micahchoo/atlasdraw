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

import type { AtlasdrawDocument } from "@atlasdraw/data";

import {
  DEFAULT_CAMERA,
  DEFAULT_DOCUMENT_TITLE,
  currentDocument,
} from "./document";
import {
  decode,
  hasUnsavedWork,
  liveCamera,
  loadDocument,
  type CameraSource,
} from "./documentIO";
import { deleteServerMap, restoreFromServer } from "./remoteMapIdCache";

import type { PersistenceStateStore } from "./persistenceState";
import type { StorageClient } from "../services/createHttpStorageClient";
import type maplibregl from "maplibre-gl";

export interface MapActionContext {
  api: ExcalidrawImperativeAPI;
  /** The editor's autosave: the maps saved in this browser. */
  persistence: PersistenceStateStore;
  /** The editor's map: a new map starts where it looks, an opened one moves it. */
  map?: (CameraSource & Pick<maplibregl.Map, "jumpTo">) | null;
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
  const persistence = ctx.persistence.getState();
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
  const store = ctx.persistence.getState().persistenceStore;
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
    const opened = await loadDocument(file, ctx.api, { map: ctx.map });
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

function blankFile(ctx: MapActionContext): AtlasdrawDocument {
  const now = new Date().toISOString();
  // A new map starts where the user is looking.
  const camera = liveCamera(ctx.map ?? null) ?? DEFAULT_CAMERA;
  return {
    manifest: {
      id: ulid(),
      version: CURRENT_MANIFEST_VERSION,
      title: DEFAULT_DOCUMENT_TITLE,
      createdAt: now,
      updatedAt: now,
      basemap: { type: "registry", id: currentDocument().snapshot().basemap },
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
 * A title for each map that no other map in the list shows. Maps with the
 * same title are numbered in the order they were made (a ulid sorts by
 * time): "Untitled map", "Untitled map 2". A number that another map already
 * has as its own title is skipped.
 */
export function distinctTitles(
  maps: readonly { id: string; title: string }[],
): Map<string, string> {
  const taken = new Set(maps.map((m) => m.title));
  const byTitle = new Map<string, string[]>();
  for (const m of maps) {
    byTitle.set(m.title, [...(byTitle.get(m.title) ?? []), m.id]);
  }
  const out = new Map<string, string>();
  for (const [title, ids] of byTitle) {
    const [first, ...rest] = [...ids].sort();
    out.set(first!, title);
    let n = 2;
    for (const id of rest) {
      while (taken.has(`${title} ${n}`)) {
        n++;
      }
      const name = `${title} ${n}`;
      taken.add(name);
      out.set(id, name);
    }
  }
  return out;
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
  const opened = await loadDocument(blankFile(ctx), ctx.api, { map: ctx.map });
  if (!opened) {
    return false;
  }
  ctx.persistence.getState().markDirty();
  return true;
}

/**
 * Delete a saved map from this browser, and with `server`, its server copy:
 * every link and embed made from it stops working. The server copy goes
 * first; if it cannot, nothing is deleted, so the user can try again.
 * Deleting the open map first opens a new one, so the deleted map cannot be
 * saved again.
 */
export async function deleteSavedMap(
  ctx: MapActionContext,
  id: string,
  opts: { server?: StorageClient } = {},
): Promise<void> {
  const store = ctx.persistence.getState().persistenceStore;
  if (!store) {
    return;
  }
  const title = (await store.list()).find((m) => m.id === id)?.title;
  const name = title ? `"${title}"` : "the map";
  if (opts.server) {
    try {
      await deleteServerMap(opts.server, id);
    } catch (err) {
      // eslint-disable-next-line no-console
      console.warn("[atlasdraw] could not delete a server map", err);
      ctx.notify?.error(
        `The server copy of ${name} could not be deleted, so nothing was deleted. Try again later.`,
      );
      return;
    }
  }
  if (id === currentDocument().id) {
    // Its changes go with it: nothing to keep, nothing to ask.
    const opened = await loadDocument(blankFile(ctx), ctx.api, {
      map: ctx.map,
    });
    if (!opened) {
      return;
    }
    ctx.persistence.getState().markDirty();
  }
  try {
    await store.remove(id);
  } catch (err) {
    // eslint-disable-next-line no-console
    console.warn("[atlasdraw] could not delete a saved map", err);
    ctx.notify?.error("The map could not be deleted.");
    return;
  }
  if (opts.server) {
    ctx.notify?.success(`Deleted ${name} and its server copy`);
  } else {
    ctx.notify?.success(title ? `Deleted ${name}` : "Map deleted");
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
  const opened = await loadDocument(decoded.file, ctx.api, { map: ctx.map });
  if (!opened) {
    return;
  }
  ctx.persistence.getState().markDirty();
  ctx.notify?.success(
    `Restored "${decoded.file.manifest.title}" from the server backup`,
  );
}
