// SPDX-License-Identifier: AGPL-3.0-only
//
// My maps: open, start, delete and restore a map in the editor. The real
// PersistenceStore on fake-indexeddb, the real Document and documentIO; only
// Excalidraw and the storage server are stand-ins.

import "fake-indexeddb/auto";
import { openDB } from "idb";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

import { write, type AtlasdrawDocument } from "@atlasdraw/data";

import { createDocument, currentDocument, openDocument } from "../document";
import { toFile } from "../documentIO";
import {
  copyOfSharedMap,
  distinctTitles,
  deleteSavedMap,
  openSavedMap,
  restoreServerBackup,
  startNewMap,
} from "../myMaps";
import { createPersistenceStore, type PersistenceStore } from "../persistence";
import { buildRemoteSaveCallback } from "../remoteMapIdCache";
import { sceneOf } from "../scene";
import {
  createPersistenceState,
  type PersistenceStateStore,
} from "../persistenceState";

import {
  makeFakeExcalidraw,
  type FakeExcalidraw,
} from "./fixtures/documentWorld";

import type { StorageClient } from "../../services/createHttpStorageClient";

const A = "01J0000000000000000000000A";
const B = "01J0000000000000000000000B";

const savedFile = (
  id: string,
  title: string,
  updatedAt: string,
  elementId = `el-${id}`,
): AtlasdrawDocument => ({
  manifest: {
    id,
    version: 2,
    title,
    createdAt: "2026-05-01T00:00:00.000Z",
    updatedAt,
    basemap: { type: "registry", id: "protomaps-light" },
    camera: { center: [0, 0], zoom: 4, bearing: 0, pitch: 0 },
    world: { z0: 22, origin: { x: 0, y: 0 } },
    layers: [],
    permissions: { publicView: false },
  },
  scene: [
    {
      id: elementId,
      type: "rectangle",
      x: 0,
      y: 0,
      width: 10,
      height: 10,
    },
  ] as unknown as AtlasdrawDocument["scene"],
  layers: new Map(),
  styleRef: {},
  files: new Map(),
});

const blobBytes = (blob: Blob): Promise<Uint8Array> =>
  new Promise((resolve, reject) => {
    const reader = new FileReader();
    reader.onload = () => resolve(new Uint8Array(reader.result as ArrayBuffer));
    reader.onerror = () => reject(reader.error);
    reader.readAsArrayBuffer(blob);
  });

let n = 0;
let store: PersistenceStore;
let fx: FakeExcalidraw;
/** The editor's autosave state; a new one for every case. */
let persistence: PersistenceStateStore = createPersistenceState();
const notify = { success: vi.fn(), error: vi.fn() };

/** The open map: a drawing with one element, edited since its last save. */
function openEditedMap(title = "Current"): string {
  fx = makeFakeExcalidraw([{ id: "drawn", type: "ellipse" }]);
  const doc = createDocument({ title }, sceneOf(fx.api));
  openDocument(doc);
  persistence.getState().markDirty();
  return doc.id;
}

beforeEach(async () => {
  store = createPersistenceStore({ dbName: `my-maps-${++n}-${Date.now()}` });
  persistence = createPersistenceState();
  persistence.getState().setPersistenceStore(store);
  persistence
    .getState()
    .setForceSave(() => store.save(toFile(currentDocument())));
  notify.success.mockClear();
  notify.error.mockClear();
  const remote = await openDB("atlasdraw-autosave", 1, {
    upgrade: (d) => {
      d.createObjectStore("state");
    },
  });
  await remote.clear("state");
  remote.close();
});

afterEach(async () => {
  persistence.getState().setPersistenceStore(null);
  await store.close();
});

describe("openSavedMap", () => {
  it("opens the chosen map in the editor", async () => {
    await store.save(savedFile(A, "Harbour walk", "2026-05-02T00:00:00.000Z"));
    openEditedMap();

    const opened = await openSavedMap({ api: fx.api, persistence, notify }, A);

    expect(opened).toBe(true);
    expect(currentDocument().id).toBe(A);
    expect(currentDocument().snapshot().title).toBe("Harbour walk");
    expect(fx.all().map((e) => e.id)).toEqual([`el-${A}`]);
    expect(notify.success).toHaveBeenCalledWith('Opened "Harbour walk"');
  });

  it("keeps the changes to the open map in My maps before it opens another", async () => {
    await store.save(savedFile(A, "Harbour walk", "2026-05-02T00:00:00.000Z"));
    const current = openEditedMap("Field sites");

    await openSavedMap({ api: fx.api, persistence, notify }, A);

    const listed = await store.list();
    expect(listed.map((m) => m.id).sort()).toEqual([A, current].sort());
    expect(listed.find((m) => m.id === current)?.title).toBe("Field sites");
  });

  it("asks first when the changes to the open map cannot be kept, and a no opens nothing", async () => {
    await store.save(savedFile(A, "Harbour walk", "2026-05-02T00:00:00.000Z"));
    const current = openEditedMap();
    persistence
      .getState()
      .setForceSave(() => Promise.reject(new Error("quota")));
    const confirmLoss = vi.fn(async () => false);

    const opened = await openSavedMap(
      { api: fx.api, persistence, notify, confirmLoss },
      A,
    );

    expect(confirmLoss).toHaveBeenCalledTimes(1);
    expect(opened).toBe(false);
    expect(currentDocument().id).toBe(current);
  });

  it("does not ask when the open map is kept", async () => {
    await store.save(savedFile(A, "Harbour walk", "2026-05-02T00:00:00.000Z"));
    openEditedMap();
    const confirmLoss = vi.fn(async () => false);

    await openSavedMap({ api: fx.api, persistence, notify, confirmLoss }, A);

    expect(confirmLoss).not.toHaveBeenCalled();
    expect(currentDocument().id).toBe(A);
  });

  it("tells the user when the map is no longer saved", async () => {
    const current = openEditedMap();

    const opened = await openSavedMap({ api: fx.api, persistence, notify }, B);

    expect(opened).toBe(false);
    expect(currentDocument().id).toBe(current);
    expect(notify.error).toHaveBeenCalledWith(
      "This map is not saved in this browser now.",
    );
  });
});

describe("distinctTitles", () => {
  const C = "01J0000000000000000000000C";

  it("numbers repeated titles in the order the maps were made", () => {
    const titles = distinctTitles([
      { id: C, title: "Untitled map" },
      { id: A, title: "Untitled map" },
      { id: B, title: "Field sites" },
    ]);
    expect(titles.get(A)).toBe("Untitled map");
    expect(titles.get(C)).toBe("Untitled map 2");
    expect(titles.get(B)).toBe("Field sites");
  });

  it("skips a number another map already has as its title", () => {
    const titles = distinctTitles([
      { id: A, title: "Untitled map" },
      { id: B, title: "Untitled map 2" },
      { id: C, title: "Untitled map" },
    ]);
    expect(titles.get(C)).toBe("Untitled map 3");
    expect(titles.get(B)).toBe("Untitled map 2");
  });
});

describe("copyOfSharedMap", () => {
  it("is the same map under a new id and new dates", () => {
    const shared = savedFile(A, "Wells", "2026-05-02T00:00:00.000Z");
    const copy = copyOfSharedMap(shared, new Date("2026-10-01T00:00:00Z"));
    expect(copy.manifest.id).not.toBe(A);
    expect(copy.manifest.title).toBe("Wells");
    expect(copy.manifest.createdAt).toBe("2026-10-01T00:00:00.000Z");
    expect(copy.manifest.updatedAt).toBe("2026-10-01T00:00:00.000Z");
    expect(copy.manifest.camera).toEqual(shared.manifest.camera);
    expect(copy.scene).toBe(shared.scene);
    expect(shared.manifest.id).toBe(A);
  });
});

describe("startNewMap", () => {
  it("opens a blank map and saves it in My maps", async () => {
    const before = openEditedMap();

    await startNewMap({ api: fx.api, persistence, notify });

    const doc = currentDocument();
    expect(doc.id).not.toBe(before);
    expect(fx.all()).toEqual([]);
    await persistence.getState().forceSave();
    expect((await store.list()).map((m) => m.id)).toContain(doc.id);
  });
});

describe("deleteSavedMap", () => {
  it("deletes another map and leaves the open map open", async () => {
    await store.save(savedFile(A, "Harbour walk", "2026-05-02T00:00:00.000Z"));
    const current = openEditedMap();

    await deleteSavedMap({ api: fx.api, persistence, notify }, A);

    expect(currentDocument().id).toBe(current);
    expect((await store.list()).map((m) => m.id)).not.toContain(A);
    expect(notify.success).toHaveBeenCalledWith('Deleted "Harbour walk"');
  });

  it("deletes the server copy too when asked", async () => {
    await store.save(savedFile(A, "Harbour walk", "2026-05-02T00:00:00.000Z"));
    openEditedMap();
    const server = {
      createMap: vi.fn(async () => ({
        map: { id: "map000000000000000001" },
        writeKey: "key-1",
      })),
      deleteMap: vi.fn(async () => {}),
    } as unknown as StorageClient;
    await buildRemoteSaveCallback(server)(new Blob(["x"]), A);

    await deleteSavedMap({ api: fx.api, persistence, notify }, A, { server });

    expect(server.deleteMap).toHaveBeenCalledWith(
      "map000000000000000001",
      "key-1",
    );
    expect((await store.list()).map((m) => m.id)).not.toContain(A);
    expect(notify.success).toHaveBeenCalledWith(
      'Deleted "Harbour walk" and its server copy',
    );
  });

  it("keeps the map when its server copy could not be deleted", async () => {
    await store.save(savedFile(A, "Harbour walk", "2026-05-02T00:00:00.000Z"));
    openEditedMap();
    const server = {
      createMap: vi.fn(async () => ({
        map: { id: "map000000000000000001" },
        writeKey: "key-1",
      })),
      deleteMap: vi.fn(async () => {
        throw new Error("offline");
      }),
    } as unknown as StorageClient;
    await buildRemoteSaveCallback(server)(new Blob(["x"]), A);

    await deleteSavedMap({ api: fx.api, persistence, notify }, A, { server });

    expect((await store.list()).map((m) => m.id)).toContain(A);
    expect(notify.error).toHaveBeenCalledWith(
      'The server copy of "Harbour walk" could not be deleted, so nothing was deleted. Try again later.',
    );
  });

  it("starts a new map when it deletes the open map", async () => {
    const current = openEditedMap("Field sites");
    await persistence.getState().forceSave();

    await deleteSavedMap({ api: fx.api, persistence, notify }, current);

    expect(currentDocument().id).not.toBe(current);
    expect(fx.all()).toEqual([]);
    expect((await store.list()).map((m) => m.id)).not.toContain(current);
  });
});

describe("restoreServerBackup", () => {
  async function serverHolding(file: AtlasdrawDocument) {
    const bytes = await blobBytes(await write(file));
    const client = {
      createMap: vi.fn(async () => ({
        map: { id: "map000000000000000001" },
        writeKey: "key-1",
      })),
      updateMap: vi.fn(async () => ({})),
      readMap: vi.fn(async () => bytes.slice().buffer),
    } as unknown as StorageClient;
    await buildRemoteSaveCallback(client)(new Blob(["x"]), file.manifest.id);
    return client;
  }

  it("replaces the open map with the server copy after a yes", async () => {
    fx = makeFakeExcalidraw([{ id: "local-edit", type: "ellipse" }]);
    openDocument(createDocument({ id: A, title: "Local" }, sceneOf(fx.api)));
    const client = await serverHolding(
      savedFile(A, "From server", "2026-05-02T00:00:00.000Z", "server-el"),
    );

    await restoreServerBackup({
      api: fx.api,
      persistence,
      notify,
      client,
      confirm: async () => true,
    });

    expect(currentDocument().snapshot().title).toBe("From server");
    expect(fx.all().map((e) => e.id)).toEqual(["server-el"]);
    expect(notify.success).toHaveBeenCalledWith(
      'Restored "From server" from the server backup',
    );
  });

  it("changes nothing after a no", async () => {
    fx = makeFakeExcalidraw([{ id: "local-edit", type: "ellipse" }]);
    openDocument(createDocument({ id: A, title: "Local" }, sceneOf(fx.api)));
    const client = await serverHolding(
      savedFile(A, "From server", "2026-05-02T00:00:00.000Z"),
    );

    await restoreServerBackup({
      api: fx.api,
      persistence,
      notify,
      client,
      confirm: async () => false,
    });

    expect(currentDocument().snapshot().title).toBe("Local");
    expect(fx.all().map((e) => e.id)).toEqual(["local-edit"]);
  });

  it("tells the user when the server copy cannot be read", async () => {
    fx = makeFakeExcalidraw([{ id: "local-edit", type: "ellipse" }]);
    openDocument(createDocument({ id: A, title: "Local" }, sceneOf(fx.api)));
    const client = await serverHolding(
      savedFile(A, "From server", "2026-05-02T00:00:00.000Z"),
    );
    (client.readMap as ReturnType<typeof vi.fn>).mockResolvedValue(
      new Uint8Array([1, 2, 3]).buffer,
    );

    await restoreServerBackup({
      api: fx.api,
      persistence,
      notify,
      client,
      confirm: async () => true,
    });

    expect(currentDocument().snapshot().title).toBe("Local");
    expect(notify.error).toHaveBeenCalledWith(
      "The server backup is damaged. Your map did not change.",
    );
  });
});
