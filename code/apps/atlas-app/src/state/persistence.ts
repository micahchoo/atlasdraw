// SPDX-License-Identifier: AGPL-3.0-only
// Atlas-app local-first persistence.
//
// Two surfaces:
//   - IndexedDB autosave (universal across all browsers — primary path)
//   - File System Access API for explicit "Save / Open" (Chromium opt-in
//     enhancement; Firefox/Safari fall through to a download anchor / file
//     input which is the *intended* path for those browsers, not a fallback)
//
// Autosave timing: a 5 s trailing-edge debounce with a 30 s ceiling (see
// `startAutoSave`). What needs a save is the editor's history's to say
// (session/history.ts#dirty); this module keeps no dirty flag of its own.

import { openDB, type IDBPDatabase } from "idb";
import {
  AtlasdrawFormatError,
  AtlasdrawWriteCache,
  CURRENT_MANIFEST_VERSION,
  read,
  write,
  type AtlasdrawDocument,
  type Camera,
} from "@atlasdraw/data";

import { safeFileName } from "../lib/safeFileName";

import { documentFromExcalidrawJson } from "./documentIO";
import {
  STORE,
  createDocumentStore,
  docKey,
  storedToBlob,
  summaryKey,
  type Conflict,
  type HeldElsewhere,
  type Lease,
  type Locks,
  type SaveResult,
  type StoredBlob,
  type StoredSummary,
} from "./documentStore";

import type { History, HistoryPosition } from "../session/history";

// ---------------------------------------------------------------------------
// IndexedDB schema
// ---------------------------------------------------------------------------

const DB_NAME = "atlasdraw-autosave";
const DB_VERSION = 1;
const DOC_PREFIX = "doc:";
/**
 * The id of the document saved or opened last in this browser. A tab keeps
 * its own copy in sessionStorage (TAB_LAST_OPENED) and reloads into that;
 * this key is only what a fresh tab opens.
 */
const KEY_LAST_OPENED = "lastOpened";
const TAB_LAST_OPENED = "atlasdraw:lastOpened";
/** The one slot an older build wrote every document into. Read, then moved. */
const KEY_LEGACY_CURRENT = "current";
/** A document's File System Access handle: `fileHandle:<manifest id>`. */
const handleKey = (id: string): string => `fileHandle:${id}`;
/** Prefix for stored copies that could not be read. Never overwritten. */
const KEY_QUARANTINE_PREFIX = "quarantine:";

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

/** One saved map, as My maps lists it. */
export interface DocumentSummary {
  readonly id: string;
  readonly title: string;
  /** ISO time of the last change to the map's content. */
  readonly updatedAt: string;
  /**
   * Written by a newer Atlasdraw, in a format this build cannot read. Kept
   * and listed, never moved aside: the newer build still opens it.
   */
  readonly needsNewerBuild?: boolean;
}

/** True when `err` says the bytes are from a newer build. */
export function isNewerBuildError(err: unknown): boolean {
  return (
    err instanceof AtlasdrawFormatError && err.code === "UNSUPPORTED_VERSION"
  );
}

function isSummary(v: unknown): v is DocumentSummary {
  const s = v as DocumentSummary | undefined;
  return (
    typeof s === "object" &&
    s !== null &&
    typeof s.id === "string" &&
    typeof s.title === "string" &&
    typeof s.updatedAt === "string"
  );
}

export interface PersistenceStore {
  /**
   * Serialize doc into its own IndexedDB slot (by manifest id) and make it
   * the one a reload opens. A Conflict, and
   * no write, when the slot holds a newer copy (DocumentStore.save): the
   * caller asks the user, then saves with `over` the stored revision to
   * replace it, or saves a copy under a new id. The server gets only what
   * was saved here.
   */
  save(
    doc: AtlasdrawDocument,
    options?: { over?: number },
  ): Promise<SaveResult>;
  /** Hold the map for this tab (DocumentStore.claim). */
  claim(
    id: string,
    options?: { steal?: boolean },
  ): Promise<Lease | HeldElsewhere>;
  /**
   * Read the document this tab had open, or for a fresh tab the one saved
   * last in this browser; null on an empty DB.
   */
  load(): Promise<AtlasdrawDocument | null>;
  /** Every saved document, the last changed first. Unreadable ones are left out. */
  list(): Promise<DocumentSummary[]>;
  /**
   * Read one saved document and make it the one a reload opens; null when
   * there is none with that id. An unreadable copy is moved aside, as load().
   */
  open(id: string): Promise<AtlasdrawDocument | null>;
  /** Delete a saved document, after any save of it that is in progress. */
  remove(id: string): Promise<void>;
  /** Open a save dialog (FSA) or trigger a download anchor. */
  saveToDisk(doc: AtlasdrawDocument): Promise<void>;
  /**
   * Open an open dialog (FSA) or a file input. Null on user cancel. A bare
   * `.excalidraw` drawing comes in at `camera`, where the user is looking.
   */
  openFromDisk(camera?: Camera | null): Promise<AtlasdrawDocument | null>;
  /** True if the last remoteSave failed (IDB succeeded, server did not). */
  remoteSaveFailed(): boolean;
  /** Internal: dispose IDB connection + clear listeners (test helper). */
  close(): Promise<void>;
}

export interface CreatePersistenceStoreOptions {
  /** Override the IDB name (tests may pass a per-test name). */
  dbName?: string;
  /**
   * Optional best-effort push to the storage HTTP API, told which document
   * the bytes are. Fires AFTER the IDB write resolves. Failures set
   * `remoteSaveFailed()` to true and fire `onRemoteSaveFailed` if configured.
   */
  remoteSave?: (blob: Blob, documentId: string) => Promise<void>;
  /** Callback when remoteSave fails (IDB ok, server not). */
  onRemoteSaveFailed?: () => void;
  /** Where this tab keeps its own last-opened map; null for none. */
  tabStorage?: Pick<Storage, "getItem" | "setItem"> | null;
  /** Web Locks for one tab per map; the browser's by default. */
  locks?: Locks | null;
}

function sessionStore(): Pick<Storage, "getItem" | "setItem"> | null {
  try {
    return typeof sessionStorage === "undefined" ? null : sessionStorage;
  } catch {
    // A sandboxed frame may refuse the access itself.
    return null;
  }
}

/**
 * Build a `PersistenceStore` backed by a single IDB database.
 *
 * The store is the I/O surface. When to save (debounce, ceiling) is
 * `startAutoSave`'s; what is saved is the history's (a save marks the
 * position it read at, so an edit made during a save stays dirty).
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

  const documents = createDocumentStore(
    db,
    options.locks === undefined ? undefined : options.locks,
  );
  const tab =
    options.tabStorage === undefined ? sessionStore() : options.tabStorage;
  const rememberOpen = async (
    database: IDBPDatabase,
    id: string,
  ): Promise<void> => {
    await database.put(STORE, id, KEY_LAST_OPENED);
    try {
      tab?.setItem(TAB_LAST_OPENED, id);
    } catch {
      /* storage full or refused: the IDB key still holds it */
    }
  };
  /**
   * The slot revision each map was read or last saved at, in this tab. A map
   * not here (opened from a file, a link, new) has no base: its save is
   * compared by updatedAt.
   */
  const bases = new Map<string, number>();

  // Remote save failure tracking — set on failed remoteSave, cleared on
  // successful remoteSave. IDB is always the local source of truth; this
  // flag lets the UI surface "server out of sync".
  let _remoteSaveFailed = false;

  // Incremental-write cache: text entries whose serialized JSON is unchanged
  // since the previous write are carried over from that archive without
  // re-DEFLATE (~5× faster autosave on layer-heavy documents; measured in
  // @atlasdraw/data). Unchanged detection is string comparison, so a stale
  // or cross-document cache can only cost time, never correctness. Shared by
  // save() and saveToDisk(), which is safe because enqueueWrite serializes
  // every write.
  const writeCache = new AtlasdrawWriteCache();

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

  const save = (
    doc: AtlasdrawDocument,
    saveOptions: { over?: number } = {},
  ): Promise<SaveResult> => {
    return enqueueWrite(async () => {
      const blob = await write(doc, { cache: writeCache });
      const id = doc.manifest.id;
      const result = await documents.save(
        id,
        blob,
        saveOptions.over ?? bases.get(id) ?? null,
        {
          title: doc.manifest.title,
          updatedAt: doc.manifest.updatedAt,
          version: doc.manifest.version,
        },
      );
      if (result.kind === "conflict") {
        // Nothing written, here or on the server.
        return result;
      }
      bases.set(id, result.revision);
      const database = await db();
      await rememberOpen(database, id);
      // The older single slot held this document or an earlier one; either
      // way its content now has a slot of its own.
      await database.delete(STORE, KEY_LEGACY_CURRENT);
      // Best-effort push to the remote storage API. Sequenced AFTER the IDB
      // write so the local source of truth lands first; a failure is logged,
      // sets `remoteSaveFailed` and calls `onRemoteSaveFailed`, and the save
      // still counts as saved. The Blob is the same one we wrote locally — no re-serialize.
      if (options.remoteSave) {
        try {
          await options.remoteSave(blob, doc.manifest.id);
          _remoteSaveFailed = false;
        } catch (err) {
          _remoteSaveFailed = true;
          // eslint-disable-next-line no-console
          console.error(
            "[persistence] remoteSave failed (local IDB write succeeded)",
            err,
          );
          options.onRemoteSaveFailed?.();
        }
      }
      return result;
    });
  };

  /** Read one slot; an unreadable copy is moved aside, then the error thrown. */
  const readSlot = async (
    database: IDBPDatabase,
    key: string,
  ): Promise<AtlasdrawDocument | null> => {
    const stored = (await database.get(STORE, key)) as StoredBlob | undefined;
    if (!stored) {
      return null;
    }
    try {
      return await read(storedToBlob(stored));
    } catch (err) {
      if (isNewerBuildError(err)) {
        // Not damaged: a newer Atlasdraw wrote it. Leave it where it is.
        throw err;
      }
      // Move the unreadable copy aside before anything can save over it. A
      // later release, or a person, may still recover it.
      await database.put(
        STORE,
        stored,
        `${KEY_QUARANTINE_PREFIX}${Date.now()}`,
      );
      await database.delete(STORE, key);
      await database.delete(STORE, KEY_LAST_OPENED);
      throw err;
    }
  };

  /** Read a map's slot and note the revision it was read at. */
  const readMap = async (
    database: IDBPDatabase,
    id: string,
  ): Promise<AtlasdrawDocument | null> => {
    const revision = await documents.revision(id);
    const doc = await readSlot(database, docKey(id));
    if (doc && revision !== null) {
      bases.set(id, revision);
    }
    return doc;
  };

  const load = async (): Promise<AtlasdrawDocument | null> => {
    const database = await db();
    let ownId: string | null = null;
    try {
      ownId = tab?.getItem(TAB_LAST_OPENED) ?? null;
    } catch {
      ownId = null;
    }
    if (ownId && (await database.getKey(STORE, docKey(ownId))) !== undefined) {
      return readMap(database, ownId);
    }
    const lastId = (await database.get(STORE, KEY_LAST_OPENED)) as
      | string
      | undefined;
    return lastId
      ? readMap(database, lastId)
      : readSlot(database, KEY_LEGACY_CURRENT);
  };

  const list = async (): Promise<DocumentSummary[]> => {
    const database = await db();
    const keys = (await database.getAllKeys(STORE))
      .map(String)
      .filter((k) => k.startsWith(DOC_PREFIX));
    const summaries: DocumentSummary[] = [];
    for (const key of keys) {
      const id = key.slice(DOC_PREFIX.length);
      const summary: unknown = await database.get(STORE, summaryKey(id));
      if (isSummary(summary)) {
        const version = (summary as Partial<StoredSummary>).version;
        summaries.push({
          id: summary.id,
          title: summary.title,
          updatedAt: summary.updatedAt,
          ...(typeof version === "number" && version > CURRENT_MANIFEST_VERSION
            ? { needsNewerBuild: true }
            : {}),
        });
        continue;
      }
      // Saved by a build that wrote no summary: read the bundle once. The
      // next save of the map writes the summary.
      const stored = (await database.get(STORE, key)) as StoredBlob;
      try {
        const { manifest } = await read(storedToBlob(stored));
        summaries.push({
          id: manifest.id,
          title: manifest.title,
          updatedAt: manifest.updatedAt,
        });
      } catch (err) {
        if (isNewerBuildError(err)) {
          summaries.push({
            id,
            title: id,
            updatedAt: "",
            needsNewerBuild: true,
          });
        }
        // Otherwise not listed. open() and load() are where a bad copy is
        // moved aside.
      }
    }
    return summaries.sort((a, b) =>
      a.updatedAt < b.updatedAt ? 1 : a.updatedAt > b.updatedAt ? -1 : 0,
    );
  };

  const open = async (id: string): Promise<AtlasdrawDocument | null> => {
    const database = await db();
    const doc = await readMap(database, id);
    if (doc) {
      await rememberOpen(database, id);
    }
    return doc;
  };

  const remove = (id: string): Promise<void> =>
    enqueueWrite(async () => {
      const database = await db();
      await database.delete(STORE, docKey(id));
      await database.delete(STORE, summaryKey(id));
      await database.delete(STORE, handleKey(id));
      handles.delete(id);
      bases.delete(id);
      if ((await database.get(STORE, KEY_LAST_OPENED)) === id) {
        await database.delete(STORE, KEY_LAST_OPENED);
      }
    });

  // ----- File System Access API path -------------------------------------

  const fsaWindow = (): FSAWindow | null =>
    typeof window === "undefined" ? null : (window as FSAWindow);

  const hasFSA = (): boolean => {
    const w = fsaWindow();
    return !!w && typeof w.showSaveFilePicker === "function";
  };

  // A document's file handle, by manifest id. A handle belongs to one
  // document: a document opened from .excalidraw, or any other document,
  // never reuses another's file, so Save cannot write over it unasked.
  // Held in memory and, where the browser can store it, in IDB.
  const handles = new Map<string, FSAFileHandle>();

  const getStoredFileHandle = async (
    documentId: string,
  ): Promise<FSAFileHandle | undefined> => {
    const held = handles.get(documentId);
    if (held) {
      return held;
    }
    const database = await db();
    return (await database.get(STORE, handleKey(documentId))) as
      | FSAFileHandle
      | undefined;
  };

  const setStoredFileHandle = async (
    documentId: string,
    handle: FSAFileHandle,
  ): Promise<void> => {
    handles.set(documentId, handle);
    // Best-effort: keeping the handle only skips the next picker. If IDB
    // rejects it (private mode, quota), the save must still run.
    try {
      const database = await db();
      await database.put(STORE, handle, handleKey(documentId));
    } catch (err) {
      // eslint-disable-next-line no-console
      console.warn("[persistence] could not retain file handle", err);
    }
  };

  const fallbackDownload = (blob: Blob, fileName: string): void => {
    if (typeof document === "undefined") {
      return;
    } // SSR/Node — no-op.
    const url = URL.createObjectURL(blob);
    const a = document.createElement("a");
    a.href = url;
    a.download = fileName;
    a.style.display = "none";
    document.body.appendChild(a);
    a.click();
    document.body.removeChild(a);
    URL.revokeObjectURL(url);
  };

  const fallbackOpen = (): Promise<Blob | null> => {
    if (typeof document === "undefined") {
      return Promise.resolve(null);
    }
    return new Promise((resolve) => {
      const input = document.createElement("input");
      input.type = "file";
      input.accept = ".atlasdraw,.excalidraw";
      input.style.display = "none";
      let settled = false;
      const settle = (val: Blob | null): void => {
        if (settled) {
          return;
        }
        settled = true;
        if (input.parentNode) {
          input.parentNode.removeChild(input);
        }
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
      const blob = await write(doc, { cache: writeCache });
      // The document names its own file: the title arrives on the doc, so
      // this module stays framework-free.
      const suggestedName = `${safeFileName(doc.manifest.title)}.atlasdraw`;
      const w = fsaWindow();
      if (hasFSA() && w && w.showSaveFilePicker) {
        let handle = await getStoredFileHandle(doc.manifest.id);
        if (!handle) {
          handle = await w.showSaveFilePicker({
            suggestedName,
            types: [
              {
                description: "Atlasdraw document",
                accept: { "application/vnd.atlasdraw+zip": [".atlasdraw"] },
              },
            ],
          });
          await setStoredFileHandle(doc.manifest.id, handle);
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
      fallbackDownload(blob, suggestedName);
    });
  };

  const openFromDisk = async (
    camera: Camera | null = null,
  ): Promise<AtlasdrawDocument | null> => {
    const w = fsaWindow();
    let blob: Blob | null = null;
    let fileName = "";
    let openedHandle: FSAFileHandle | null = null;
    if (hasFSA() && w && w.showOpenFilePicker) {
      try {
        const [handle] = await w.showOpenFilePicker({
          multiple: false,
          types: [
            {
              description: "Atlasdraw document",
              accept: { "application/vnd.atlasdraw+zip": [".atlasdraw"] },
            },
            {
              description: "Excalidraw drawing (import)",
              accept: { "application/json": [".excalidraw"] },
            },
          ],
        });
        const file = await handle.getFile();
        blob = file;
        fileName = file.name;
        openedHandle = handle;
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
      fileName = blob instanceof File ? blob.name : "";
    }
    if (!blob) {
      return null;
    }
    // An import from .excalidraw is a new document with a new id, so it has
    // no handle: Save asks for a .atlasdraw file and never writes zip bytes
    // over the source drawing.
    if (fileName.toLowerCase().endsWith(".excalidraw")) {
      return documentFromExcalidrawJson(await blob.text(), camera);
    }
    const doc = await read(blob);
    // A file is not the slot: its first save is compared by updatedAt, so an
    // older file of the same map cannot replace the newer browser copy.
    bases.delete(doc.manifest.id);
    if (openedHandle) {
      await setStoredFileHandle(doc.manifest.id, openedHandle);
    }
    return doc;
  };

  const remoteSaveFailed = (): boolean => _remoteSaveFailed;

  const close = async (): Promise<void> => {
    _remoteSaveFailed = false;
    if (dbPromise) {
      const database = await dbPromise;
      database.close();
      dbPromise = null;
    }
  };

  return {
    save,
    claim: (id, claimOptions) => documents.claim(id, claimOptions),
    load,
    list,
    open,
    remove,
    saveToDisk,
    openFromDisk,
    remoteSaveFailed,
    close,
  };
}

// ---------------------------------------------------------------------------
// Auto-save pump
// ---------------------------------------------------------------------------

/** A save the autosave made: what it wrote, and the history position read. */
export interface AutoSaved {
  readonly result: SaveResult;
  readonly doc: AtlasdrawDocument;
  readonly at: HistoryPosition;
}

export interface AutoSave {
  /**
   * Save the document now, dirty or not, past the delay. On success the
   * history is saved at the position read before the document was. Null
   * when there is nothing to save here (`getDoc` gave null).
   */
  saveNow(): Promise<AutoSaved> | null;
  /** Clear the timers and stop following the history. */
  stop(): void;
}

export interface AutoSaveOptions {
  /** Trailing-edge debounce after the last edit. */
  intervalMs?: number;
  /** The longest an edit waits while edits keep coming. */
  maxFlushMs?: number;
  onSaved?: () => void;
  onSaveError?: (err: unknown) => void;
  /** The slot held a newer copy; nothing was written. */
  onConflict?: (
    conflict: Conflict,
    doc: AtlasdrawDocument,
    at: HistoryPosition,
  ) => void;
}

/**
 * Save the document when the history says it changed.
 *
 *   - Trailing-edge debounce: every move of the history's position resets
 *     a timer; the save runs `intervalMs` after the last one.
 *   - Ceiling: the first move since the last save starts a second timer
 *     that edits do not reset, so a burst of edits cannot hold a save off
 *     for longer than `maxFlushMs`.
 *   - A move back to the saved position (undo to it) cancels both: there is
 *     nothing to save.
 *
 * The history position is read before the document, and a save marks the
 * history saved at that position, so an edit made while a save is written
 * stays dirty. A document `getDoc` does not give (a room's: the relay
 * keeps it) is not saved, and the history stays dirty.
 */
export function startAutoSave(
  store: PersistenceStore,
  history: History,
  /** The document to save; null when there is nothing to save here. */
  getDoc: () => AtlasdrawDocument | null,
  options: AutoSaveOptions = {},
): AutoSave {
  const {
    intervalMs = 5000,
    maxFlushMs = 30000,
    onSaved,
    onSaveError,
    onConflict,
  } = options;
  let debounceTimer: ReturnType<typeof setTimeout> | null = null;
  let ceilingTimer: ReturnType<typeof setTimeout> | null = null;
  let lastPosition = history.position;

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

  const saveNow = (): Promise<AutoSaved> | null => {
    clearTimers();
    const at = history.position;
    const doc = getDoc();
    if (!doc) {
      return null;
    }
    // The store's write chain serializes writes. The history is marked only
    // after the IDB write commits: "saved" before durability is dishonest.
    return store.save(doc).then((result) => {
      if (result.kind === "saved") {
        history.markSaved(at);
      }
      return { result, doc, at };
    });
  };

  const flush = (): void => {
    if (!history.dirty) {
      clearTimers();
      return;
    }
    void saveNow()
      ?.then(({ result, doc, at }) =>
        result.kind === "saved" ? onSaved?.() : onConflict?.(result, doc, at),
      )
      .catch((err) => {
        // eslint-disable-next-line no-console
        console.error("[persistence] auto-save failed", err);
        onSaveError?.(err);
      });
  };

  const unsubscribe = history.subscribe(() => {
    const position = history.position;
    if (position === lastPosition) {
      // A save, or a step that changed nothing (a selection).
      return;
    }
    lastPosition = position;
    if (!history.dirty) {
      clearTimers();
      return;
    }
    if (debounceTimer !== null) {
      clearTimeout(debounceTimer);
    }
    debounceTimer = setTimeout(flush, intervalMs);
    if (ceilingTimer === null) {
      ceilingTimer = setTimeout(flush, maxFlushMs);
    }
  });

  return {
    saveNow,
    stop: () => {
      clearTimers();
      unsubscribe();
    },
  };
}
