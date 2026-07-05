// SPDX-License-Identifier: AGPL-3.0-only
//
// T13 — remoteSave callback factory.
//
// Translates a `(blob: Blob) => Promise<void>` into HTTP calls against the
// storage server. Holds an in-memory `mapId` ref (lazy-minted by the first
// save) and persists it to the same IndexedDB the PersistenceStore uses
// (db `atlasdraw-autosave`, store `state`, key `remoteMapId`) so reloads
// target the same map.
//
// Extracted from MapEditor.tsx (DEADWOOD.md god-module split, Cut 3) as part
// of usePersistenceWiring's module-scope dependencies.

import { openDB } from "idb";

import type { StorageClient } from "../services/createHttpStorageClient";

const REMOTE_DB_NAME = "atlasdraw-autosave";
const REMOTE_DB_VERSION = 1;
const REMOTE_STORE = "state";
const KEY_REMOTE_MAP_ID = "remoteMapId";

const remoteIdDbPromise = (): Promise<import("idb").IDBPDatabase> =>
  openDB(REMOTE_DB_NAME, REMOTE_DB_VERSION, {
    upgrade(database) {
      if (!database.objectStoreNames.contains(REMOTE_STORE)) {
        database.createObjectStore(REMOTE_STORE);
      }
    },
  });

export function buildRemoteSaveCallback(
  client: StorageClient,
): (blob: Blob) => Promise<void> {
  // mapId loads asynchronously from IDB on first call; until then we treat
  // it as "unknown" and wait. The `idLoad` promise resolves exactly once.
  let mapId: string | null = null;
  let idLoaded = false;
  const idLoad: Promise<void> = (async () => {
    try {
      const db = await remoteIdDbPromise();
      const stored = (await db.get(REMOTE_STORE, KEY_REMOTE_MAP_ID)) as
        | string
        | undefined;
      if (stored && /^[A-Za-z0-9_-]{21}$/.test(stored)) {
        mapId = stored;
      }
    } catch (err) {
      // IDB unavailable (private mode / quota) — we'll mint a fresh id per
      // session. Observably lossy but never throws.
      // eslint-disable-next-line no-console
      console.warn("[atlasdraw] remoteSave id-load failed", err);
    } finally {
      idLoaded = true;
    }
  })();

  return async (blob: Blob): Promise<void> => {
    if (!idLoaded) {
      await idLoad;
    }
    if (mapId === null) {
      const record = await client.createMap(blob);
      mapId = record.id;
      try {
        const db = await remoteIdDbPromise();
        await db.put(REMOTE_STORE, mapId, KEY_REMOTE_MAP_ID);
      } catch (err) {
        // eslint-disable-next-line no-console
        console.warn("[atlasdraw] remoteSave id-persist failed", err);
      }
    } else {
      await client.updateMap(mapId, blob);
    }
  };
}
