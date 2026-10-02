// SPDX-License-Identifier: AGPL-3.0-only
//
// One server map per document, and the write key that opens it.
//
// The first push of a document creates its server map (POST /maps) and keeps
// the map id and write key; later pushes update it (PUT /maps/:id). The
// autosave, the share link and the server versions all reach this one map,
// so a save updates every link and embed made from the document.
//
// Kept in the IndexedDB the PersistenceStore uses (db `atlasdraw-autosave`,
// store `state`, key `remoteMap:<document id>`). The write key is the only
// write capability for the map
// (docs/architecture/adr/0017-maps-carry-a-write-key.md): a script on this origin can read
// it, a share link holder cannot. An older build kept bare map ids under
// `remoteMapId` and `remoteMapId:<document id>`; they have no key, so they are
// deleted and the document gets a new map.
//
// Each push names the revision this browser last saw (If-Match,
// docs/architecture/adr/0020-server-version-history.md). A map kept before
// revisions has none: its first push does not check, and asks the server to
// keep what it replaces as a version, so nothing is lost.
//
// Nothing makes a new map, or writes over another browser's save, by
// itself. When the server refuses the map (401, 403, 404: it is gone, or the
// key no longer opens it) the save rejects with `ServerMapRefusedError`; when
// another browser saved it first (412) with `ServerMapChangedError`. The
// entry is kept and marked, and later saves reject at once without an
// upload. The owner chooses: `saveAsNewServerCopy` makes a new map, and
// `replaceServerVersion` saves over the other browser's revision, which the
// server keeps as a version.
//
// A read of this store that fails is an error, never "no map": reading it
// as "no map" made a new server map on every push.

import { openDB } from "idb";

import {
  MapChangedError,
  StorageHttpError,
} from "../services/createHttpStorageClient";

import type {
  ServerVersions,
  ShareLinkToken,
  StorageClient,
} from "../services/createHttpStorageClient";

const REMOTE_DB_NAME = "atlasdraw-autosave";
const REMOTE_DB_VERSION = 1;
const REMOTE_STORE = "state";
const REMOTE_PREFIX = "remoteMap:";
const remoteKey = (documentId: string): string =>
  `${REMOTE_PREFIX}${documentId}`;
const LEGACY_KEYS = (documentId: string): string[] => [
  "remoteMapId",
  `remoteMapId:${documentId}`,
];
const MAP_ID = /^[A-Za-z0-9_-]{21}$/;

/** What this browser holds for one document's server map. */
interface RemoteMap {
  mapId: string;
  writeKey: string;
  /** The revision this browser last saved or read. Absent: kept before revisions. */
  revision?: number;
  /** The lasting link last made for the document, reused by the next share. */
  share?: ShareLinkToken;
  /** The HTTP status with which the server last refused this map. */
  refused?: number;
  /** The newer revision another browser saved; set by a 412. */
  changed?: number;
}

/**
 * The server refused the document's map, so the save or share did not
 * happen. Links made from the map still show its last saved version. The
 * user decides: `saveAsNewServerCopy`, after which old links stay behind.
 */
export class ServerMapRefusedError extends Error {
  constructor(readonly status: number) {
    super(
      status === 404
        ? "The server no longer has this map. Your changes are saved in this browser. Links you shared show the last version the server had. Save a new server copy to go on sharing; old links will not follow it."
        : "The server no longer accepts this browser's key for this map. Your changes are saved in this browser. Links you shared show the last version the server had. Save a new server copy to go on sharing; old links will not follow it.",
    );
    this.name = "ServerMapRefusedError";
  }
}

/**
 * Another browser saved the document's map after this one last did, so the
 * save did not happen. The user decides: `replaceServerVersion` saves this
 * browser's map over it, and the server keeps the other one as a version.
 */
export class ServerMapChangedError extends Error {
  constructor(readonly revision: number) {
    super(
      "Another browser saved this map on the server. Your changes are saved in this browser, not on the server. Links you shared show the other browser's version.",
    );
    this.name = "ServerMapChangedError";
  }
}

/** The server refused the map: it is gone, or the key no longer opens it. */
function refused(err: unknown): err is StorageHttpError {
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

/** The document's entry; null when there is none. Throws when IDB fails. */
async function load(documentId: string): Promise<RemoteMap | null> {
  const db = await remoteDb();
  try {
    const v: unknown = await db.get(REMOTE_STORE, remoteKey(documentId));
    return isRemoteMap(v) ? v : null;
  } finally {
    db.close();
  }
}

/**
 * Keep the entry. A failure is logged and swallowed: the server write it
 * follows has happened, and the next push finds the map by its old entry.
 */
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

/** Makes a new server map for the document and keeps its key. */
async function create(
  client: StorageClient,
  bytes: Blob | Uint8Array,
  documentId: string,
): Promise<RemoteMap> {
  const created = await client.createMap(bytes);
  const entry = {
    mapId: created.map.id,
    writeKey: created.writeKey,
    revision: created.map.revision,
  };
  await store(documentId, entry);
  return entry;
}

/**
 * Sends the bytes to the entry's map over `ifRevision`, and keeps the
 * revision the server answers. A refusal or a 412 marks the entry and
 * rejects; nothing new is made.
 */
async function send(
  client: StorageClient,
  bytes: Blob | Uint8Array,
  documentId: string,
  known: RemoteMap,
  ifRevision: number | undefined,
  checkpoint: boolean,
): Promise<RemoteMap> {
  try {
    const saved = await client.updateMap(known.mapId, known.writeKey, bytes, {
      ifRevision,
      checkpoint,
    });
    const { changed: _resolved, ...rest } = known;
    const entry = { ...rest, revision: saved.revision };
    await store(documentId, entry);
    return entry;
  } catch (err) {
    if (err instanceof MapChangedError) {
      await store(documentId, { ...known, changed: err.revision });
      throw new ServerMapChangedError(err.revision);
    }
    if (!refused(err)) {
      throw err;
    }
    await store(documentId, { ...known, refused: err.status });
    throw new ServerMapRefusedError(err.status);
  }
}

/** The entry, if the server last took it: no refusal and no 412 pending. */
async function usable(documentId: string): Promise<RemoteMap | null> {
  const known = await load(documentId);
  if (known?.refused !== undefined) {
    throw new ServerMapRefusedError(known.refused);
  }
  if (known?.changed !== undefined) {
    throw new ServerMapChangedError(known.changed);
  }
  return known;
}

/**
 * Sends the bytes to the document's server map, creating it the first time.
 * `checkpoint`: the server keeps what this save replaces as a version.
 */
async function push(
  client: StorageClient,
  bytes: Blob | Uint8Array,
  documentId: string,
  checkpoint = false,
): Promise<RemoteMap> {
  const known = await usable(documentId);
  if (!known) {
    return create(client, bytes, documentId);
  }
  // A map kept before revisions: no check, and the server keeps its bytes.
  const unknown = known.revision === undefined;
  return send(
    client,
    bytes,
    documentId,
    known,
    known.revision,
    checkpoint || unknown,
  );
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
 * A `frozen` link is a new token that shows the revision just saved, and no
 * later one.
 */
export function shareDocument(
  client: StorageClient,
  bytes: Blob | Uint8Array,
  documentId: string,
  expiresInDays: number | null,
  options: { frozen?: boolean } = {},
): Promise<ShareLinkToken> {
  return serial(documentId, async () => {
    const entry = await push(client, bytes, documentId);
    if (options.frozen) {
      return client.createShareToken(
        entry.mapId,
        entry.writeKey,
        expiresInDays,
        entry.revision ?? null,
      );
    }
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

/**
 * The user's answer to `ServerMapRefusedError`: make a new server map for the
 * document and send the bytes there. Links made from the old map stay on its
 * last version; the next lasting share is a new link.
 */
export function saveAsNewServerCopy(
  client: StorageClient,
  bytes: Blob | Uint8Array,
  documentId: string,
): Promise<void> {
  return serial(documentId, async () => {
    await create(client, bytes, documentId);
  });
}

/**
 * The user's answer to `ServerMapChangedError`: save these bytes over the
 * other browser's revision. The server keeps that revision as a version, so
 * the owner can go back to it.
 */
export function replaceServerVersion(
  client: StorageClient,
  bytes: Blob | Uint8Array,
  documentId: string,
): Promise<void> {
  return serial(documentId, async () => {
    const known = await load(documentId);
    if (!known || known.changed === undefined) {
      return;
    }
    await send(client, bytes, documentId, known, known.changed, true);
  });
}

/** True when the server refused the document's map and no copy was made yet. */
export async function serverMapRefused(documentId: string): Promise<boolean> {
  return (await load(documentId))?.refused !== undefined;
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
      const { share: _ended, ...rest } = entry;
      await store(documentId, rest);
    }
  });
}

async function forget(documentId: string): Promise<void> {
  try {
    const db = await remoteDb();
    try {
      await db.delete(REMOTE_STORE, remoteKey(documentId));
    } finally {
      db.close();
    }
  } catch (err) {
    // eslint-disable-next-line no-console
    console.warn("[atlasdraw] remote map forget failed", err);
  }
}

/**
 * Delete the document's server map (its links and bytes go with it) and
 * forget its write key. A map the server no longer has is forgotten too.
 */
export function deleteServerMap(
  client: StorageClient,
  documentId: string,
): Promise<void> {
  return serial(documentId, async () => {
    const entry = await load(documentId);
    if (!entry) {
      return;
    }
    try {
      await client.deleteMap(entry.mapId, entry.writeKey);
    } catch (err) {
      if (!refused(err)) {
        throw err;
      }
    }
    await forget(documentId);
  });
}

/** True when this browser holds a server map for the document. */
export async function hasServerMap(documentId: string): Promise<boolean> {
  try {
    return (await load(documentId)) !== null;
  } catch (err) {
    // eslint-disable-next-line no-console
    console.warn("[atlasdraw] remote map load failed", err);
    return false;
  }
}

/** One document's server map and the key that opens it, as a backup holds it. */
export interface ServerKey {
  documentId: string;
  mapId: string;
  writeKey: string;
  revision?: number;
}

/** Every server map this browser holds a key for. */
export async function serverKeys(): Promise<ServerKey[]> {
  const db = await remoteDb();
  try {
    const keys = await db.getAllKeys(REMOTE_STORE);
    const found: ServerKey[] = [];
    for (const key of keys) {
      if (typeof key !== "string" || !key.startsWith(REMOTE_PREFIX)) {
        continue;
      }
      const entry: unknown = await db.get(REMOTE_STORE, key);
      if (isRemoteMap(entry)) {
        found.push({
          documentId: key.slice(REMOTE_PREFIX.length),
          mapId: entry.mapId,
          writeKey: entry.writeKey,
          ...(entry.revision === undefined ? {} : { revision: entry.revision }),
        });
      }
    }
    return found;
  } finally {
    db.close();
  }
}

/**
 * Keep a key from a backup, unless this browser already holds one for the
 * document: the key it holds is the one its saves use. True when kept.
 */
export function importServerKey(key: ServerKey): Promise<boolean> {
  return serial(key.documentId, async () => {
    const entry = {
      mapId: key.mapId,
      writeKey: key.writeKey,
      ...(key.revision === undefined ? {} : { revision: key.revision }),
    };
    if (!isRemoteMap(entry) || (await load(key.documentId))) {
      return false;
    }
    const db = await remoteDb();
    try {
      await db.put(REMOTE_STORE, entry, remoteKey(key.documentId));
    } finally {
      db.close();
    }
    return true;
  });
}

/**
 * The revisions the server keeps of the document's map, the current one
 * first; null when this browser holds no server map for it.
 */
export function serverVersions(
  client: StorageClient,
  documentId: string,
): Promise<ServerVersions | null> {
  return serial(documentId, async () => {
    const entry = await load(documentId);
    return entry ? client.listVersions(entry.mapId, entry.writeKey) : null;
  });
}

/**
 * The bytes of one revision of the document's map; null when this browser
 * holds no server map for it.
 */
export function readServerVersion(
  client: StorageClient,
  documentId: string,
  revision: number,
): Promise<Uint8Array | null> {
  return serial(documentId, async () => {
    const entry = await load(documentId);
    if (!entry) {
      return null;
    }
    const read = await client.readVersion(
      entry.mapId,
      entry.writeKey,
      revision,
    );
    return new Uint8Array(read.bytes);
  });
}

/**
 * Save an older version's bytes as the map's new revision. The server keeps
 * the revision it replaces, so a restore never loses the map it replaced.
 * A restore is the owner's choice, so it also answers a pending 412: it
 * saves over the other browser's revision.
 */
export function saveRestoredVersion(
  client: StorageClient,
  bytes: Blob | Uint8Array,
  documentId: string,
): Promise<void> {
  return serial(documentId, async () => {
    const known = await load(documentId);
    if (known?.changed === undefined) {
      await push(client, bytes, documentId, true);
      return;
    }
    await send(client, bytes, documentId, known, known.changed, true);
  });
}
