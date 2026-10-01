// SPDX-License-Identifier: AGPL-3.0-only
//
// The remote save: send a document's bytes to the storage server, one
// server map per document.
//
// The first save of a document creates its server map (POST /maps); later
// saves update it (PUT /maps/:id). The server map id is kept per document,
// in the IndexedDB the PersistenceStore uses (db `atlasdraw-autosave`, store
// `state`, key `remoteMapId:<document id>`), so a reload updates the same
// map. An older build kept one id for every document under `remoteMapId`;
// the first document saved without an id of its own takes that one, once.

import { openDB } from "idb";

import type { StorageClient } from "../services/createHttpStorageClient";

const REMOTE_DB_NAME = "atlasdraw-autosave";
const REMOTE_DB_VERSION = 1;
const REMOTE_STORE = "state";
const KEY_LEGACY_MAP_ID = "remoteMapId";
const mapIdKey = (documentId: string): string => `remoteMapId:${documentId}`;
const MAP_ID = /^[A-Za-z0-9_-]{21}$/;

const remoteIdDb = (): Promise<import("idb").IDBPDatabase> =>
  openDB(REMOTE_DB_NAME, REMOTE_DB_VERSION, {
    upgrade(database) {
      if (!database.objectStoreNames.contains(REMOTE_STORE)) {
        database.createObjectStore(REMOTE_STORE);
      }
    },
  });

/** The stored server map id for a document, or the legacy one (taken once). */
async function storedMapId(documentId: string): Promise<string | null> {
  try {
    const db = await remoteIdDb();
    try {
      const own = (await db.get(REMOTE_STORE, mapIdKey(documentId))) as
        | string
        | undefined;
      if (own && MAP_ID.test(own)) {
        return own;
      }
      const legacy = (await db.get(REMOTE_STORE, KEY_LEGACY_MAP_ID)) as
        | string
        | undefined;
      if (legacy && MAP_ID.test(legacy)) {
        await db.put(REMOTE_STORE, legacy, mapIdKey(documentId));
        await db.delete(REMOTE_STORE, KEY_LEGACY_MAP_ID);
        return legacy;
      }
    } finally {
      db.close();
    }
  } catch (err) {
    // IDB unavailable (private mode, quota): a new server map per session.
    // Lossy, but never throws.
    // eslint-disable-next-line no-console
    console.warn("[atlasdraw] remoteSave id-load failed", err);
  }
  return null;
}

async function storeMapId(documentId: string, mapId: string): Promise<void> {
  try {
    const db = await remoteIdDb();
    try {
      await db.put(REMOTE_STORE, mapId, mapIdKey(documentId));
    } finally {
      db.close();
    }
  } catch (err) {
    // eslint-disable-next-line no-console
    console.warn("[atlasdraw] remoteSave id-persist failed", err);
  }
}

export function buildRemoteSaveCallback(
  client: StorageClient,
): (blob: Blob, documentId: string) => Promise<void> {
  // Server map id by document id, as far as this session knows.
  const known = new Map<string, string | null>();

  return async (blob, documentId) => {
    if (!known.has(documentId)) {
      known.set(documentId, await storedMapId(documentId));
    }
    const mapId = known.get(documentId) ?? null;
    if (mapId === null) {
      const record = await client.createMap(blob);
      known.set(documentId, record.id);
      await storeMapId(documentId, record.id);
    } else {
      await client.updateMap(mapId, blob);
    }
  };
}
