// SPDX-License-Identifier: AGPL-3.0-only
//
// One server map per document, opened by that map's write key. The save, the
// share and the restore all reach the same map, so a save updates every link
// and embed made from the document.

import "fake-indexeddb/auto";
import { openDB } from "idb";
import { beforeEach, describe, expect, it, vi } from "vitest";

import {
  buildRemoteSaveCallback,
  deleteServerMap,
  hasServerMap,
  restoreFromServer,
  revokeShare,
  saveAsNewServerCopy,
  ServerMapRefusedError,
  serverMapRefused,
  shareDocument,
} from "../remoteMapIdCache";
import { StorageHttpError } from "../../services/createHttpStorageClient";

import type { StorageClient } from "../../services/createHttpStorageClient";

const DB = "atlasdraw-autosave";
const A = "01J0000000000000000000000A";
const B = "01J0000000000000000000000B";
const bytes = () => new Blob(["zip"]);

function fakeClient() {
  let maps = 0;
  let tokens = 0;
  const createMap = vi.fn(async (_blob: Blob | Uint8Array) => {
    maps += 1;
    return {
      map: { id: `map${String(maps).padStart(18, "0")}` },
      writeKey: `key-${maps}`,
    };
  });
  const updateMap = vi.fn(
    async (_mapId: string, _key: string, _blob: Blob | Uint8Array) => ({}),
  );
  const createShareToken = vi.fn(
    async (_mapId: string, _key: string, days: number | null) => {
      tokens += 1;
      return {
        token: `tok${String(tokens).padStart(18, "0")}`,
        expiresAt: days === null ? null : "2026-05-17T00:00:00.000Z",
      };
    },
  );
  const revokeShareToken = vi.fn(async () => {});
  const readMap = vi.fn(async () => new Uint8Array([7, 7]).buffer);
  const deleteMap = vi.fn(async (_mapId: string, _key: string) => {});
  return {
    client: {
      createMap,
      updateMap,
      createShareToken,
      revokeShareToken,
      readMap,
      deleteMap,
    } as unknown as StorageClient,
    deleteMap,
    createMap,
    updateMap,
    createShareToken,
    revokeShareToken,
    readMap,
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
  it("creates one server map per document and updates each with its own key", async () => {
    const { client, createMap, updateMap } = fakeClient();
    const save = buildRemoteSaveCallback(client);

    await save(bytes(), A);
    await save(bytes(), B);
    await save(bytes(), A);

    expect(createMap).toHaveBeenCalledTimes(2);
    expect(updateMap).toHaveBeenCalledTimes(1);
    expect(updateMap.mock.calls[0]!.slice(0, 2)).toEqual([
      "map000000000000000001",
      "key-1",
    ]);
  });

  it("remembers each document's map and key across a reload", async () => {
    const first = fakeClient();
    await buildRemoteSaveCallback(first.client)(bytes(), A);

    const second = fakeClient();
    await buildRemoteSaveCallback(second.client)(bytes(), A);

    expect(second.createMap).not.toHaveBeenCalled();
    expect(second.updateMap.mock.calls[0]!.slice(0, 2)).toEqual([
      "map000000000000000001",
      "key-1",
    ]);
  });

  it("does not use a map id an older build kept without a key", async () => {
    const db = await openDB(DB, 1);
    await db.put("state", "legacyMapIdxxxxxxxxxx", "remoteMapId");
    await db.put("state", "legacyMapIdyyyyyyyyyy", `remoteMapId:${A}`);
    db.close();
    const { client, createMap, updateMap } = fakeClient();

    await buildRemoteSaveCallback(client)(bytes(), A);

    expect(createMap).toHaveBeenCalledTimes(1);
    expect(updateMap).not.toHaveBeenCalled();
  });

  it.each([401, 403, 404])(
    "tells the caller and makes no new map when the server refuses the old one (%i)",
    async (status) => {
      const { client, createMap, updateMap } = fakeClient();
      const save = buildRemoteSaveCallback(client);
      await save(bytes(), A);
      updateMap.mockRejectedValueOnce(
        new StorageHttpError("updateMap", status),
      );

      const refused = save(bytes(), A);

      await expect(refused).rejects.toBeInstanceOf(ServerMapRefusedError);
      await expect(refused).rejects.toMatchObject({ status });
      expect(createMap).toHaveBeenCalledTimes(1);
      expect(await serverMapRefused(A)).toBe(true);
    },
  );

  it("does not upload again to a map the server refused", async () => {
    const { client, createMap, updateMap } = fakeClient();
    const save = buildRemoteSaveCallback(client);
    await save(bytes(), A);
    updateMap.mockRejectedValueOnce(new StorageHttpError("updateMap", 403));
    await expect(save(bytes(), A)).rejects.toThrow(ServerMapRefusedError);

    await expect(save(bytes(), A)).rejects.toThrow(ServerMapRefusedError);

    // The first save created the map; the second was refused; the third
    // did not reach the server.
    expect(updateMap).toHaveBeenCalledTimes(1);
    expect(createMap).toHaveBeenCalledTimes(1);
  });

  it("makes a new server copy only when asked, and saves go to it", async () => {
    const { client, createMap, updateMap, createShareToken } = fakeClient();
    const save = buildRemoteSaveCallback(client);
    await shareDocument(client, bytes(), A, null);
    updateMap.mockRejectedValueOnce(new StorageHttpError("updateMap", 404));
    await expect(save(bytes(), A)).rejects.toThrow(ServerMapRefusedError);

    await saveAsNewServerCopy(client, bytes(), A);
    await save(bytes(), A);
    await shareDocument(client, bytes(), A, null);

    expect(createMap).toHaveBeenCalledTimes(2);
    expect(await serverMapRefused(A)).toBe(false);
    expect(updateMap.mock.lastCall!.slice(0, 2)).toEqual([
      "map000000000000000002",
      "key-2",
    ]);
    // The old lasting link reads the old map; the new copy gets its own.
    expect(createShareToken).toHaveBeenCalledTimes(2);
    expect(createShareToken.mock.lastCall![0]).toBe("map000000000000000002");
  });

  it("refuses to share a map the server refused, and makes nothing", async () => {
    const { client, createMap, updateMap, createShareToken } = fakeClient();
    await shareDocument(client, bytes(), A, null);
    updateMap.mockRejectedValueOnce(new StorageHttpError("updateMap", 403));

    await expect(shareDocument(client, bytes(), A, 7)).rejects.toThrow(
      ServerMapRefusedError,
    );

    expect(createMap).toHaveBeenCalledTimes(1);
    expect(createShareToken).toHaveBeenCalledTimes(1);
  });

  it("keeps the map when the server fails for another reason", async () => {
    const { client, createMap, updateMap } = fakeClient();
    const save = buildRemoteSaveCallback(client);
    await save(bytes(), A);
    updateMap.mockRejectedValueOnce(new StorageHttpError("updateMap", 500));

    await expect(save(bytes(), A)).rejects.toThrow(StorageHttpError);
    await save(bytes(), A);

    expect(createMap).toHaveBeenCalledTimes(1);
  });

  it("creates one map when two saves of a new document overlap", async () => {
    const { client, createMap } = fakeClient();
    const save = buildRemoteSaveCallback(client);

    await Promise.all([save(bytes(), A), save(bytes(), A)]);

    expect(createMap).toHaveBeenCalledTimes(1);
  });
});

describe("shareDocument", () => {
  it("shares the document's own server map with a lasting token", async () => {
    const { client, createMap, createShareToken } = fakeClient();
    await buildRemoteSaveCallback(client)(bytes(), A);

    const link = await shareDocument(client, bytes(), A, null);

    expect(createMap).toHaveBeenCalledTimes(1);
    expect(createShareToken).toHaveBeenCalledWith(
      "map000000000000000001",
      "key-1",
      null,
    );
    expect(link).toEqual({ token: "tok000000000000000001", expiresAt: null });
  });

  it("sharing again sends the new bytes and keeps the same link", async () => {
    const { client, updateMap, createShareToken } = fakeClient();

    const first = await shareDocument(client, bytes(), A, null);
    const second = await shareDocument(client, bytes(), A, null);

    expect(second.token).toBe(first.token);
    expect(createShareToken).toHaveBeenCalledTimes(1);
    expect(updateMap).toHaveBeenCalledTimes(1);
  });

  it("a link with an expiry is a new token", async () => {
    const { client, createShareToken } = fakeClient();

    const lasting = await shareDocument(client, bytes(), A, null);
    const week = await shareDocument(client, bytes(), A, 7);

    expect(week.token).not.toBe(lasting.token);
    expect(week.expiresAt).not.toBeNull();
    expect(createShareToken).toHaveBeenLastCalledWith(
      "map000000000000000001",
      "key-1",
      7,
    );
  });

  it("after a revoke, the next share mints a new token", async () => {
    const { client, revokeShareToken } = fakeClient();
    const first = await shareDocument(client, bytes(), A, null);

    await revokeShare(client, A, first.token);
    const second = await shareDocument(client, bytes(), A, null);

    expect(revokeShareToken).toHaveBeenCalledWith(
      "map000000000000000001",
      "key-1",
      first.token,
    );
    expect(second.token).not.toBe(first.token);
  });
});

describe("restoreFromServer", () => {
  it("returns the latest bytes of the document's map", async () => {
    const { client, readMap } = fakeClient();
    await buildRemoteSaveCallback(client)(bytes(), A);

    const back = await restoreFromServer(client, A);

    expect(readMap).toHaveBeenCalledWith("map000000000000000001", "key-1");
    expect(back).toEqual(new Uint8Array([7, 7]));
  });

  it("returns null for a document with no server map", async () => {
    const { client, readMap } = fakeClient();

    expect(await restoreFromServer(client, B)).toBeNull();
    expect(readMap).not.toHaveBeenCalled();
  });
});

describe("hasServerMap", () => {
  it("is true after the first push of the document, and only for it", async () => {
    const { client } = fakeClient();
    expect(await hasServerMap(A)).toBe(false);

    await buildRemoteSaveCallback(client)(bytes(), A);

    expect(await hasServerMap(A)).toBe(true);
    expect(await hasServerMap(B)).toBe(false);
  });
});

describe("deleteServerMap", () => {
  it("deletes the document's server map with its key and forgets it", async () => {
    const f = fakeClient();
    await buildRemoteSaveCallback(f.client)(bytes(), A);
    await buildRemoteSaveCallback(f.client)(bytes(), B);

    await deleteServerMap(f.client, A);

    expect(f.deleteMap).toHaveBeenCalledWith("map000000000000000001", "key-1");
    expect(await hasServerMap(A)).toBe(false);
    expect(await hasServerMap(B)).toBe(true);
  });

  it("forgets a map the server no longer has", async () => {
    const f = fakeClient();
    await buildRemoteSaveCallback(f.client)(bytes(), A);
    f.deleteMap.mockRejectedValueOnce(new StorageHttpError("deleteMap", 404));

    await deleteServerMap(f.client, A);

    expect(await hasServerMap(A)).toBe(false);
  });

  it("keeps the key when the server fails for another reason", async () => {
    const f = fakeClient();
    await buildRemoteSaveCallback(f.client)(bytes(), A);
    f.deleteMap.mockRejectedValueOnce(new StorageHttpError("deleteMap", 500));

    await expect(deleteServerMap(f.client, A)).rejects.toThrow();

    expect(await hasServerMap(A)).toBe(true);
  });

  it("does nothing for a document with no server map", async () => {
    const f = fakeClient();
    await deleteServerMap(f.client, A);
    expect(f.deleteMap).not.toHaveBeenCalled();
  });
});
