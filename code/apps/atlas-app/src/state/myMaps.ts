// SPDX-License-Identifier: AGPL-3.0-only
//
// My maps: what the editor does when the user opens, starts, deletes or
// restores a map, or opens an earlier server version of it. The maps are the PersistenceStore's `doc:<id>` slots; the
// MyMapsDialog shows them and calls these.
//
// The open map is kept before another one replaces it: its pending changes
// (the history is dirty) are saved to its own slot first. The user is asked only when that save
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
import { admit } from "./documentGate";
import {
  hasUnsavedWork,
  liveCamera,
  loadDocument,
  type CameraSource,
} from "./documentIO";
import { isNewerBuildError } from "./persistence";
import {
  deleteServerMap,
  readServerVersion,
  saveRestoredVersion,
} from "./remoteMapIdCache";

import type { PersistenceStateStore } from "./persistenceState";
import type { History } from "../session/history";
import type { StorageClient } from "../services/createHttpStorageClient";
import type maplibregl from "maplibre-gl";

export interface MapActionContext {
  api: ExcalidrawImperativeAPI;
  /** The editor's autosave: the maps saved in this browser. */
  persistence: PersistenceStateStore;
  /** The editor's history: whether the open map has unsaved changes. */
  history: Pick<History, "dirty">;
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
  if (!persistence.persistenceStore || !ctx.history.dirty) {
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
    const stored = await store.open(id);
    if (!stored) {
      ctx.notify?.error("This map is not saved in this browser now.");
      return false;
    }
    const admitted = await admit(stored, "file");
    if (!admitted.ok) {
      ctx.notify?.error(`This map cannot open: ${admitted.reason}`);
      return false;
    }
    const file = admitted.doc;
    const opened = await loadDocument(admitted, ctx.api, {
      map: ctx.map,
      onDropped: (message) => ctx.notify?.error(message),
    });
    if (!opened) {
      return false;
    }
    ctx.notify?.success(`Opened "${file.manifest.title}"`);
    return true;
  } catch (err) {
    // eslint-disable-next-line no-console
    console.warn("[atlasdraw] could not open a saved map", err);
    ctx.notify?.error(
      isNewerBuildError(err)
        ? "A newer version of Atlasdraw saved this map. Update Atlasdraw to open it; the map is kept."
        : "This map is damaged and cannot open.",
    );
    return false;
  }
}

/**
 * Save the map that was just opened: it is new to this browser (a blank
 * map, a server backup). Opening is no edit, so the history does not ask
 * for this save.
 */
async function saveOpened(ctx: MapActionContext): Promise<void> {
  try {
    await ctx.persistence.getState().forceSave();
  } catch (err) {
    // eslint-disable-next-line no-console
    console.warn("[atlasdraw] could not save the opened map", err);
    ctx.notify?.error("Couldn't save the map in this browser.");
  }
}

/** Open a new, blank map in the editor; null when the open was overtaken. */
async function openBlank(ctx: MapActionContext) {
  const blank = await admit(blankFile(ctx), "file");
  if (!blank.ok) {
    throw new Error(`a blank map was refused: ${blank.reason}`);
  }
  return loadDocument(blank, ctx.api, { map: ctx.map });
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
      // The world frame starts where the user is looking
      // (docs/architecture/adr/0015-world-coordinates-gate.md).
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
  const opened = await openBlank(ctx);
  if (!opened) {
    return false;
  }
  await saveOpened(ctx);
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
    const opened = await openBlank(ctx);
    if (!opened) {
      return;
    }
    await saveOpened(ctx);
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

export interface VersionContext extends MapActionContext {
  client: StorageClient;
}

export interface RestoreContext extends VersionContext {
  /** Asked before the version replaces the open map. */
  confirm: () => Promise<boolean>;
}

/**
 * One server version of the open map, admitted by the gate; null after the
 * user was told why not.
 */
async function serverVersion(ctx: VersionContext, revision: number) {
  let bytes: Uint8Array | null;
  try {
    bytes = await readServerVersion(ctx.client, currentDocument().id, revision);
  } catch (err) {
    // eslint-disable-next-line no-console
    console.warn("[atlasdraw] server version read failed", err);
    ctx.notify?.error(
      "Could not get this version from the server. Your map did not change.",
    );
    return null;
  }
  if (!bytes) {
    ctx.notify?.error("This map has no server copy.");
    return null;
  }
  const decoded = await admit(new Blob([bytes as BlobPart]), "share");
  if (!decoded.ok) {
    ctx.notify?.error(
      `This version cannot open: ${decoded.reason} Your map did not change.`,
    );
    return null;
  }
  return { bytes, decoded };
}

/**
 * Replace the open map with one of its server versions, after a yes. The
 * server saves the version as a new revision and keeps the one it replaces
 * (docs/architecture/adr/0020-server-version-history.md), so a restore is
 * never final. The restored map is then saved here too.
 */
export async function restoreServerVersion(
  ctx: RestoreContext,
  revision: number,
): Promise<void> {
  const id = currentDocument().id;
  if (!(await ctx.confirm())) {
    return;
  }
  const version = await serverVersion(ctx, revision);
  if (!version) {
    return;
  }
  try {
    await saveRestoredVersion(ctx.client, version.bytes, id);
  } catch (err) {
    // eslint-disable-next-line no-console
    console.warn("[atlasdraw] server version restore failed", err);
    ctx.notify?.error(
      `The server did not take the restore${
        err instanceof Error ? `: ${err.message}` : "."
      } Your map did not change.`,
    );
    return;
  }
  const opened = await loadDocument(version.decoded, ctx.api, {
    map: ctx.map,
    onDropped: (message) => ctx.notify?.error(message),
  });
  if (!opened) {
    return;
  }
  await saveOpened(ctx);
  ctx.notify?.success(
    `Restored an earlier version of "${version.decoded.doc.manifest.title}"`,
  );
}

/**
 * Open one server version of the open map as a new map of its own: a look at
 * an old version that changes neither the open map nor the server.
 */
export async function openServerVersionCopy(
  ctx: VersionContext,
  revision: number,
): Promise<void> {
  const version = await serverVersion(ctx, revision);
  if (!version || !(await keepOpenMap(ctx))) {
    return;
  }
  const copy = {
    ...version.decoded,
    doc: copyOfSharedMap(version.decoded.doc),
  };
  const opened = await loadDocument(copy, ctx.api, {
    map: ctx.map,
    onDropped: (message) => ctx.notify?.error(message),
  });
  if (!opened) {
    return;
  }
  await saveOpened(ctx);
  ctx.notify?.success(
    `Opened a copy of an earlier version of "${copy.doc.manifest.title}"`,
  );
}
