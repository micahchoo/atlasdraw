// SPDX-License-Identifier: AGPL-3.0-only
// Phase 3 Wave 2 Task 8 — atlas-app local-first persistence.
//
// Two surfaces:
//   - IndexedDB autosave (universal across all browsers — primary path)
//   - File System Access API for explicit "Save / Open" (Chromium opt-in
//     enhancement; Firefox/Safari fall through to a download anchor / file
//     input which is the *intended* path for those browsers, not a fallback)
//
// The contract + behavioural invariants come from Task 8 of
// docs/superpowers/plans/2026-05-03-atlasdraw-phase-3-file-format.md and
// the Phase 3 Open Question Q3 (5s trailing-edge debounce + 30s ceiling).

import { openDB, type IDBPDatabase } from "idb";
import {
  read,
  write,
  type AtlasdrawDocument,
} from "@atlasdraw/data";

// ---------------------------------------------------------------------------
// IndexedDB schema
// ---------------------------------------------------------------------------

const DB_NAME = "atlasdraw-autosave";
const DB_VERSION = 1;
const STORE = "state";
const KEY_CURRENT = "current";
const KEY_FILE_HANDLE = "fileHandle";

// Some IndexedDB implementations (notably the polyfill that backs Node test
// environments) cannot structured-clone a Blob without a working
// URL.createObjectURL. We round-trip via {bytes, type} — ArrayBuffers and
// typed arrays are universally cloneable.
interface StoredBlob {
  readonly bytes: Uint8Array;
  readonly type: string;
}

// `Blob.prototype.arrayBuffer` is universal in real browsers since 2018, but
// jsdom 22 (the test environment) ships a stub Blob without it. FileReader
// is present in both, so we use it as a portable fallback.
const blobToBytes = (blob: Blob): Promise<Uint8Array> => {
  if (typeof (blob as { arrayBuffer?: () => Promise<ArrayBuffer> }).arrayBuffer === "function") {
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
    reader.onerror = () => reject(reader.error ?? new Error("FileReader failed"));
    reader.readAsArrayBuffer(blob);
  });
};

const blobToStored = async (blob: Blob): Promise<StoredBlob> => {
  const bytes = await blobToBytes(blob);
  return { bytes, type: blob.type };
};

const storedToBlob = (stored: StoredBlob): Blob => {
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

// File System Access API types are not in TS lib.dom for every TS target the
// monorepo touches; declare the *minimum* surface we use rather than depend on
// `@types/wicg-file-system-access` (not in package.json).
interface FSAFileHandle {
  createWritable(): Promise<{
    write(blob: Blob): Promise<void>;
    close(): Promise<void>;
  }>;
  getFile(): Promise<File>;
  readonly name?: string;
}

interface ShowSaveFilePickerOptions {
  suggestedName?: string;
  types?: ReadonlyArray<{
    description?: string;
    accept: Record<string, string[]>;
  }>;
}

interface ShowOpenFilePickerOptions extends ShowSaveFilePickerOptions {
  multiple?: boolean;
}

type ShowSaveFilePicker = (
  options?: ShowSaveFilePickerOptions,
) => Promise<FSAFileHandle>;
type ShowOpenFilePicker = (
  options?: ShowOpenFilePickerOptions,
) => Promise<FSAFileHandle[]>;

interface FSAWindow extends Window {
  showSaveFilePicker?: ShowSaveFilePicker;
  showOpenFilePicker?: ShowOpenFilePicker;
}

// ---------------------------------------------------------------------------
// Public surface
// ---------------------------------------------------------------------------

export interface PersistenceStore {
  /** Serialize doc and write to IndexedDB; clears dirty if no edits raced. */
  save(doc: AtlasdrawDocument): Promise<void>;
  /** Read last persisted doc from IndexedDB; null on empty DB. */
  load(): Promise<AtlasdrawDocument | null>;
  /** Open a save dialog (FSA) or trigger a download anchor. */
  saveToDisk(doc: AtlasdrawDocument): Promise<void>;
  /** Open an open dialog (FSA) or a file input. Null on user cancel. */
  openFromDisk(): Promise<AtlasdrawDocument | null>;
  /** Register a callback invoked when `markDirty()` fires. */
  onDirty(cb: () => void): () => void;
  /** Mark the in-memory state as ahead of the persisted state. */
  markDirty(): void;
  /** True if dirty (in-memory state diverges from last persisted). */
  isDirty(): boolean;
  /** Internal: dispose IDB connection + clear listeners (test helper). */
  close(): Promise<void>;
}

export interface CreatePersistenceStoreOptions {
  /** Override the IDB name (tests may pass a per-test name). */
  dbName?: string;
}

/**
 * Build a `PersistenceStore` backed by a single IDB database.
 *
 * The store is a thin wrapper — all the orchestration logic (debounce,
 * ceiling, snapshot race) lives in `startAutoSave`. The store itself is
 * concerned with the I/O surface and the dirty bit.
 */
export function createPersistenceStore(
  options: CreatePersistenceStoreOptions = {},
): PersistenceStore {
  const dbName = options.dbName ?? DB_NAME;

  let dbPromise: Promise<IDBPDatabase> | null = null;
  const db = (): Promise<IDBPDatabase> => {
    if (!dbPromise) {
      dbPromise = openDB(dbName, DB_VERSION, {
        upgrade(database) {
          if (!database.objectStoreNames.contains(STORE)) {
            database.createObjectStore(STORE);
          }
        },
      });
    }
    return dbPromise;
  };

  // Dirty bit + listener set.
  let dirty = false;
  const dirtyListeners = new Set<() => void>();

  // Snapshot race guard: every `markDirty` after a save begins bumps this.
  // `save()` captures the value at start; if it differs at await-resolve, the
  // save raced and dirty stays set.
  let dirtySeq = 0;

  // Single-flight write chain: disk save MUST wait for the in-flight auto-save
  // (no parallel writes to IDB+disk competing for the same doc).
  let writeChain: Promise<unknown> = Promise.resolve();
  const enqueueWrite = <T>(fn: () => Promise<T>): Promise<T> => {
    const next = writeChain.then(fn, fn);
    // Swallow rejections in the chain itself so one failure doesn't poison
    // every subsequent write — the caller still sees the rejection on `next`.
    writeChain = next.catch(() => undefined);
    return next;
  };

  const markDirty = (): void => {
    dirty = true;
    dirtySeq += 1;
    for (const cb of dirtyListeners) {
      try {
        cb();
      } catch {
        /* listeners must not break the producer */
      }
    }
  };

  const save = (doc: AtlasdrawDocument): Promise<void> => {
    // Capture dirtySeq SYNCHRONOUSLY at call-time. If we deferred this into
    // the enqueueWrite microtask, any `markDirty()` issued by the caller
    // immediately after `save(doc)` (before awaiting) would land BEFORE the
    // capture and we'd never observe the race.
    const seqAtStart = dirtySeq;
    return enqueueWrite(async () => {
      const blob = await write(doc);
      const stored = await blobToStored(blob);
      const database = await db();
      await database.put(STORE, stored, KEY_CURRENT);
      // Clear dirty only if no `markDirty()` arrived during the write.
      if (dirtySeq === seqAtStart) {
        dirty = false;
      }
    });
  };

  const load = async (): Promise<AtlasdrawDocument | null> => {
    const database = await db();
    const stored = (await database.get(STORE, KEY_CURRENT)) as
      | StoredBlob
      | undefined;
    if (!stored) return null;
    return read(storedToBlob(stored));
  };

  // ----- File System Access API path -------------------------------------

  const fsaWindow = (): FSAWindow | null =>
    typeof window === "undefined" ? null : (window as FSAWindow);

  const hasFSA = (): boolean => {
    const w = fsaWindow();
    return !!w && typeof w.showSaveFilePicker === "function";
  };

  const getStoredFileHandle = async (): Promise<FSAFileHandle | undefined> => {
    const database = await db();
    return (await database.get(STORE, KEY_FILE_HANDLE)) as
      | FSAFileHandle
      | undefined;
  };

  const setStoredFileHandle = async (
    handle: FSAFileHandle | undefined,
  ): Promise<void> => {
    const database = await db();
    if (handle === undefined) {
      await database.delete(STORE, KEY_FILE_HANDLE);
    } else {
      await database.put(STORE, handle, KEY_FILE_HANDLE);
    }
  };

  const fallbackDownload = (blob: Blob): void => {
    if (typeof document === "undefined") return; // SSR/Node — no-op.
    const url = URL.createObjectURL(blob);
    const a = document.createElement("a");
    a.href = url;
    a.download = "atlasdraw.atlasdraw";
    a.style.display = "none";
    document.body.appendChild(a);
    a.click();
    document.body.removeChild(a);
    URL.revokeObjectURL(url);
  };

  const fallbackOpen = (): Promise<Blob | null> => {
    if (typeof document === "undefined") return Promise.resolve(null);
    return new Promise((resolve) => {
      const input = document.createElement("input");
      input.type = "file";
      input.accept = ".atlasdraw";
      input.style.display = "none";
      let settled = false;
      const settle = (val: Blob | null): void => {
        if (settled) return;
        settled = true;
        if (input.parentNode) input.parentNode.removeChild(input);
        resolve(val);
      };
      input.addEventListener("change", () => {
        const file = input.files?.[0] ?? null;
        settle(file);
      });
      // Some browsers fire neither change nor cancel if the user dismisses;
      // we accept that case as "no file" once the user takes any other action.
      input.addEventListener("cancel", () => settle(null));
      document.body.appendChild(input);
      input.click();
    });
  };

  const saveToDisk = async (doc: AtlasdrawDocument): Promise<void> => {
    return enqueueWrite(async () => {
      const blob = await write(doc);
      const w = fsaWindow();
      if (hasFSA() && w && w.showSaveFilePicker) {
        let handle = await getStoredFileHandle();
        if (!handle) {
          handle = await w.showSaveFilePicker({
            suggestedName: "atlasdraw.atlasdraw",
            types: [
              {
                description: "Atlasdraw document",
                accept: { "application/vnd.atlasdraw+zip": [".atlasdraw"] },
              },
            ],
          });
          await setStoredFileHandle(handle);
        }
        const writable = await handle.createWritable();
        await writable.write(blob);
        await writable.close();
        return;
      }
      // eslint-disable-next-line no-console
      console.info(
        "[persistence] File System Access API unavailable; using download/input path",
      );
      fallbackDownload(blob);
    });
  };

  const openFromDisk = async (): Promise<AtlasdrawDocument | null> => {
    const w = fsaWindow();
    let blob: Blob | null = null;
    if (hasFSA() && w && w.showOpenFilePicker) {
      try {
        const [handle] = await w.showOpenFilePicker({
          multiple: false,
          types: [
            {
              description: "Atlasdraw document",
              accept: { "application/vnd.atlasdraw+zip": [".atlasdraw"] },
            },
          ],
        });
        await setStoredFileHandle(handle);
        const file = await handle.getFile();
        blob = file;
      } catch (err) {
        // AbortError (user cancel) → null. Anything else is a real failure.
        if (
          err instanceof DOMException &&
          (err.name === "AbortError" || err.name === "NotAllowedError")
        ) {
          return null;
        }
        throw err;
      }
    } else {
      // eslint-disable-next-line no-console
      console.info(
        "[persistence] File System Access API unavailable; using download/input path",
      );
      blob = await fallbackOpen();
    }
    if (!blob) return null;
    return read(blob);
  };

  const onDirty = (cb: () => void): (() => void) => {
    dirtyListeners.add(cb);
    return () => {
      dirtyListeners.delete(cb);
    };
  };

  const isDirty = (): boolean => dirty;

  const close = async (): Promise<void> => {
    dirtyListeners.clear();
    if (dbPromise) {
      const database = await dbPromise;
      database.close();
      dbPromise = null;
    }
  };

  return {
    save,
    load,
    saveToDisk,
    openFromDisk,
    onDirty,
    markDirty,
    isDirty,
    close,
  };
}

// ---------------------------------------------------------------------------
// Auto-save pump
// ---------------------------------------------------------------------------

/**
 * Drive `store.save()` from `markDirty()` events.
 *
 * Behaviour (Q3 resolution):
 *   - Trailing-edge debounce: every `markDirty` resets a timer; flush fires
 *     `intervalMs` after the *last* edit.
 *   - Ceiling: a second timer is started on the *first* `markDirty` since the
 *     last flush and is **not reset** by subsequent edits. It forces a flush
 *     after `maxFlushMs`, so a burst of continuous edits cannot starve the
 *     debounce indefinitely.
 *   - When either fires, both timers are cleared and the next `markDirty`
 *     starts the cycle again.
 *
 * Snapshot guard at flush time: capture `getDoc()` once and compare on resolve
 * — Zustand mutates state in place but rebuilds the doc reference on each
 * commit, so identity comparison is sufficient.
 *
 * Returns a disposer that clears both timers AND unsubscribes from the dirty
 * channel. Tests must call this to avoid leaking timers.
 */
export function startAutoSave(
  store: PersistenceStore,
  getDoc: () => AtlasdrawDocument,
  intervalMs = 5000,
  maxFlushMs = 30000,
): () => void {
  let debounceTimer: ReturnType<typeof setTimeout> | null = null;
  let ceilingTimer: ReturnType<typeof setTimeout> | null = null;

  const clearTimers = (): void => {
    if (debounceTimer !== null) {
      clearTimeout(debounceTimer);
      debounceTimer = null;
    }
    if (ceilingTimer !== null) {
      clearTimeout(ceilingTimer);
      ceilingTimer = null;
    }
  };

  const flush = (): void => {
    clearTimers();
    const snapshot = getDoc();
    // Fire-and-forget: the store's internal write chain serializes writes,
    // so an in-flight save before the next flush still completes in order.
    void store.save(snapshot).catch((err) => {
      // eslint-disable-next-line no-console
      console.error("[persistence] auto-save failed", err);
    });
  };

  const unsubscribe = store.onDirty(() => {
    // Reset the trailing-edge debounce on every edit.
    if (debounceTimer !== null) clearTimeout(debounceTimer);
    debounceTimer = setTimeout(flush, intervalMs);
    // Start the ceiling timer once on the first edit since the last flush.
    if (ceilingTimer === null) {
      ceilingTimer = setTimeout(flush, maxFlushMs);
    }
  });

  return () => {
    clearTimers();
    unsubscribe();
  };
}
