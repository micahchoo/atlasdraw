// SPDX-License-Identifier: AGPL-3.0-only
// One format, one door (ADR 0010 cohesion work) — the .atlasdraw bundle is
// the canonical document format and saveAtlasDocument/openAtlasDocument are
// the only save/open surfaces (MainMenu "Open…"/"Save" items + Cmd+O/Cmd+S).
//
// Succeeds the renderCustomUI-cards contract test (atlasdraw-9078): same
// assertions, now against the extracted handlers instead of dialog cards.
//   1. saveAtlasDocument calls `persistenceStore.saveToDisk(toFile(...))`
//      then `clearDirty`.
//   2. openAtlasDocument calls `persistenceStore.openFromDisk()` and on
//      success hands the loaded doc to `loadDocument(...)`.
//   3. Both no-op on a null Excalidraw API (pre-mount) or missing store.
//
// We test the exported handlers directly rather than mounting MapEditor —
// test pyramid: this file covers the contract; e2e (Playwright) covers the
// menu/keyboard plumbing.

import { describe, it, expect, vi, beforeEach } from "vitest";

import type { ExcalidrawImperativeAPI } from "@atlasdraw/excalidraw";

import type { AtlasdrawDocument } from "@atlasdraw/data";

import { saveAtlasDocument, openAtlasDocument } from "../MapEditor";

// SUT — imported AFTER all vi.mock declarations so the mocks are wired.

// ---------------------------------------------------------------------------
// Mocks — Excalidraw is imported by MapEditor.tsx but the handlers themselves
// don't need it. Mock to avoid heavy module init.
// ---------------------------------------------------------------------------

vi.mock("@atlasdraw/excalidraw", async () => {
  // Minimal runtime stubs for what MapEditor.tsx imports. MapEditor is not
  // rendered here, so these only let the import succeed.
  return {
    Excalidraw: () => null,
    MainMenu: Object.assign(() => null, {
      Item: () => null,
      Separator: () => null,
      DefaultItems: new Proxy({}, { get: () => () => null }),
    }),
    exportToCanvas: vi.fn(),
  };
});

vi.mock("@atlasdraw/basemap", () => ({
  MapCanvas: () => null,
  compileLayer: vi.fn(),
  defaultLayerStyle: vi.fn(),
  registerPmtilesProtocol: vi.fn(),
  getBasemap: vi.fn((id: string) => ({
    id,
    label: id,
    styleFile: `${id}.json`,
    requiresRemote: false,
  })),
  buildStyle: vi.fn(() =>
    Promise.resolve({ version: 8, sources: {}, layers: [] }),
  ),
  BASEMAPS: [
    {
      id: "protomaps-light",
      label: "Light",
      styleFile: "protomaps-light.json",
      requiresRemote: false,
    },
    {
      id: "protomaps-dark",
      label: "Dark",
      styleFile: "protomaps-dark.json",
      requiresRemote: false,
    },
    {
      id: "openfreemap-bright",
      label: "Bright",
      styleFile: "openfreemap-bright.json",
      requiresRemote: true,
    },
  ],
  resolveStyle: vi.fn(() =>
    Promise.resolve({ version: 8, sources: {}, layers: [] }),
  ),
  BasemapRemoteGatedError: class BasemapRemoteGatedError extends Error {
    constructor(public readonly basemapId: string) {
      super(`Basemap ${basemapId} requires allow_remote=true`);
      this.name = "BasemapRemoteGatedError";
    }
  },
}));

vi.mock("@atlasdraw/data", () => ({
  parse: vi.fn(),
  GeoJSONParseError: class {},
  requireHomogeneousGeometry: vi.fn(),
}));

vi.mock("@atlasdraw/tools", () => ({
  PinTool: { name: "pin" },
  annotationToFeatureCollection: vi.fn(),
  drawingToFeatureCollection: vi.fn(),
  elementGeometry: vi.fn(),
  UnsupportedConvertElementError: class {},
}));

// loadDocument is called from openAtlasDocument, toFile from
// saveAtlasDocument. Spy on the first; the second returns a sentinel doc.
// Resolves to an opened document, as loadDocument does.
const hydrateSpy = vi.fn(async (..._args: unknown[]) => ({}));
const sentinelDoc = {
  manifest: { id: "doc-x", layers: [] },
  scene: [],
  layers: new Map(),
} as unknown as AtlasdrawDocument;
let unsavedWork = false;
const markSavedToFileMock = vi.fn();
vi.mock("../../state/documentIO", () => ({
  loadDocument: (...args: unknown[]) => hydrateSpy(...args),
  toFile: vi.fn(() => sentinelDoc),
  hasUnsavedWork: () => unsavedWork,
  markSavedToFile: (...args: unknown[]) => markSavedToFileMock(...args),
}));

// usePersistenceStore — only `getState()` is used inside the handlers.
const saveToDiskMock = vi.fn(async (_doc: AtlasdrawDocument) => undefined);
const openFromDiskMock = vi.fn(
  async (): Promise<AtlasdrawDocument | null> => null,
);
const clearDirtyMock = vi.fn();
let storePresent = true;
vi.mock("../../state/usePersistenceStore", () => ({
  usePersistenceStore: {
    getState: () => ({
      persistenceStore: storePresent
        ? {
            saveToDisk: saveToDiskMock,
            openFromDisk: openFromDiskMock,
          }
        : null,
      clearDirty: clearDirtyMock,
      markDirty: vi.fn(),
    }),
  },
}));

// Fake imperative API — the handlers pass this to loadDocument.
// Identity is what matters; the methods are only called by selectDocument
// (mocked) so a bare object suffices.
const fakeAPI = {
  id: "fake-excalidraw-api",
} as unknown as ExcalidrawImperativeAPI;

describe("saveAtlasDocument / openAtlasDocument (single document door)", () => {
  beforeEach(() => {
    saveToDiskMock.mockClear();
    openFromDiskMock.mockClear();
    clearDirtyMock.mockClear();
    hydrateSpy.mockClear();
    markSavedToFileMock.mockClear();
    storePresent = true;
    unsavedWork = false;
  });

  it("saveAtlasDocument invokes persistenceStore.saveToDisk + clearDirty", async () => {
    await saveAtlasDocument(fakeAPI);
    expect(saveToDiskMock).toHaveBeenCalledTimes(1);
    expect(saveToDiskMock).toHaveBeenCalledWith(sentinelDoc);
    expect(clearDirtyMock).toHaveBeenCalledTimes(1);
  });

  it("openAtlasDocument invokes persistenceStore.openFromDisk and (on success) hydrate", async () => {
    const loaded = {
      manifest: { id: "doc-loaded", layers: [{ id: "l", kind: "annotation" }] },
      scene: [{ id: "el-1" }],
      layers: new Map(),
    } as unknown as AtlasdrawDocument;
    openFromDiskMock.mockResolvedValueOnce(loaded);

    await openAtlasDocument(fakeAPI);
    expect(openFromDiskMock).toHaveBeenCalledTimes(1);
    expect(hydrateSpy).toHaveBeenCalledTimes(1);
    expect(hydrateSpy).toHaveBeenCalledWith(loaded, fakeAPI);
    expect(markSavedToFileMock).toHaveBeenCalledTimes(1);
  });

  it("openAtlasDocument skips hydrate when user cancels the file picker (returns null)", async () => {
    openFromDiskMock.mockResolvedValueOnce(null);
    await openAtlasDocument(fakeAPI);
    expect(openFromDiskMock).toHaveBeenCalledTimes(1);
    expect(hydrateSpy).not.toHaveBeenCalled();
  });

  it("a save to a file marks the document saved to a file", async () => {
    await saveAtlasDocument(fakeAPI);
    expect(markSavedToFileMock).toHaveBeenCalledTimes(1);
  });

  it("asks before Open replaces unsaved work, and opens nothing on No", async () => {
    unsavedWork = true;
    const confirmReplace = vi.fn(async () => false);

    await openAtlasDocument(fakeAPI, undefined, confirmReplace);

    expect(confirmReplace).toHaveBeenCalledTimes(1);
    expect(openFromDiskMock).not.toHaveBeenCalled();
  });

  it("opens after a Yes", async () => {
    unsavedWork = true;
    const confirmReplace = vi.fn(async () => true);

    await openAtlasDocument(fakeAPI, undefined, confirmReplace);

    expect(openFromDiskMock).toHaveBeenCalledTimes(1);
  });

  it("does not ask when there is no unsaved work", async () => {
    const confirmReplace = vi.fn(async () => false);

    await openAtlasDocument(fakeAPI, undefined, confirmReplace);

    expect(confirmReplace).not.toHaveBeenCalled();
    expect(openFromDiskMock).toHaveBeenCalledTimes(1);
  });

  it("both handlers no-op when the Excalidraw API is not yet available", async () => {
    await saveAtlasDocument(null);
    await openAtlasDocument(null);
    expect(saveToDiskMock).not.toHaveBeenCalled();
    expect(openFromDiskMock).not.toHaveBeenCalled();
  });

  it("both handlers no-op when the persistence store is absent", async () => {
    storePresent = false;
    await saveAtlasDocument(fakeAPI);
    await openAtlasDocument(fakeAPI);
    expect(saveToDiskMock).not.toHaveBeenCalled();
    expect(openFromDiskMock).not.toHaveBeenCalled();
  });
});
