// SPDX-License-Identifier: AGPL-3.0-only
// Tests for usePersistenceWiring.
//
// createPersistenceStore/startAutoSave/loadDocument are mocked so this test
// verifies the WIRING (what usePersistenceWiring does with the store's
// lifecycle) rather than re-testing persistence.ts's own IDB round-trip,
// which persistence.test.ts already covers.
//
// Per .claude/rules/test-fixtures.md: this file owns its own mocks.

import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { renderHook, waitFor, cleanup } from "@testing-library/react";

import type { ExcalidrawImperativeAPI } from "@atlasdraw/excalidraw";

import type { AtlasdrawDocument } from "@atlasdraw/data";

import { usePersistenceStore } from "../state/usePersistenceStore";

import * as persistenceModule from "../state/persistence";
import * as documentIO from "../state/documentIO";
import * as roomModule from "../state/room";
import * as shareModule from "../state/loadShareDocument";
import * as appConfigModule from "../config/app-config";

import { usePersistenceWiring } from "./usePersistenceWiring";

import type { PersistenceStore } from "../state/persistence";

import type { AppConfig } from "../config/app-config";

vi.mock("../services/createHttpStorageClient", () => ({
  createHttpStorageClient: vi.fn(() => ({
    createMap: vi.fn(),
    updateMap: vi.fn(),
  })),
}));

const BASE_CONFIG: AppConfig = {
  buildTarget: "local-only",
  realtime: { enabled: false, wsUrl: undefined },
  enableBackendPersistence: false,
  showDemoBadge: false,
  storageBaseUrl: "",
  geocoder: undefined,
  allowRemoteBasemaps: false,
  embedEnabled: true,
  pmtilesPath: "/data/world-low-zoom.pmtiles",
  appVersion: "unknown",
  gitHash: "unknown",
};

const FAKE_DOC = {
  manifest: {
    id: "doc-1",
    title: "Test",
    layers: [{ id: "l1" }],
  },
  scene: [{ id: "el1" }],
} as unknown as AtlasdrawDocument;

function makeFakeStore(overrides: Partial<PersistenceStore> = {}) {
  const dirtyListeners = new Set<() => void>();
  const store: PersistenceStore = {
    save: vi.fn(async () => {}),
    load: vi.fn(async () => null),
    list: vi.fn(async () => []),
    open: vi.fn(async () => null),
    remove: vi.fn(async () => {}),
    saveToDisk: vi.fn(async () => {}),
    openFromDisk: vi.fn(async () => null),
    onDirty: vi.fn((cb: () => void) => {
      dirtyListeners.add(cb);
      return () => dirtyListeners.delete(cb);
    }),
    markDirty: vi.fn(() => {
      for (const cb of dirtyListeners) {
        cb();
      }
    }),
    isDirty: vi.fn(() => false),
    remoteSaveFailed: vi.fn(() => false),
    close: vi.fn(async () => {}),
    ...overrides,
  };
  return store;
}

const fakeExcalidrawAPI = {} as ExcalidrawImperativeAPI;

beforeEach(() => {
  vi.spyOn(appConfigModule, "getAppConfig").mockReturnValue(BASE_CONFIG);
  usePersistenceStore.setState({
    persistenceStore: null,
    isDirty: false,
    isDraining: false,
    lastSavedAt: null,
    remoteSaveFailed: false,
    autosaveDispose: null,
  });
});

afterEach(() => {
  cleanup();
  vi.restoreAllMocks();
});

describe("usePersistenceWiring — closing the tab", () => {
  function hide() {
    Object.defineProperty(document, "visibilityState", {
      value: "hidden",
      configurable: true,
    });
    document.dispatchEvent(new Event("visibilitychange"));
  }

  afterEach(() => {
    Object.defineProperty(document, "visibilityState", {
      value: "visible",
      configurable: true,
    });
  });

  it("saves at once when the page is hidden with unsaved changes", () => {
    const store = makeFakeStore({ isDirty: vi.fn(() => true) });
    vi.spyOn(persistenceModule, "createPersistenceStore").mockReturnValue(
      store,
    );
    vi.spyOn(persistenceModule, "startAutoSave").mockReturnValue(vi.fn());
    renderHook(() =>
      usePersistenceWiring(fakeExcalidrawAPI, { error: vi.fn() }),
    );

    hide();

    expect(store.save).toHaveBeenCalledTimes(1);
  });

  it("saves at once on pagehide with unsaved changes", () => {
    const store = makeFakeStore({ isDirty: vi.fn(() => true) });
    vi.spyOn(persistenceModule, "createPersistenceStore").mockReturnValue(
      store,
    );
    vi.spyOn(persistenceModule, "startAutoSave").mockReturnValue(vi.fn());
    renderHook(() =>
      usePersistenceWiring(fakeExcalidrawAPI, { error: vi.fn() }),
    );

    window.dispatchEvent(new Event("pagehide"));

    expect(store.save).toHaveBeenCalledTimes(1);
  });

  it("writes nothing for a room's document: the relay keeps it", () => {
    vi.spyOn(roomModule, "isRoomDocument").mockReturnValue(true);
    const store = makeFakeStore({ isDirty: vi.fn(() => true) });
    vi.spyOn(persistenceModule, "createPersistenceStore").mockReturnValue(
      store,
    );
    const autoSave = vi
      .spyOn(persistenceModule, "startAutoSave")
      .mockReturnValue(vi.fn());
    renderHook(() =>
      usePersistenceWiring(fakeExcalidrawAPI, { error: vi.fn() }),
    );

    hide();
    const getDoc = autoSave.mock.calls[0]![1];

    expect(store.save).not.toHaveBeenCalled();
    expect(getDoc()).toBeNull();
  });

  it("writes nothing when nothing changed", () => {
    const store = makeFakeStore();
    vi.spyOn(persistenceModule, "createPersistenceStore").mockReturnValue(
      store,
    );
    vi.spyOn(persistenceModule, "startAutoSave").mockReturnValue(vi.fn());
    renderHook(() =>
      usePersistenceWiring(fakeExcalidrawAPI, { error: vi.fn() }),
    );

    hide();

    expect(store.save).not.toHaveBeenCalled();
  });
});

describe("usePersistenceWiring", () => {
  it("does nothing when excalidrawAPI is null", () => {
    const createSpy = vi.spyOn(persistenceModule, "createPersistenceStore");
    renderHook(() => usePersistenceWiring(null, { error: vi.fn() }));
    expect(createSpy).not.toHaveBeenCalled();
  });

  it("registers the created store into usePersistenceStore", () => {
    const store = makeFakeStore();
    vi.spyOn(persistenceModule, "createPersistenceStore").mockReturnValue(
      store,
    );
    vi.spyOn(persistenceModule, "startAutoSave").mockReturnValue(vi.fn());

    renderHook(() =>
      usePersistenceWiring(fakeExcalidrawAPI, { error: vi.fn() }),
    );

    expect(usePersistenceStore.getState().persistenceStore).toBe(store);
  });

  it("opens the loaded document when load() resolves one", async () => {
    const store = makeFakeStore({ load: vi.fn(async () => FAKE_DOC) });
    vi.spyOn(persistenceModule, "createPersistenceStore").mockReturnValue(
      store,
    );
    vi.spyOn(persistenceModule, "startAutoSave").mockReturnValue(vi.fn());
    const hydrateSpy = vi
      .spyOn(documentIO, "loadDocument")
      .mockResolvedValue(undefined as never);

    renderHook(() =>
      usePersistenceWiring(fakeExcalidrawAPI, { error: vi.fn() }),
    );

    await waitFor(() => {
      expect(hydrateSpy).toHaveBeenCalledWith(
        FAKE_DOC,
        fakeExcalidrawAPI,
        expect.anything(),
      );
    });
  });

  describe("a link that opens a copy of a shared map", () => {
    afterEach(() => {
      window.history.replaceState(null, "", "/");
    });

    it("opens a copy with its own id instead of the autosave, saves it, and clears the link", async () => {
      window.history.replaceState(null, "", "/#open:v2:AAAA");
      const store = makeFakeStore({ load: vi.fn(async () => FAKE_DOC) });
      vi.spyOn(persistenceModule, "createPersistenceStore").mockReturnValue(
        store,
      );
      vi.spyOn(persistenceModule, "startAutoSave").mockReturnValue(vi.fn());
      const shared = {
        ...FAKE_DOC,
        manifest: { ...FAKE_DOC.manifest, id: "shared-1", title: "Wells" },
      } as AtlasdrawDocument;
      const loadShared = vi
        .spyOn(shareModule, "loadShareDocument")
        .mockResolvedValue({ kind: "ready", doc: shared });
      const open = vi
        .spyOn(documentIO, "loadDocument")
        .mockResolvedValue({} as never);
      const notify = { error: vi.fn(), success: vi.fn() };

      renderHook(() =>
        usePersistenceWiring(fakeExcalidrawAPI, notify, { hash: "v2:AAAA" }),
      );

      await waitFor(() => expect(open).toHaveBeenCalledTimes(1));
      expect(loadShared).toHaveBeenCalledWith({ hash: "v2:AAAA" });
      expect(store.load).not.toHaveBeenCalled();
      const opened = open.mock.calls[0][0];
      expect(opened.manifest.title).toBe("Wells");
      expect(opened.manifest.id).not.toBe("shared-1");
      expect(usePersistenceStore.getState().isDirty).toBe(true);
      expect(window.location.hash).toBe("");
      expect(notify.success).toHaveBeenCalledWith('Opened a copy of "Wells"');
    });

    it("says so and opens the autosave when the shared map cannot load", async () => {
      const store = makeFakeStore({ load: vi.fn(async () => FAKE_DOC) });
      vi.spyOn(persistenceModule, "createPersistenceStore").mockReturnValue(
        store,
      );
      vi.spyOn(persistenceModule, "startAutoSave").mockReturnValue(vi.fn());
      vi.spyOn(shareModule, "loadShareDocument").mockResolvedValue({
        kind: "expired",
      });
      const open = vi
        .spyOn(documentIO, "loadDocument")
        .mockResolvedValue({} as never);
      const notify = { error: vi.fn(), success: vi.fn() };

      renderHook(() =>
        usePersistenceWiring(fakeExcalidrawAPI, notify, {
          token: "abcdefghij1234567890K",
        }),
      );

      await waitFor(() =>
        expect(open).toHaveBeenCalledWith(
          FAKE_DOC,
          fakeExcalidrawAPI,
          expect.anything(),
        ),
      );
      expect(notify.error).toHaveBeenCalledWith(
        "Couldn't open the shared map: the link has expired.",
      );
    });
  });

  it("mirrors the store's onDirty into usePersistenceStore (isDirty + isDraining)", () => {
    const store = makeFakeStore();
    vi.spyOn(persistenceModule, "createPersistenceStore").mockReturnValue(
      store,
    );
    vi.spyOn(persistenceModule, "startAutoSave").mockReturnValue(vi.fn());

    renderHook(() =>
      usePersistenceWiring(fakeExcalidrawAPI, { error: vi.fn() }),
    );

    expect(usePersistenceStore.getState().isDirty).toBe(false);
    store.markDirty();
    expect(usePersistenceStore.getState().isDirty).toBe(true);
    expect(usePersistenceStore.getState().isDraining).toBe(true);
  });

  it("calls documentNotify.error when auto-save reports a failure", () => {
    const store = makeFakeStore();
    vi.spyOn(persistenceModule, "createPersistenceStore").mockReturnValue(
      store,
    );
    let onSaveError: ((err: unknown) => void) | undefined;
    vi.spyOn(persistenceModule, "startAutoSave").mockImplementation(
      (_store, _getDoc, _interval, _ceiling, _onSaved, onError) => {
        onSaveError = onError;
        return vi.fn();
      },
    );
    const notifyError = vi.fn();

    renderHook(() =>
      usePersistenceWiring(fakeExcalidrawAPI, { error: notifyError }),
    );

    onSaveError?.(new Error("boom"));
    expect(notifyError).toHaveBeenCalledWith(
      "Auto-save failed — recent changes may not be saved",
    );
  });

  it("calls documentNotify.error when the initial load() rejects (ISSUES.md Issue 7)", async () => {
    const store = makeFakeStore({
      load: vi.fn(async () => {
        throw new Error("IDB unavailable");
      }),
    });
    vi.spyOn(persistenceModule, "createPersistenceStore").mockReturnValue(
      store,
    );
    vi.spyOn(persistenceModule, "startAutoSave").mockReturnValue(vi.fn());
    const notifyError = vi.fn();

    renderHook(() =>
      usePersistenceWiring(fakeExcalidrawAPI, { error: notifyError }),
    );

    await waitFor(() => {
      expect(notifyError).toHaveBeenCalledWith(
        "Couldn't load your saved map — starting from a blank canvas",
      );
    });
  });

  it("notifies once on the ok->failed transition for remoteSave, not on every subsequent failure (ISSUES.md Issue 7)", () => {
    const store = makeFakeStore();
    vi.spyOn(persistenceModule, "createPersistenceStore").mockImplementation(
      (opts) => {
        // Simulate two consecutive remoteSave failures firing onRemoteSaveFailed.
        (store as unknown as { __opts: typeof opts }).__opts = opts;
        return store;
      },
    );
    vi.spyOn(persistenceModule, "startAutoSave").mockReturnValue(vi.fn());
    const notifyError = vi.fn();

    renderHook(() =>
      usePersistenceWiring(fakeExcalidrawAPI, { error: notifyError }),
    );

    const opts = (
      store as unknown as { __opts: { onRemoteSaveFailed?: () => void } }
    ).__opts;
    opts.onRemoteSaveFailed?.();
    opts.onRemoteSaveFailed?.();
    opts.onRemoteSaveFailed?.();

    expect(notifyError).toHaveBeenCalledTimes(1);
    expect(notifyError).toHaveBeenCalledWith(
      "Couldn't sync to the server — your changes are saved locally but not backed up",
    );
    expect(usePersistenceStore.getState().remoteSaveFailed).toBe(true);
  });

  it("disposes the store and clears usePersistenceStore on unmount", () => {
    const store = makeFakeStore();
    const dispose = vi.fn();
    vi.spyOn(persistenceModule, "createPersistenceStore").mockReturnValue(
      store,
    );
    vi.spyOn(persistenceModule, "startAutoSave").mockReturnValue(dispose);

    const { unmount } = renderHook(() =>
      usePersistenceWiring(fakeExcalidrawAPI, { error: vi.fn() }),
    );
    expect(usePersistenceStore.getState().persistenceStore).toBe(store);

    unmount();

    expect(dispose).toHaveBeenCalled();
    expect(store.close).toHaveBeenCalled();
    expect(usePersistenceStore.getState().persistenceStore).toBeNull();
    expect(usePersistenceStore.getState().autosaveDispose).toBeNull();
  });

  it("builds a remote-save callback only when enableBackendPersistence is true", () => {
    vi.spyOn(appConfigModule, "getAppConfig").mockReturnValue({
      ...BASE_CONFIG,
      enableBackendPersistence: true,
      storageBaseUrl: "https://api.example.test",
    });
    const store = makeFakeStore();
    const createSpy = vi
      .spyOn(persistenceModule, "createPersistenceStore")
      .mockReturnValue(store);
    vi.spyOn(persistenceModule, "startAutoSave").mockReturnValue(vi.fn());

    renderHook(() =>
      usePersistenceWiring(fakeExcalidrawAPI, { error: vi.fn() }),
    );

    expect(createSpy).toHaveBeenCalledWith(
      expect.objectContaining({ remoteSave: expect.any(Function) }),
    );
  });
});
