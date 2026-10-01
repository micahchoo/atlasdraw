// SPDX-License-Identifier: AGPL-3.0-only
//
// My maps, at the store: list(), open(id) and remove(id) over the
// `doc:<id>` slots of the real PersistenceStore on fake-indexeddb.

import "fake-indexeddb/auto";
import { openDB } from "idb";
import { afterEach, describe, expect, it } from "vitest";

import type { AtlasdrawDocument } from "@atlasdraw/data";

import { createPersistenceStore, type PersistenceStore } from "../persistence";

const A = "01J0000000000000000000000A";
const B = "01J0000000000000000000000B";

const makeDoc = (
  id: string,
  title: string,
  updatedAt: string,
): AtlasdrawDocument => ({
  manifest: {
    id,
    version: 2,
    title,
    createdAt: "2026-05-01T00:00:00.000Z",
    updatedAt,
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

let n = 0;
const freshDb = (): string => `atlasdraw-list-${++n}-${Date.now()}`;

let store: PersistenceStore | null = null;
const open = (dbName = freshDb()): PersistenceStore => {
  store = createPersistenceStore({ dbName });
  return store;
};

afterEach(async () => {
  await store?.close();
  store = null;
});

describe("PersistenceStore — My maps", () => {
  it("list() is empty when nothing is saved", async () => {
    expect(await open().list()).toEqual([]);
  });

  it("list() gives every saved map, the last changed first", async () => {
    const s = open();
    await s.save(makeDoc(A, "Harbour walk", "2026-05-02T00:00:00.000Z"));
    await s.save(makeDoc(B, "Field sites", "2026-05-03T00:00:00.000Z"));

    expect(await s.list()).toEqual([
      { id: B, title: "Field sites", updatedAt: "2026-05-03T00:00:00.000Z" },
      { id: A, title: "Harbour walk", updatedAt: "2026-05-02T00:00:00.000Z" },
    ]);
  });

  it("list() shows the title and time of the last save of a map", async () => {
    const s = open();
    await s.save(makeDoc(A, "Draft", "2026-05-02T00:00:00.000Z"));
    await s.save(makeDoc(A, "Final", "2026-05-04T00:00:00.000Z"));

    expect(await s.list()).toEqual([
      { id: A, title: "Final", updatedAt: "2026-05-04T00:00:00.000Z" },
    ]);
  });

  it("list() includes a map that an older build saved with no summary", async () => {
    const dbName = freshDb();
    const s = open(dbName);
    await s.save(makeDoc(A, "Old map", "2026-05-01T12:00:00.000Z"));
    // An older build wrote the bytes only.
    const raw = await openDB(dbName);
    await raw.delete("state", `summary:${A}`);
    raw.close();

    expect(await s.list()).toEqual([
      { id: A, title: "Old map", updatedAt: "2026-05-01T12:00:00.000Z" },
    ]);
  });

  it("list() leaves out a stored copy it cannot read", async () => {
    const dbName = freshDb();
    const s = open(dbName);
    await s.save(makeDoc(A, "Good", "2026-05-02T00:00:00.000Z"));
    const raw = await openDB(dbName);
    await raw.put(
      "state",
      { bytes: new Uint8Array(8), type: "application/zip" },
      `doc:${B}`,
    );
    raw.close();

    expect((await s.list()).map((m) => m.id)).toEqual([A]);
  });

  it("open(id) reads that map and makes it the one a reload opens", async () => {
    const s = open();
    await s.save(makeDoc(A, "First", "2026-05-02T00:00:00.000Z"));
    await s.save(makeDoc(B, "Second", "2026-05-03T00:00:00.000Z"));

    const opened = await s.open(A);

    expect(opened?.manifest.title).toBe("First");
    expect((await s.load())?.manifest.id).toBe(A);
  });

  it("open(id) gives null for a map that is not there", async () => {
    expect(await open().open(A)).toBeNull();
  });

  it("remove(id) deletes the map from the list", async () => {
    const s = open();
    await s.save(makeDoc(A, "First", "2026-05-02T00:00:00.000Z"));
    await s.save(makeDoc(B, "Second", "2026-05-03T00:00:00.000Z"));

    await s.remove(A);

    expect((await s.list()).map((m) => m.id)).toEqual([B]);
    expect(await s.open(A)).toBeNull();
  });

  it("remove(id) of the map a reload opens leaves nothing to reload", async () => {
    const s = open();
    await s.save(makeDoc(A, "First", "2026-05-02T00:00:00.000Z"));
    await s.save(makeDoc(B, "Second", "2026-05-03T00:00:00.000Z"));

    await s.remove(B);

    expect(await s.load()).toBeNull();
  });

  it("remove(id) waits for a save of that map that is in progress", async () => {
    const s = open();
    const saving = s.save(makeDoc(A, "First", "2026-05-02T00:00:00.000Z"));
    const removing = s.remove(A);
    await Promise.all([saving, removing]);

    expect(await s.list()).toEqual([]);
  });
});
