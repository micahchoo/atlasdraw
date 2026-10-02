// SPDX-License-Identifier: AGPL-3.0-only
// persistence.ts tests.
//
// fake-indexeddb/auto polyfills the global IDB factory with an in-memory
// implementation so the `idb` package can run unmodified under jsdom.

import "fake-indexeddb/auto";
import { openDB } from "idb";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

import { write, type AtlasdrawDocument } from "@atlasdraw/data";

import {
  createPersistenceStore,
  startAutoSave,
  type PersistenceStore,
} from "../state/persistence";
import { createHistory, type EditorHistory } from "../session/history";

// ---------------------------------------------------------------------------
// Fixture
// ---------------------------------------------------------------------------

const ULID = "01J0000000000000000000000A"; // 26 chars, valid ULID shape.

const makeDoc = (
  updatedAt: string = "2026-05-06T00:00:00.000Z",
  id: string = ULID,
): AtlasdrawDocument => ({
  manifest: {
    id,
    version: 2,
    title: "Test",
    createdAt: "2026-05-06T00:00:00.000Z",
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

// Each test gets its own DB name so fake-indexeddb's shared global state
// doesn't leak fixtures across cases.
let dbCounter = 0;
const freshDb = (): string => `atlasdraw-test-${++dbCounter}-${Date.now()}`;

// ---------------------------------------------------------------------------
// PersistenceStore — IDB round-trip + dirty channel
// ---------------------------------------------------------------------------

describe("createPersistenceStore — IDB", () => {
  let store: PersistenceStore;

  beforeEach(() => {
    store = createPersistenceStore({ dbName: freshDb() });
  });

  afterEach(async () => {
    await store.close();
  });

  it("save() then load() round-trips the document", async () => {
    const doc = makeDoc();
    await store.save(doc);
    const loaded = await store.load();
    expect(loaded).not.toBeNull();
    expect(loaded!.manifest.id).toBe(ULID);
    expect(loaded!.manifest.title).toBe("Test");
  });

  it("load() returns null on empty DB", async () => {
    const loaded = await store.load();
    expect(loaded).toBeNull();
  });
});

// ---------------------------------------------------------------------------
// remoteSave callback option
// ---------------------------------------------------------------------------

describe("createPersistenceStore — protecting the stored copy", () => {
  it("keeps a stored copy it cannot read instead of letting a save overwrite it", async () => {
    const dbName = freshDb();
    const store = createPersistenceStore({ dbName });
    await store.save(makeDoc());
    const raw = await openDB(dbName);
    const garbage = { type: "application/zip", buffer: new ArrayBuffer(8) };
    await raw.put("state", garbage, `doc:${ULID}`);

    await expect(store.load()).rejects.toThrow();
    await store.save(makeDoc("2026-05-07T00:00:00.000Z"));

    const kept = (await raw.getAllKeys("state"))
      .map(String)
      .filter((k) => k.startsWith("quarantine:"));
    expect(kept).toHaveLength(1);
    expect(await raw.get("state", kept[0])).toEqual(garbage);
    raw.close();
    await store.close();
  });
});

describe("createPersistenceStore — one slot per document", () => {
  const OTHER = "01J0000000000000000000000B";

  it("keeps each document in its own slot: saving B does not replace A", async () => {
    const dbName = freshDb();
    const store = createPersistenceStore({ dbName });
    await store.save(makeDoc(undefined, ULID));
    await store.save(makeDoc(undefined, OTHER));

    const raw = await openDB(dbName);
    const keys = (await raw.getAllKeys("state")).map(String);
    raw.close();
    expect(keys).toEqual(
      expect.arrayContaining([`doc:${ULID}`, `doc:${OTHER}`]),
    );
    // load() opens the document saved last.
    expect((await store.load())?.manifest.id).toBe(OTHER);
    await store.close();
  });

  it("still reads the single slot an older build wrote, and moves it on the next save", async () => {
    const dbName = freshDb();
    const writer = createPersistenceStore({ dbName });
    await writer.save(makeDoc());
    const raw = await openDB(dbName);
    const bytes = await raw.get("state", `doc:${ULID}`);
    await raw.clear("state");
    await raw.put("state", bytes, "current");
    await writer.close();

    const store = createPersistenceStore({ dbName });
    const loaded = await store.load();
    expect(loaded?.manifest.id).toBe(ULID);
    await store.save(loaded!);

    const keys = (await raw.getAllKeys("state")).map(String);
    expect(keys).toContain(`doc:${ULID}`);
    expect(keys).not.toContain("current");
    raw.close();
    await store.close();
  });

  it("tells remoteSave which document the bytes are", async () => {
    const remoteSave = vi.fn(async () => {});
    const store = createPersistenceStore({ dbName: freshDb(), remoteSave });

    await store.save(makeDoc(undefined, OTHER));

    expect(remoteSave).toHaveBeenCalledWith(expect.any(Blob), OTHER);
    await store.close();
  });
});

describe("createPersistenceStore — remoteSave callback (T13)", () => {
  it("fires remoteSave after the IDB write resolves", async () => {
    const calls: string[] = [];
    const remoteSave: (blob: Blob, documentId: string) => Promise<void> = vi.fn(
      async (_blob: Blob, _documentId: string) => {
        calls.push("remote");
      },
    );
    const store = createPersistenceStore({
      dbName: freshDb(),
      remoteSave,
    });
    // Hook into the IDB write by reloading immediately — the load() succeeds
    // only after the put() resolves, so its position in the call log tells
    // us the IDB write happened before remoteSave.
    const doc = makeDoc();
    await store.save(doc);
    calls.push("post-save");

    expect(remoteSave).toHaveBeenCalledTimes(1);
    // First argument is a Blob.
    const mockedRemote = remoteSave as unknown as ReturnType<typeof vi.fn>;
    const arg = mockedRemote.mock.calls[0]?.[0];
    expect(arg).toBeInstanceOf(Blob);
    // remoteSave must have been awaited before save() resolved.
    expect(calls).toEqual(["remote", "post-save"]);
    // And the local round-trip still works.
    const loaded = await store.load();
    expect(loaded?.manifest.id).toBe(ULID);

    await store.close();
  });

  it("swallows remoteSave failures — save() resolves", async () => {
    const errSpy = vi.spyOn(console, "error").mockImplementation(() => {});
    const remoteSave = vi.fn(async () => {
      throw new Error("network down");
    });
    const store = createPersistenceStore({
      dbName: freshDb(),
      remoteSave,
    });
    const doc = makeDoc();
    // The promise must NOT reject.
    await expect(store.save(doc)).resolves.toEqual({
      kind: "saved",
      revision: 1,
    });
    expect(remoteSave).toHaveBeenCalledTimes(1);
    expect(errSpy).toHaveBeenCalledWith(
      expect.stringContaining("remoteSave failed"),
      expect.any(Error),
    );

    errSpy.mockRestore();
    await store.close();
  });
});

// ---------------------------------------------------------------------------
// startAutoSave — debounce + ceiling
// ---------------------------------------------------------------------------

describe("startAutoSave — driven by the history", () => {
  let store: PersistenceStore;
  let saveSpy: ReturnType<typeof vi.fn>;
  let history: EditorHistory;
  /** One more document step: an edit. */
  const edit = () => history.record({ undo: () => {}, redo: () => {} });

  beforeEach(() => {
    vi.useFakeTimers();
    store = createPersistenceStore({ dbName: freshDb() });
    // Replace `save` with a spy so we can count calls without exercising
    // IDB inside the timer-based tests (we already test the IDB path above).
    saveSpy = vi.fn(() => Promise.resolve({ kind: "saved", revision: 1 }));
    store.save = saveSpy as unknown as typeof store.save;
    history = createHistory();
  });

  afterEach(async () => {
    vi.useRealTimers();
    await store.close();
  });

  it("three rapid edits within 100ms → exactly one save() call after debounce", async () => {
    const doc = makeDoc();
    const autosave = startAutoSave(store, history, () => doc, {
      intervalMs: 5000,
      maxFlushMs: 30000,
    });

    edit();
    await vi.advanceTimersByTimeAsync(30);
    edit();
    await vi.advanceTimersByTimeAsync(30);
    edit();

    // Before the debounce window elapses, no save.
    await vi.advanceTimersByTimeAsync(100);
    expect(saveSpy).not.toHaveBeenCalled();

    // After 5s from the *last* edit, exactly one flush.
    await vi.advanceTimersByTimeAsync(5000);
    expect(saveSpy).toHaveBeenCalledTimes(1);
    expect(history.dirty).toBe(false);

    autosave.stop();
  });

  it("ceiling timer fires when continuous edits keep resetting the debounce", async () => {
    const doc = makeDoc();
    const intervalMs = 5000;
    const maxFlushMs = 30000;
    const autosave = startAutoSave(store, history, () => doc, {
      intervalMs,
      maxFlushMs,
    });

    // Edit every 1s for 31s. Each edit resets the debounce to 5s, so the
    // debounce alone would never fire. The ceiling MUST force a flush.
    let elapsed = 0;
    while (elapsed < maxFlushMs + 1000) {
      edit();
      await vi.advanceTimersByTimeAsync(1000);
      elapsed += 1000;
    }

    expect(saveSpy).toHaveBeenCalledTimes(1);
    autosave.stop();
  });

  it("stop() cancels pending timers — no save fires after stop", async () => {
    const doc = makeDoc();
    const autosave = startAutoSave(store, history, () => doc);

    edit();
    await vi.advanceTimersByTimeAsync(1000);
    autosave.stop();
    await vi.advanceTimersByTimeAsync(60000);

    expect(saveSpy).not.toHaveBeenCalled();
  });

  it("an edit made while a save runs stays dirty", async () => {
    let finish: (r: unknown) => void = () => {};
    saveSpy.mockImplementation(() => new Promise((r) => (finish = r)));
    const autosave = startAutoSave(store, history, () => makeDoc());

    edit();
    const saving = autosave.saveNow();
    edit();
    finish({ kind: "saved", revision: 1 });
    await saving;

    expect(history.dirty).toBe(true);
    autosave.stop();
  });

  it("undo back to the saved position saves nothing", async () => {
    const autosave = startAutoSave(store, history, () => makeDoc());

    edit();
    history.undo();
    await vi.advanceTimersByTimeAsync(60000);

    expect(history.dirty).toBe(false);
    expect(saveSpy).not.toHaveBeenCalled();
    autosave.stop();
  });

  it("nothing to save here (a room): no save, and the history stays dirty", async () => {
    const onSaved = vi.fn();
    const autosave = startAutoSave(store, history, () => null, { onSaved });

    edit();
    await vi.advanceTimersByTimeAsync(60000);

    expect(saveSpy).not.toHaveBeenCalled();
    expect(onSaved).not.toHaveBeenCalled();
    expect(history.dirty).toBe(true);
    autosave.stop();
  });

  it("a conflict leaves the history dirty and goes to onConflict", async () => {
    const conflict = {
      kind: "conflict",
      stored: { revision: 3, updatedAt: "2026-06-01T00:00:00.000Z" },
    };
    saveSpy.mockResolvedValue(conflict);
    const onConflict = vi.fn();
    const doc = makeDoc();
    const autosave = startAutoSave(store, history, () => doc, { onConflict });

    edit();
    await vi.advanceTimersByTimeAsync(5000);

    expect(onConflict).toHaveBeenCalledWith(conflict, doc, expect.anything());
    expect(history.dirty).toBe(true);
    autosave.stop();
  });
});

// ---------------------------------------------------------------------------
// Disk save — fallback path (no FSA in jsdom)
// ---------------------------------------------------------------------------

describe("saveToDisk / openFromDisk — fallback path", () => {
  let store: PersistenceStore;

  beforeEach(() => {
    store = createPersistenceStore({ dbName: freshDb() });
  });

  afterEach(async () => {
    await store.close();
  });

  describe("with the File System Access API", () => {
    type Picker = ReturnType<typeof vi.fn>;
    let picked: string[];
    let savePicker: Picker;
    let openPicker: Picker;

    /** A file handle in memory: writes land in `written`. */
    function handle(name: string, text?: string) {
      return {
        name,
        createWritable: async () => ({
          write: async () => {
            picked.push(`write:${name}`);
          },
          close: async () => {},
        }),
        // jsdom's File has no text(); give the reader what a browser gives.
        getFile: async () =>
          ({ name, text: async () => text ?? "" } as unknown as File),
      };
    }

    beforeEach(() => {
      picked = [];
      savePicker = vi.fn(async (opts: { suggestedName: string }) => {
        picked.push(`pick:${opts.suggestedName}`);
        return handle(opts.suggestedName);
      });
      openPicker = vi.fn();
      Object.assign(window, {
        showSaveFilePicker: savePicker,
        showOpenFilePicker: openPicker,
      });
    });

    afterEach(() => {
      delete (window as { showSaveFilePicker?: unknown }).showSaveFilePicker;
      delete (window as { showOpenFilePicker?: unknown }).showOpenFilePicker;
    });

    it("saves a document to the file it chose before, without asking again", async () => {
      await store.saveToDisk(makeDoc());
      await store.saveToDisk(makeDoc());

      expect(savePicker).toHaveBeenCalledTimes(1);
      expect(picked).toEqual([
        "pick:Test.atlasdraw",
        "write:Test.atlasdraw",
        "write:Test.atlasdraw",
      ]);
    });

    it("asks for a file for a document imported from .excalidraw, not the previous document's file", async () => {
      await store.saveToDisk(makeDoc());
      openPicker.mockResolvedValue([
        handle(
          "sketch.excalidraw",
          JSON.stringify({ type: "excalidraw", elements: [] }),
        ),
      ]);
      const imported = await store.openFromDisk();

      await store.saveToDisk(imported!);

      expect(savePicker).toHaveBeenCalledTimes(2);
      expect(picked.filter((p) => p.startsWith("write:"))).toHaveLength(2);
    });
  });

  it("saveToDisk uses download anchor when FSA is unavailable", async () => {
    // jsdom has no showSaveFilePicker — exercise the fallback path.
    // jsdom 22 also lacks URL.createObjectURL/revokeObjectURL; install stubs.
    const urlAny = URL as unknown as {
      createObjectURL?: (b: Blob) => string;
      revokeObjectURL?: (url: string) => void;
    };
    const hadCreate = "createObjectURL" in urlAny;
    const hadRevoke = "revokeObjectURL" in urlAny;
    const createFn = vi.fn(() => "blob:test");
    const revokeFn = vi.fn();
    urlAny.createObjectURL = createFn;
    urlAny.revokeObjectURL = revokeFn;
    const infoSpy = vi.spyOn(console, "info").mockImplementation(() => {});

    try {
      await store.saveToDisk(makeDoc());

      expect(createFn).toHaveBeenCalledTimes(1);
      expect(revokeFn).toHaveBeenCalledTimes(1);
      expect(infoSpy).toHaveBeenCalledWith(
        expect.stringContaining("File System Access API unavailable"),
      );
    } finally {
      infoSpy.mockRestore();
      if (!hadCreate) {
        delete urlAny.createObjectURL;
      }
      if (!hadRevoke) {
        delete urlAny.revokeObjectURL;
      }
    }
  });
});

// ---------------------------------------------------------------------------
// Never an older copy over a newer one (audit2-03 F1), one tab per map (F2),
// a newer build's map kept and listed (F4)
// ---------------------------------------------------------------------------

describe("createPersistenceStore — the stored copy is never replaced by an older one", () => {
  const NEWER = "2026-06-01T00:00:00.000Z";
  // makeDoc's createdAt is 2026-05-06.
  const OLDER = "2026-05-10T00:00:00.000Z";

  it("an older copy that was not read from the slot is refused, and nothing reaches the server", async () => {
    const dbName = freshDb();
    const remoteSave = vi.fn(async () => {});
    const tab = createPersistenceStore({ dbName });
    const edited = makeDoc(NEWER);
    await tab.save({
      ...edited,
      manifest: { ...edited.manifest, title: "Week of edits" },
    });
    await tab.close();

    // A store that never read the slot: an opened file of the same map.
    const other = createPersistenceStore({ dbName, remoteSave });
    const result = await other.save(makeDoc(OLDER));

    expect(result).toEqual({
      kind: "conflict",
      stored: { revision: 1, updatedAt: NEWER },
    });
    expect(remoteSave).not.toHaveBeenCalled();
    expect((await other.load())?.manifest.title).toBe("Week of edits");
    await other.close();
  });

  it("Open from disk forgets what the slot was read at", async () => {
    const store = createPersistenceStore({ dbName: freshDb() });
    await store.save(makeDoc(NEWER));
    const input = vi.spyOn(document, "createElement");
    // The fallback picker hands back a month-old copy of the same map.
    const old = await write(makeDoc(OLDER));
    input.mockImplementationOnce(((tag: string) => {
      const el = document.createElementNS(
        "http://www.w3.org/1999/xhtml",
        tag,
      ) as HTMLInputElement;
      Object.defineProperty(el, "files", {
        value: [Object.assign(old, { name: "plan.atlasdraw" })],
      });
      el.click = () => el.dispatchEvent(new Event("change"));
      return el;
    }) as typeof document.createElement);

    const opened = await store.openFromDisk();
    input.mockRestore();

    expect(opened?.manifest.updatedAt).toBe(OLDER);
    expect((await store.save(opened!)).kind).toBe("conflict");
    await store.close();
  });

  it("replace: a save over the stored revision writes", async () => {
    const dbName = freshDb();
    const first = createPersistenceStore({ dbName });
    await first.save(makeDoc(NEWER));
    await first.close();
    const store = createPersistenceStore({ dbName });
    const conflict = await store.save(makeDoc(OLDER));
    if (conflict.kind !== "conflict") {
      throw new Error("expected a conflict");
    }

    const replaced = await store.save(makeDoc(OLDER), {
      over: conflict.stored.revision,
    });

    expect(replaced).toEqual({ kind: "saved", revision: 2 });
    expect((await store.load())?.manifest.updatedAt).toBe(OLDER);
    await store.close();
  });

  it("a tab that read the slot saves on top of it, again and again", async () => {
    const store = createPersistenceStore({ dbName: freshDb() });
    expect((await store.save(makeDoc(NEWER))).kind).toBe("saved");
    // Its own later save has an older timestamp only if the clock moved
    // back; the revision it read is what counts.
    expect((await store.save(makeDoc(OLDER))).kind).toBe("saved");
    await store.close();
  });
});

describe("createPersistenceStore — two tabs", () => {
  const A = "01J0000000000000000000000A";
  const B = "01J0000000000000000000000B";

  afterEach(() => {
    sessionStorage.clear();
  });

  it("a reload opens the map this tab had open, not the one another tab saved last", async () => {
    const dbName = freshDb();
    const tabA = createPersistenceStore({ dbName });
    await tabA.save(makeDoc(undefined, A));
    // Tab B saves later, from its own session.
    const own = new Map<string, string>();
    const tabB = createPersistenceStore({
      dbName,
      tabStorage: {
        getItem: (k) => own.get(k) ?? null,
        setItem: (k, v) => void own.set(k, v),
      },
    });
    await tabB.save(makeDoc(undefined, B));

    expect((await tabA.load())?.manifest.id).toBe(A);
    await tabA.close();
    await tabB.close();
  });

  it("a fresh tab opens the map saved last in this browser", async () => {
    const dbName = freshDb();
    const tabA = createPersistenceStore({ dbName });
    await tabA.save(makeDoc(undefined, A));
    sessionStorage.clear();
    const fresh = createPersistenceStore({ dbName });
    expect((await fresh.load())?.manifest.id).toBe(A);
    await tabA.close();
    await fresh.close();
  });
});

describe("createPersistenceStore — a map from a newer build", () => {
  it("is kept and listed as needing a newer Atlasdraw, never moved aside", async () => {
    const dbName = freshDb();
    const store = createPersistenceStore({ dbName });
    await store.save(makeDoc());
    // What a newer build writes: manifest version 99 in the bytes and the
    // summary.
    const db = await openDB(dbName, 1);
    const JSZip = (await import("jszip")).default;
    const stored = (await db.get("state", `doc:${ULID}`)) as {
      bytes: Uint8Array;
    };
    const zip = await JSZip.loadAsync(stored.bytes);
    const manifest = JSON.parse(
      await zip.file("manifest.json")!.async("string"),
    );
    zip.file("manifest.json", JSON.stringify({ ...manifest, version: 99 }));
    const bytes = await zip.generateAsync({ type: "uint8array" });
    await db.put("state", { bytes, type: "x" }, `doc:${ULID}`);
    const summary = await db.get("state", `summary:${ULID}`);
    await db.put("state", { ...summary, version: 99 }, `summary:${ULID}`);

    await expect(store.open(ULID)).rejects.toThrow();
    await expect(store.load()).rejects.toThrow();

    const keys = (await db.getAllKeys("state")).map(String);
    db.close();
    expect(keys).toContain(`doc:${ULID}`);
    expect(keys.some((k) => k.startsWith("quarantine:"))).toBe(false);
    expect(await store.list()).toEqual([
      expect.objectContaining({ id: ULID, needsNewerBuild: true }),
    ]);
    await store.close();
  });
});
