// SPDX-License-Identifier: AGPL-3.0-only
//
// One server map per document, and the write key that opens it.
//
// The first push of a document creates its server map (POST /maps) and keeps
// the map id and write key; later pushes update it (PUT /maps/:id). The
// autosave, the share link and the restore all reach this one map, so a save
// updates every link and embed made from the document.
//
// Kept in the IndexedDB the PersistenceStore uses (db `atlasdraw-autosave`,
// store `state`, key `remoteMap:<document id>`). The write key is the only
// write capability for the map (ADR-0017): a script on this origin can read
// it, a share link holder cannot. An older build kept bare map ids under
// `remoteMapId` and `remoteMapId:<document id>`; they have no key, so they are
// deleted and the document gets a new map.

import { openDB } from "idb";

import { StorageHttpError } from "../services/createHttpStorageClient";

import type {
  ShareLinkToken,
  StorageClient,
} from "../services/createHttpStorageClient";

const REMOTE_DB_NAME = "atlasdraw-autosave";
const REMOTE_DB_VERSION = 1;
const REMOTE_STORE = "state";
const remoteKey = (documentId: string): string => `remoteMap:${documentId}`;
const LEGACY_KEYS = (documentId: string): string[] => [
  "remoteMapId",
  `remoteMapId:${documentId}`,
];
const MAP_ID = /^[A-Za-z0-9_-]{21}$/;

/** What this browser holds for one document's server map. */
interface RemoteMap {
  mapId: string;
  writeKey: string;
  /** The lasting link last made for the document, reused by the next share. */
  share?: ShareLinkToken;
}

/** The server refused the map: it is gone, or the key no longer opens it. */
function refused(err: unknown): boolean {
  return (
    err instanceof StorageHttpError && [401, 403, 404].includes(err.status)
  );
}

function isRemoteMap(v: unknown): v is RemoteMap {
  const r = v as RemoteMap | undefined;
  return (
    typeof r === "object" &&
    r !== null &&
    typeof r.mapId === "string" &&
    MAP_ID.test(r.mapId) &&
    typeof r.writeKey === "string" &&
    r.writeKey.length > 0
  );
}

const remoteDb = (): Promise<import("idb").IDBPDatabase> =>
  openDB(REMOTE_DB_NAME, REMOTE_DB_VERSION, {
    upgrade(database) {
      if (!database.objectStoreNames.contains(REMOTE_STORE)) {
        database.createObjectStore(REMOTE_STORE);
      }
    },
  });

async function load(documentId: string): Promise<RemoteMap | null> {
  try {
    const db = await remoteDb();
    try {
      const v: unknown = await db.get(REMOTE_STORE, remoteKey(documentId));
      return isRemoteMap(v) ? v : null;
    } finally {
      db.close();
    }
  } catch (err) {
    // IDB unavailable (private mode, quota): a new server map per session.
    // eslint-disable-next-line no-console
    console.warn("[atlasdraw] remote map load failed", err);
    return null;
  }
}

async function store(documentId: string, entry: RemoteMap): Promise<void> {
  try {
    const db = await remoteDb();
    try {
      await db.put(REMOTE_STORE, entry, remoteKey(documentId));
      for (const legacy of LEGACY_KEYS(documentId)) {
        await db.delete(REMOTE_STORE, legacy);
      }
    } finally {
      db.close();
    }
  } catch (err) {
    // eslint-disable-next-line no-console
    console.warn("[atlasdraw] remote map store failed", err);
  }
}

// One step at a time per document: two overlapping first saves would
// otherwise both find no map and create two.
const queues = new Map<string, Promise<unknown>>();

function serial<T>(documentId: string, step: () => Promise<T>): Promise<T> {
  const prev = queues.get(documentId) ?? Promise.resolve();
  const next = prev.then(step, step);
  queues.set(
    documentId,
    next.catch(() => undefined),
  );
  return next;
}

/** Sends the bytes to the document's server map, creating it if needed. */
async function push(
  client: StorageClient,
  bytes: Blob | Uint8Array,
  documentId: string,
): Promise<RemoteMap> {
  const known = await load(documentId);
  if (known) {
    try {
      await client.updateMap(known.mapId, known.writeKey, bytes);
      return known;
    } catch (err) {
      if (!refused(err)) {
        throw err;
      }
    }
  }
  const created = await client.createMap(bytes);
  const entry = { mapId: created.map.id, writeKey: created.writeKey };
  await store(documentId, entry);
  return entry;
}

/** The autosave's remote step: push the document to its server map. */
export function buildRemoteSaveCallback(
  client: StorageClient,
): (blob: Blob, documentId: string) => Promise<void> {
  return async (blob, documentId) => {
    await serial(documentId, () => push(client, blob, documentId));
  };
}

/**
 * Push the document, then give a read link to its server map. A lasting link
 * (`expiresInDays` null) is made once per document and reused, so sharing
 * again updates the same URL. A link with an expiry is always a new token.
 */
export function shareDocument(
  client: StorageClient,
  bytes: Blob | Uint8Array,
  documentId: string,
  expiresInDays: number | null,
): Promise<ShareLinkToken> {
  return serial(documentId, async () => {
    const entry = await push(client, bytes, documentId);
    if (expiresInDays === null && entry.share?.expiresAt === null) {
      return entry.share;
    }
    const share = await client.createShareToken(
      entry.mapId,
      entry.writeKey,
      expiresInDays,
    );
    if (expiresInDays === null) {
      await store(documentId, { ...entry, share });
    }
    return share;
  });
}

/** End a read link made from the document. */
export function revokeShare(
  client: StorageClient,
  documentId: string,
  token: string,
): Promise<void> {
  return serial(documentId, async () => {
    const entry = await load(documentId);
    if (!entry) {
      return;
    }
    await client.revokeShareToken(entry.mapId, entry.writeKey, token);
    if (entry.share?.token === token) {
      await store(documentId, { mapId: entry.mapId, writeKey: entry.writeKey });
    }
  });
}

/** True when this browser holds a server map for the document. */
export async function hasServerMap(documentId: string): Promise<boolean> {
  return (await load(documentId)) !== null;
}

/**
 * The document's bytes as the server last saved them, or null when this
 * browser holds no server map for it.
 */
export function restoreFromServer(
  client: StorageClient,
  documentId: string,
): Promise<Uint8Array | null> {
  return serial(documentId, async () => {
    const entry = await load(documentId);
    if (!entry) {
      return null;
    }
    return new Uint8Array(await client.readMap(entry.mapId, entry.writeKey));
  });
}
