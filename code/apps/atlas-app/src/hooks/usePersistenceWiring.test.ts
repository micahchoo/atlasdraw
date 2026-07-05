// SPDX-License-Identifier: AGPL-3.0-only
// Characterization tests for usePersistenceWiring — extracted from
// MapEditor.tsx (DEADWOOD.md god-module split, Cut 3). Before this
// extraction, this wiring effect had only indirect coverage via
// MapEditor.atlasdraw-export.test.tsx exercising saveAtlasDocument/
// openAtlasDocument, which read the same usePersistenceStore contract.
//
// createPersistenceStore/startAutoSave/hydrate are mocked so this test
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
import * as hydrateModule from "../state/hydrate";
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
  enableShareUI: true,
  realtime: { enabled: false, wsUrl: undefined },
  enableBackendPersistence: false,
  showDemoBadge: false,
  storageBaseUrl: "",
  maputnikUrl: "https://maputnik.github.io/editor/",
  geocoder: undefined,
  managed: false,
  allowRemoteBasemaps: false,
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

  it("hydrates the scene when load() resolves a document", async () => {
    const store = makeFakeStore({ load: vi.fn(async () => FAKE_DOC) });
    vi.spyOn(persistenceModule, "createPersistenceStore").mockReturnValue(
      store,
    );
    vi.spyOn(persistenceModule, "startAutoSave").mockReturnValue(vi.fn());
    const hydrateSpy = vi
      .spyOn(hydrateModule, "hydrate")
      .mockResolvedValue(undefined);

    renderHook(() =>
      usePersistenceWiring(fakeExcalidrawAPI, { error: vi.fn() }),
    );

    await waitFor(() => {
      expect(hydrateSpy).toHaveBeenCalledWith(FAKE_DOC, fakeExcalidrawAPI);
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
