// SPDX-License-Identifier: AGPL-3.0-only
//
// The remote save keeps one server map per document. Before, one map id was
// shared by every document, so opening a second document and waiting five
// seconds replaced the first document on the server.

import "fake-indexeddb/auto";
import { openDB } from "idb";
import { beforeEach, describe, expect, it, vi } from "vitest";

import { buildRemoteSaveCallback } from "../remoteMapIdCache";

import type { StorageClient } from "../../services/createHttpStorageClient";

const DB = "atlasdraw-autosave";
const A = "01J0000000000000000000000A";
const B = "01J0000000000000000000000B";

function fakeClient() {
  let n = 0;
  const createMap = vi.fn(async (_blob: Blob) => ({
    id: `map${String(++n).padStart(18, "0")}`,
  }));
  const updateMap = vi.fn(async (_mapId: string, _blob: Blob) => {});
  return {
    client: { createMap, updateMap } as unknown as StorageClient,
    createMap,
    updateMap,
  };
}

beforeEach(async () => {
  const db = await openDB(DB, 1, {
    upgrade(d) {
      if (!d.objectStoreNames.contains("state")) {
        d.createObjectStore("state");
      }
    },
  });
  await db.clear("state");
  db.close();
});

describe("buildRemoteSaveCallback", () => {
  it("creates one server map per document and updates each in place", async () => {
    const { client, createMap, updateMap } = fakeClient();
    const save = buildRemoteSaveCallback(client);
    const blob = new Blob(["zip"]);

    await save(blob, A);
    await save(blob, B);
    await save(blob, A);

    expect(createMap).toHaveBeenCalledTimes(2);
    expect(updateMap).toHaveBeenCalledTimes(1);
    expect(updateMap.mock.calls[0][0]).toBe("map000000000000000001");
  });

  it("remembers each document's server map across a reload", async () => {
    const first = fakeClient();
    await buildRemoteSaveCallback(first.client)(new Blob(["zip"]), A);

    const second = fakeClient();
    await buildRemoteSaveCallback(second.client)(new Blob(["zip"]), A);

    expect(second.createMap).not.toHaveBeenCalled();
    expect(second.updateMap.mock.calls[0][0]).toBe("map000000000000000001");
  });

  it("gives the one map id an older build kept to the first document saved, and no other", async () => {
    const db = await openDB(DB, 1);
    await db.put("state", "legacyMapIdxxxxxxxxxx", "remoteMapId");
    db.close();
    const { client, createMap, updateMap } = fakeClient();
    const save = buildRemoteSaveCallback(client);

    await save(new Blob(["zip"]), A);
    await save(new Blob(["zip"]), B);

    expect(updateMap.mock.calls[0][0]).toBe("legacyMapIdxxxxxxxxxx");
    expect(createMap).toHaveBeenCalledTimes(1);
  });
});
