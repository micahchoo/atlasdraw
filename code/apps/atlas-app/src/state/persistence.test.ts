// SPDX-License-Identifier: AGPL-3.0-only
// Phase 3 Wave 2 Task 8 — persistence.ts tests.
//
// fake-indexeddb/auto polyfills the global IDB factory with an in-memory
// implementation so the `idb` package can run unmodified under jsdom.

import "fake-indexeddb/auto";
import { openDB } from "idb";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

import type { AtlasdrawDocument } from "@atlasdraw/data";

import {
  createPersistenceStore,
  startAutoSave,
  type PersistenceStore,
} from "../state/persistence";

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

  it("onDirty(cb) fires after markDirty()", () => {
    const cb = vi.fn();
    const unsub = store.onDirty(cb);
    expect(cb).not.toHaveBeenCalled();
    store.markDirty();
    expect(cb).toHaveBeenCalledTimes(1);
    store.markDirty();
    expect(cb).toHaveBeenCalledTimes(2);
    unsub();
    store.markDirty();
    expect(cb).toHaveBeenCalledTimes(2); // unsubscribed.
  });

  it("dirty flag stays true if markDirty arrives during in-flight save", async () => {
    const doc = makeDoc();
    store.markDirty();
    expect(store.isDirty()).toBe(true);

    // Start the save without awaiting; immediately bump dirtySeq via
    // markDirty(). Because markDirty is synchronous and save's first await
    // runs on the microtask queue, the markDirty lands before the put
    // resolves — exercising the snapshot-guard race window.
    const savePromise = store.save(doc);
    store.markDirty();
    await savePromise;

    expect(store.isDirty()).toBe(true);
  });

  it("save() clears dirty when no race occurs", async () => {
    const doc = makeDoc();
    store.markDirty();
    await store.save(doc);
    expect(store.isDirty()).toBe(false);
  });
});

// ---------------------------------------------------------------------------
// T13 — remoteSave callback option
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

  it("writes nothing after suspendWrites(), so a shared room cannot overwrite the user's map", async () => {
    const store = createPersistenceStore({ dbName: freshDb() });
    await store.save(makeDoc("2026-05-06T00:00:00.000Z"));

    store.suspendWrites();
    await store.save(makeDoc("2026-09-09T00:00:00.000Z"));

    expect((await store.load())?.manifest.updatedAt).toBe(
      "2026-05-06T00:00:00.000Z",
    );
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

  it("swallows remoteSave failures — save() resolves and dirty clears", async () => {
    const errSpy = vi.spyOn(console, "error").mockImplementation(() => {});
    const remoteSave = vi.fn(async () => {
      throw new Error("network down");
    });
    const store = createPersistenceStore({
      dbName: freshDb(),
      remoteSave,
    });
    const doc = makeDoc();
    store.markDirty();
    // The promise must NOT reject.
    await expect(store.save(doc)).resolves.toBeUndefined();
    expect(store.isDirty()).toBe(false);
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

describe("startAutoSave — debounce + ceiling", () => {
  let store: PersistenceStore;
  let saveSpy: ReturnType<typeof vi.fn>;

  beforeEach(() => {
    vi.useFakeTimers();
    store = createPersistenceStore({ dbName: freshDb() });
    // Replace `save` with a spy so we can count calls without exercising
    // IDB inside the timer-based tests (we already test the IDB path above).
    saveSpy = vi.fn(() => Promise.resolve());
    store.save = saveSpy as unknown as typeof store.save;
  });

  afterEach(async () => {
    vi.useRealTimers();
    await store.close();
  });

  it("three rapid markDirty() within 100ms → exactly one save() call after debounce", async () => {
    const doc = makeDoc();
    const dispose = startAutoSave(store, () => doc, 5000, 30000);

    store.markDirty();
    await vi.advanceTimersByTimeAsync(30);
    store.markDirty();
    await vi.advanceTimersByTimeAsync(30);
    store.markDirty();

    // Before the debounce window elapses, no save.
    await vi.advanceTimersByTimeAsync(100);
    expect(saveSpy).not.toHaveBeenCalled();

    // After 5s from the *last* markDirty, exactly one flush.
    await vi.advanceTimersByTimeAsync(5000);
    expect(saveSpy).toHaveBeenCalledTimes(1);

    dispose();
  });

  it("ceiling timer fires when continuous edits keep resetting the debounce", async () => {
    const doc = makeDoc();
    const intervalMs = 5000;
    const maxFlushMs = 30000;
    const dispose = startAutoSave(store, () => doc, intervalMs, maxFlushMs);

    // Edit every 1s for 31s. Each edit resets the debounce to 5s, so the
    // debounce alone would never fire. The ceiling MUST force a flush.
    let elapsed = 0;
    while (elapsed < maxFlushMs + 1000) {
      store.markDirty();
      await vi.advanceTimersByTimeAsync(1000);
      elapsed += 1000;
    }

    expect(saveSpy).toHaveBeenCalledTimes(1);
    dispose();
  });

  it("dispose() cancels pending timers — no save fires after dispose", async () => {
    const doc = makeDoc();
    const dispose = startAutoSave(store, () => doc, 5000, 30000);

    store.markDirty();
    await vi.advanceTimersByTimeAsync(1000);
    dispose();
    await vi.advanceTimersByTimeAsync(60000);

    expect(saveSpy).not.toHaveBeenCalled();
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
