// SPDX-License-Identifier: AGPL-3.0-only
//
// The DocumentStore: the maps saved in this browser, one slot per map, and
// the two rules that keep a slot honest.
//
//   save(id, bytes, baseRevision, meta)  Saved | Conflict
//       Writes `doc:<id>` and its summary in one transaction, unless the
//       stored copy is newer than the one being saved. "Newer" is the
//       stored revision above `baseRevision` (the revision this copy was
//       read at), or, for a copy not read from the slot (a file, a link),
//       a stored updatedAt after the copy's own.
//   claim(id)                            Lease | HeldElsewhere
//       One Web Lock per map, so one tab edits a map. `steal` takes it from
//       the other tab, whose lease is then `lost`.
//
// The store decides; it never asks. The editor asks only when it gets a
// Conflict or a HeldElsewhere back (hooks/usePersistenceWiring.ts).

import type { IDBPDatabase } from "idb";

export const STORE = "state";
/** Each document's bytes live under `doc:<manifest id>`. */
export const docKey = (id: string): string => `doc:${id}`;
/**
 * What My maps shows of each document, written beside its bytes on every
 * save so the list never decodes a bundle: `summary:<manifest id>`.
 */
export const summaryKey = (id: string): string => `summary:${id}`;

// Some IndexedDB implementations (notably the polyfill that backs Node test
// environments) cannot structured-clone a Blob without a working
// URL.createObjectURL. We round-trip via {bytes, type}: ArrayBuffers and
// typed arrays are universally cloneable.
export interface StoredBlob {
  readonly bytes: Uint8Array;
  readonly type: string;
}

// `Blob.prototype.arrayBuffer` is universal in real browsers since 2018, but
// jsdom 22 (the test environment) ships a stub Blob without it. FileReader
// is present in both, so we use it as a portable fallback.
const blobToBytes = (blob: Blob): Promise<Uint8Array> => {
  if (
    typeof (blob as { arrayBuffer?: () => Promise<ArrayBuffer> })
      .arrayBuffer === "function"
  ) {
    return blob.arrayBuffer().then((buf) => new Uint8Array(buf));
  }
  return new Promise((resolve, reject) => {
    const reader = new FileReader();
    reader.onload = () => {
      const result = reader.result;
      if (result instanceof ArrayBuffer) {
        resolve(new Uint8Array(result));
      } else {
        reject(new Error("FileReader returned non-ArrayBuffer result"));
      }
    };
    reader.onerror = () =>
      reject(reader.error ?? new Error("FileReader failed"));
    reader.readAsArrayBuffer(blob);
  });
};

export const blobToStored = async (blob: Blob): Promise<StoredBlob> => {
  const bytes = await blobToBytes(blob);
  return { bytes, type: blob.type };
};

export const storedToBlob = (stored: StoredBlob): Blob => {
  const blob = new Blob([stored.bytes as unknown as BlobPart], {
    type: stored.type,
  });
  // jsdom 22's Blob lacks `.arrayBuffer()`. Downstream consumers (notably
  // `@atlasdraw/data`'s `read()`) call it. We own these bytes, so attach a
  // working method when the env's Blob doesn't ship one. No-op in real
  // browsers / Node, where arrayBuffer is native.
  if (
    typeof (blob as { arrayBuffer?: () => Promise<ArrayBuffer> })
      .arrayBuffer !== "function"
  ) {
    Object.defineProperty(blob, "arrayBuffer", {
      value: async () => {
        const copy = new Uint8Array(stored.bytes);
        return copy.buffer;
      },
      writable: true,
      configurable: true,
    });
  }
  return blob;
};

/** What a save records beside the bytes, from the document's manifest. */
export interface SlotMeta {
  readonly title: string;
  /** ISO time of the last change to the map's content. */
  readonly updatedAt: string;
  /** The manifest version the bytes were written in. */
  readonly version: number;
}

/** The summary record: SlotMeta, the id, and the slot's revision. */
export interface StoredSummary extends SlotMeta {
  readonly id: string;
  /** Rises by one with each save of the slot. Older builds wrote none: 0. */
  readonly revision?: number;
}

export type Saved = { kind: "saved"; revision: number };
export type Conflict = {
  kind: "conflict";
  /** The newer copy that is in the slot, and stays there. */
  stored: { revision: number; updatedAt: string };
};
export type SaveResult = Saved | Conflict;

export type Lease = {
  kind: "lease";
  id: string;
  /** Let the map go: the editor closed it or opened another. */
  release(): void;
  /** Resolves when another tab took the map over. */
  lost: Promise<void>;
};
export type HeldElsewhere = { kind: "held-elsewhere"; id: string };

/** The part of the Web Locks API the store uses. */
export interface Locks {
  request(
    name: string,
    options: { ifAvailable?: boolean; steal?: boolean },
    callback: (lock: { name: string } | null) => unknown,
  ): Promise<unknown>;
}

export interface DocumentStore {
  save(
    id: string,
    bytes: Blob,
    baseRevision: number | null,
    meta: SlotMeta,
  ): Promise<SaveResult>;
  /** The slot's revision; null when the map has no slot. */
  revision(id: string): Promise<number | null>;
  claim(
    id: string,
    options?: { steal?: boolean },
  ): Promise<Lease | HeldElsewhere>;
}

/** The browser's Web Locks, or null where there are none. */
export function browserLocks(): Locks | null {
  return typeof navigator !== "undefined" && navigator.locks
    ? (navigator.locks as unknown as Locks)
    : null;
}

const lockName = (id: string): string => `atlasdraw:map:${id}`;

export function createDocumentStore(
  db: () => Promise<IDBPDatabase>,
  locks: Locks | null = browserLocks(),
): DocumentStore {
  const save = async (
    id: string,
    bytes: Blob,
    baseRevision: number | null,
    meta: SlotMeta,
  ): Promise<SaveResult> => {
    // Outside the transaction: IndexedDB commits a transaction that waits
    // on anything but its own requests.
    const stored = await blobToStored(bytes);
    const database = await db();
    const tx = database.transaction(STORE, "readwrite");
    const summary = (await tx.store.get(summaryKey(id))) as
      | StoredSummary
      | undefined;
    const hasSlot = (await tx.store.getKey(docKey(id))) !== undefined;
    const storedRevision = hasSlot ? summary?.revision ?? 0 : null;
    if (storedRevision !== null) {
      const newer =
        baseRevision === null
          ? summary !== undefined && summary.updatedAt > meta.updatedAt
          : storedRevision > baseRevision;
      if (newer) {
        tx.abort();
        await tx.done.catch(() => undefined);
        return {
          kind: "conflict",
          stored: {
            revision: storedRevision,
            updatedAt: summary?.updatedAt ?? "",
          },
        };
      }
    }
    const revision = (storedRevision ?? 0) + 1;
    const next: StoredSummary = { id, ...meta, revision };
    await tx.store.put(stored, docKey(id));
    await tx.store.put(next, summaryKey(id));
    await tx.done;
    return { kind: "saved", revision };
  };

  const revision = async (id: string): Promise<number | null> => {
    const database = await db();
    if ((await database.getKey(STORE, docKey(id))) === undefined) {
      return null;
    }
    const summary = (await database.get(STORE, summaryKey(id))) as
      | StoredSummary
      | undefined;
    return summary?.revision ?? 0;
  };

  const claim = (
    id: string,
    options: { steal?: boolean } = {},
  ): Promise<Lease | HeldElsewhere> => {
    if (!locks) {
      // No Web Locks (an old browser): every tab may edit, as before.
      return Promise.resolve({
        kind: "lease",
        id,
        release: () => {},
        lost: new Promise<void>(() => {}),
      });
    }
    return new Promise((resolve) => {
      let markLost: () => void = () => {};
      const lost = new Promise<void>((r) => {
        markLost = r;
      });
      const request = locks.request(
        lockName(id),
        options.steal ? { steal: true } : { ifAvailable: true },
        (lock) => {
          if (!lock) {
            resolve({ kind: "held-elsewhere", id });
            return undefined;
          }
          // The lock is held until this promise settles: until release().
          return new Promise<void>((release) => {
            resolve({ kind: "lease", id, release: () => release(), lost });
          });
        },
      );
      // A stolen lock rejects the holder's request.
      request.catch(() => markLost());
    });
  };

  return { save, revision, claim };
}
