// SPDX-License-Identifier: AGPL-3.0-only
//
// A backup of this browser's maps and the write keys of their server maps,
// and its restore into another browser. The real PersistenceStore and the
// real server-map cache, on fake-indexeddb. A cleared browser that restores
// the file owns its published maps again.

import "fake-indexeddb/auto";
import { openDB } from "idb";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

import type { AtlasdrawDocument } from "@atlasdraw/data";

import { makeBackup, restoreBackupFile } from "../backup";
import { createPersistenceStore, type PersistenceStore } from "../persistence";
import {
  buildRemoteSaveCallback,
  hasServerMap,
  serverVersions,
} from "../remoteMapIdCache";

import type { StorageClient } from "../../services/createHttpStorageClient";

const A = "01J0000000000000000000000A";
const B = "01J0000000000000000000000B";

const doc = (id: string, title: string): AtlasdrawDocument => ({
  manifest: {
    id,
    version: 2,
    title,
    createdAt: "2026-05-06T00:00:00.000Z",
    updatedAt: "2026-05-06T00:00:00.000Z",
    basemap: { type: "registry", id: "default" },
    camera: { center: [0, 0], zoom: 4, bearing: 0, pitch: 0 },
    world: { z0: 22, origin: { x: 0, y: 0 } },
    layers: [],
    permissions: { publicView: false },
  },
  scene: [],
  layers: new Map(),
  styleRef: {},
  files: new Map(),
});

/** A Blob's text. jsdom's Blob has no text(). */
const textOf = (blob: Blob): Promise<string> =>
  new Promise((resolve, reject) => {
    const reader = new FileReader();
    reader.onload = () => resolve(String(reader.result));
    reader.onerror = () => reject(reader.error);
    reader.readAsText(blob);
  });

function server() {
  return {
    createMap: vi.fn(async () => ({
      map: { id: "map000000000000000001", revision: 1 },
      writeKey: "key-1",
    })),
    listVersions: vi.fn(async () => ({ current: 1, versions: [] })),
  } as unknown as StorageClient;
}

/** Empty the server-map cache: a cleared browser. */
async function clearKeys(): Promise<void> {
  const db = await openDB("atlasdraw-autosave", 1, {
    upgrade: (d) => {
      if (!d.objectStoreNames.contains("state")) {
        d.createObjectStore("state");
      }
    },
  });
  await db.clear("state");
  db.close();
}

let n = 0;
let stores: PersistenceStore[] = [];
const freshStore = () => {
  const store = createPersistenceStore({ dbName: `backup-${++n}` });
  stores.push(store);
  return store;
};

beforeEach(clearKeys);

afterEach(async () => {
  await Promise.all(stores.map((s) => s.close()));
  stores = [];
});

describe("makeBackup", () => {
  it("holds every saved map and the write key of each server map", async () => {
    const store = freshStore();
    await store.save(doc(A, "Harbour"));
    await store.save(doc(B, "Ridge"));
    await buildRemoteSaveCallback(server())(new Blob(["x"]), A);

    const backup = await makeBackup(store, new Date("2026-10-01T12:00:00Z"));
    const body = JSON.parse(await textOf(backup.blob));

    expect(backup.fileName).toBe("atlasdraw-backup-2026-10-01.json");
    expect(backup.maps).toBe(2);
    expect(backup.keys).toBe(1);
    expect(body.format).toBe("atlasdraw-backup");
    expect(body.maps.map((m: { title: string }) => m.title).sort()).toEqual([
      "Harbour",
      "Ridge",
    ]);
    expect(body.servers).toEqual([
      {
        documentId: A,
        mapId: "map000000000000000001",
        writeKey: "key-1",
        revision: 1,
      },
    ]);
  });

  it("does not change which map a reload opens", async () => {
    const store = freshStore();
    await store.save(doc(A, "Harbour"));
    await store.save(doc(B, "Ridge"));

    await makeBackup(store);

    expect((await store.load())?.manifest.id).toBe(B);
  });
});

describe("restoreBackupFile", () => {
  it("a cleared browser gets the maps and owns their server maps again", async () => {
    const before = freshStore();
    await before.save(doc(A, "Harbour"));
    const client = server();
    await buildRemoteSaveCallback(client)(new Blob(["x"]), A);
    const backup = await makeBackup(before);
    await clearKeys();
    const after = freshStore();

    const result = await restoreBackupFile(after, backup.blob);

    expect(result).toEqual({ added: 1, kept: 0, keys: 1, keptKeys: 0 });
    expect((await after.list()).map((m) => m.title)).toEqual(["Harbour"]);
    expect(await hasServerMap(A)).toBe(true);
    await serverVersions(client, A);
    expect(client.listVersions).toHaveBeenCalledWith(
      "map000000000000000001",
      "key-1",
    );
  });

  it("keeps a map and a key this browser already holds", async () => {
    const store = freshStore();
    await store.save(doc(A, "Harbour"));
    await buildRemoteSaveCallback(server())(new Blob(["x"]), A);
    const backup = await makeBackup(store);
    await store.save({ ...doc(A, "Harbour, edited here") });

    const result = await restoreBackupFile(store, backup.blob);

    expect(result).toEqual({ added: 0, kept: 1, keys: 0, keptKeys: 1 });
    expect((await store.list())[0]?.title).toBe("Harbour, edited here");
  });

  it("refuses a file that is not a backup, and changes nothing", async () => {
    const store = freshStore();

    await expect(
      restoreBackupFile(store, new Blob(['{"format":"other"}'])),
    ).rejects.toThrow(/not an Atlasdraw backup/);
    await expect(
      restoreBackupFile(store, new Blob(["not json"])),
    ).rejects.toThrow(/not an Atlasdraw backup/);
    expect(await store.list()).toEqual([]);
  });
});
