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

import { testSession } from "../session/__tests__/sessionFixture";

import * as persistenceModule from "../state/persistence";
import * as documentIO from "../state/documentIO";
import * as roomModule from "../state/room";
import * as shareModule from "../state/loadShareDocument";
import { savedDocument } from "../state/__tests__/fixtures/documentWorld";

import * as appConfigModule from "../config/app-config";

import { usePersistenceWiring } from "./usePersistenceWiring";

import type { Admitted } from "../state/documentGate";

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

const FAKE_DOC: AtlasdrawDocument = savedDocument();

/** loadDocument's first argument: FAKE_DOC, as the gate admitted it. */
const ADMITTED_FAKE_DOC = expect.objectContaining({
  ok: true,
  doc: expect.objectContaining({
    manifest: expect.objectContaining({ id: FAKE_DOC.manifest.id }),
  }),
});

function makeFakeStore(overrides: Partial<PersistenceStore> = {}) {
  const store: PersistenceStore = {
    save: vi.fn(async () => ({ kind: "saved" as const, revision: 1 })),
    claim: vi.fn(async (id: string) => ({
      kind: "lease" as const,
      id,
      release: () => {},
      lost: new Promise<void>(() => {}),
    })),
    load: vi.fn(async () => null),
    list: vi.fn(async () => []),
    open: vi.fn(async () => null),
    remove: vi.fn(async () => {}),
    saveToDisk: vi.fn(async () => {}),
    openFromDisk: vi.fn(async () => null),
    remoteSaveFailed: vi.fn(() => false),
    close: vi.fn(async () => {}),
    ...overrides,
  };
  return store;
}

const fakeExcalidrawAPI = {} as ExcalidrawImperativeAPI;

/** What a mocked startAutoSave returns. */
const fakeAutoSave = () => ({ saveNow: vi.fn(() => null), stop: vi.fn() });

/** An edit: one more step in the session's history. */
const edit = () => session.history.record({ undo: () => {}, redo: () => {} });

/** The editor's session; a new one for every case. */
let session = testSession();

beforeEach(() => {
  vi.spyOn(appConfigModule, "getAppConfig").mockReturnValue(BASE_CONFIG);
  session = testSession();
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
    const store = makeFakeStore();
    vi.spyOn(persistenceModule, "createPersistenceStore").mockReturnValue(
      store,
    );
    renderHook(() =>
      usePersistenceWiring(session, fakeExcalidrawAPI, { error: vi.fn() }),
    );
    edit();

    hide();

    expect(store.save).toHaveBeenCalledTimes(1);
  });

  it("saves at once on pagehide with unsaved changes", () => {
    const store = makeFakeStore();
    vi.spyOn(persistenceModule, "createPersistenceStore").mockReturnValue(
      store,
    );
    renderHook(() =>
      usePersistenceWiring(session, fakeExcalidrawAPI, { error: vi.fn() }),
    );
    edit();

    window.dispatchEvent(new Event("pagehide"));

    expect(store.save).toHaveBeenCalledTimes(1);
  });

  it("writes nothing for a room's document: the relay keeps it", () => {
    vi.spyOn(roomModule, "isRoomDocument").mockReturnValue(true);
    const store = makeFakeStore();
    vi.spyOn(persistenceModule, "createPersistenceStore").mockReturnValue(
      store,
    );
    const autoSave = vi.spyOn(persistenceModule, "startAutoSave");
    renderHook(() =>
      usePersistenceWiring(session, fakeExcalidrawAPI, { error: vi.fn() }),
    );
    edit();

    hide();
    const getDoc = autoSave.mock.calls[0]![2];

    expect(store.save).not.toHaveBeenCalled();
    expect(getDoc()).toBeNull();
  });

  it("saves unsaved changes when the editor unmounts (a crash), before the store closes", async () => {
    const store = makeFakeStore();
    vi.spyOn(persistenceModule, "createPersistenceStore").mockReturnValue(
      store,
    );
    const { unmount } = renderHook(() =>
      usePersistenceWiring(session, fakeExcalidrawAPI, { error: vi.fn() }),
    );
    edit();

    unmount();

    expect(store.save).toHaveBeenCalledTimes(1);
    // The connection closes only after the last save is written.
    await waitFor(() => expect(store.close).toHaveBeenCalled());
    const saved = (store.save as ReturnType<typeof vi.fn>).mock
      .invocationCallOrder[0]!;
    const closed = (store.close as ReturnType<typeof vi.fn>).mock
      .invocationCallOrder[0]!;
    expect(saved).toBeLessThan(closed);
  });

  it("writes nothing when nothing changed", () => {
    const store = makeFakeStore();
    vi.spyOn(persistenceModule, "createPersistenceStore").mockReturnValue(
      store,
    );
    renderHook(() =>
      usePersistenceWiring(session, fakeExcalidrawAPI, { error: vi.fn() }),
    );

    hide();

    expect(store.save).not.toHaveBeenCalled();
  });
});

describe("usePersistenceWiring", () => {
  it("does nothing when excalidrawAPI is null", () => {
    const createSpy = vi.spyOn(persistenceModule, "createPersistenceStore");
    renderHook(() => usePersistenceWiring(session, null, { error: vi.fn() }));
    expect(createSpy).not.toHaveBeenCalled();
  });

  it("registers the created store into the session", () => {
    const store = makeFakeStore();
    vi.spyOn(persistenceModule, "createPersistenceStore").mockReturnValue(
      store,
    );
    vi.spyOn(persistenceModule, "startAutoSave").mockReturnValue(
      fakeAutoSave(),
    );

    renderHook(() =>
      usePersistenceWiring(session, fakeExcalidrawAPI, { error: vi.fn() }),
    );

    expect(session.persistence.getState().persistenceStore).toBe(store);
  });

  it("opens the loaded document when load() resolves one", async () => {
    const store = makeFakeStore({ load: vi.fn(async () => FAKE_DOC) });
    vi.spyOn(persistenceModule, "createPersistenceStore").mockReturnValue(
      store,
    );
    vi.spyOn(persistenceModule, "startAutoSave").mockReturnValue(
      fakeAutoSave(),
    );
    const hydrateSpy = vi
      .spyOn(documentIO, "loadDocument")
      .mockResolvedValue(undefined as never);

    renderHook(() =>
      usePersistenceWiring(session, fakeExcalidrawAPI, { error: vi.fn() }),
    );

    await waitFor(() => {
      expect(hydrateSpy).toHaveBeenCalledWith(
        ADMITTED_FAKE_DOC,
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
      const autosave = fakeAutoSave();
      const saveNow = autosave.saveNow;
      vi.spyOn(persistenceModule, "startAutoSave").mockReturnValue(autosave);
      const shared = {
        ...FAKE_DOC,
        manifest: { ...FAKE_DOC.manifest, id: "shared-1", title: "Wells" },
      } as AtlasdrawDocument;
      const loadShared = vi
        .spyOn(shareModule, "loadShareDocument")
        .mockResolvedValue({
          kind: "ready",
          admitted: {
            ok: true,
            doc: shared,
            dropped: { elements: 0, layers: 0, files: 0 },
            repaired: { styles: 0 },
          } as unknown as Admitted,
        });
      const open = vi
        .spyOn(documentIO, "loadDocument")
        .mockResolvedValue({} as never);
      const notify = { error: vi.fn(), success: vi.fn() };

      renderHook(() =>
        usePersistenceWiring(session, fakeExcalidrawAPI, notify, {
          hash: "v2:AAAA",
        }),
      );

      await waitFor(() => expect(open).toHaveBeenCalledTimes(1));
      expect(loadShared).toHaveBeenCalledWith({ hash: "v2:AAAA" });
      expect(store.load).not.toHaveBeenCalled();
      const opened = open.mock.calls[0][0].doc;
      expect(opened.manifest.title).toBe("Wells");
      expect(opened.manifest.id).not.toBe("shared-1");
      // The copy is new to this browser: saved at once, though opening it
      // was no edit.
      await waitFor(() => expect(saveNow).toHaveBeenCalled());
      expect(session.history.dirty).toBe(false);
      expect(window.location.hash).toBe("");
      expect(notify.success).toHaveBeenCalledWith('Opened a copy of "Wells"');
    });

    it("says so and opens the autosave when the shared map cannot load", async () => {
      const store = makeFakeStore({ load: vi.fn(async () => FAKE_DOC) });
      vi.spyOn(persistenceModule, "createPersistenceStore").mockReturnValue(
        store,
      );
      vi.spyOn(persistenceModule, "startAutoSave").mockReturnValue(
        fakeAutoSave(),
      );
      vi.spyOn(shareModule, "loadShareDocument").mockResolvedValue({
        kind: "expired",
      });
      const open = vi
        .spyOn(documentIO, "loadDocument")
        .mockResolvedValue({} as never);
      const notify = { error: vi.fn(), success: vi.fn() };

      renderHook(() =>
        usePersistenceWiring(session, fakeExcalidrawAPI, notify, {
          token: "abcdefghij1234567890K",
        }),
      );

      await waitFor(() =>
        expect(open).toHaveBeenCalledWith(
          ADMITTED_FAKE_DOC,
          fakeExcalidrawAPI,
          expect.anything(),
        ),
      );
      expect(notify.error).toHaveBeenCalledWith(
        "Couldn't open the shared map: the link has expired.",
      );
    });
  });

  it("opening the autosaved map is not an edit", async () => {
    const store = makeFakeStore({ load: vi.fn(async () => FAKE_DOC) });
    vi.spyOn(persistenceModule, "createPersistenceStore").mockReturnValue(
      store,
    );
    const open = vi
      .spyOn(documentIO, "loadDocument")
      .mockResolvedValue({} as never);

    renderHook(() =>
      usePersistenceWiring(session, fakeExcalidrawAPI, { error: vi.fn() }),
    );

    await waitFor(() => expect(open).toHaveBeenCalled());
    await waitFor(() =>
      expect(session.persistence.getState().ownMapLoaded).toBe(true),
    );
    expect(session.history.dirty).toBe(false);
    expect(store.save).not.toHaveBeenCalled();
  });

  it("keeps what the user drew before the saved map loaded, and leaves that map in My maps", async () => {
    let finishLoad: (doc: AtlasdrawDocument) => void = () => {};
    const store = makeFakeStore({
      load: vi.fn(
        () => new Promise<AtlasdrawDocument>((r) => (finishLoad = r)),
      ),
    });
    vi.spyOn(persistenceModule, "createPersistenceStore").mockReturnValue(
      store,
    );
    vi.spyOn(persistenceModule, "startAutoSave").mockReturnValue(
      fakeAutoSave(),
    );
    const open = vi
      .spyOn(documentIO, "loadDocument")
      .mockResolvedValue({} as never);
    const notify = { error: vi.fn(), success: vi.fn() };
    renderHook(() => usePersistenceWiring(session, fakeExcalidrawAPI, notify));

    // A stroke on the blank map while the saved one is still read.
    await waitFor(() => expect(store.load).toHaveBeenCalled());
    edit();
    finishLoad(FAKE_DOC);

    await waitFor(() =>
      expect(session.persistence.getState().ownMapLoaded).toBe(true),
    );
    expect(open).not.toHaveBeenCalled();
    expect(notify.success).toHaveBeenCalledWith(
      expect.stringMatching(/My maps/),
    );
  });

  it("calls documentNotify.error when auto-save reports a failure", () => {
    const store = makeFakeStore();
    vi.spyOn(persistenceModule, "createPersistenceStore").mockReturnValue(
      store,
    );
    let onSaveError: ((err: unknown) => void) | undefined;
    vi.spyOn(persistenceModule, "startAutoSave").mockImplementation(
      (_store, _history, _getDoc, options) => {
        onSaveError = options?.onSaveError;
        return fakeAutoSave();
      },
    );
    const notifyError = vi.fn();

    renderHook(() =>
      usePersistenceWiring(session, fakeExcalidrawAPI, { error: notifyError }),
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
    vi.spyOn(persistenceModule, "startAutoSave").mockReturnValue(
      fakeAutoSave(),
    );
    const notifyError = vi.fn();

    renderHook(() =>
      usePersistenceWiring(session, fakeExcalidrawAPI, { error: notifyError }),
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
    vi.spyOn(persistenceModule, "startAutoSave").mockReturnValue(
      fakeAutoSave(),
    );
    const notifyError = vi.fn();

    renderHook(() =>
      usePersistenceWiring(session, fakeExcalidrawAPI, { error: notifyError }),
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
    expect(session.persistence.getState().remoteSaveFailed).toBe(true);
  });

  it("disposes the store and clears it from the session on unmount", async () => {
    const store = makeFakeStore();
    const autosave = fakeAutoSave();
    vi.spyOn(persistenceModule, "createPersistenceStore").mockReturnValue(
      store,
    );
    vi.spyOn(persistenceModule, "startAutoSave").mockReturnValue(autosave);

    const { unmount } = renderHook(() =>
      usePersistenceWiring(session, fakeExcalidrawAPI, { error: vi.fn() }),
    );
    expect(session.persistence.getState().persistenceStore).toBe(store);

    unmount();

    expect(autosave.stop).toHaveBeenCalled();
    expect(session.persistence.getState().persistenceStore).toBeNull();
    // Closed after any save the unmount made.
    await waitFor(() => expect(store.close).toHaveBeenCalled());
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
    vi.spyOn(persistenceModule, "startAutoSave").mockReturnValue(
      fakeAutoSave(),
    );

    renderHook(() =>
      usePersistenceWiring(session, fakeExcalidrawAPI, { error: vi.fn() }),
    );

    expect(createSpy).toHaveBeenCalledWith(
      expect.objectContaining({ remoteSave: expect.any(Function) }),
    );
  });
});
