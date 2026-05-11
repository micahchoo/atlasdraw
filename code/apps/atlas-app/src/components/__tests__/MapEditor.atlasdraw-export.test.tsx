// SPDX-License-Identifier: AGPL-3.0-only
// atlasdraw-9078 (Phase 4 Wave 0 prereq) — unify atlasdraw export menu.
//
// Verifies the renderCustomUI cards that replaced the adjacent
// `<MainMenu.Item>` Save/Open .atlasdraw entries:
//   1. The cards render with the expected data-testids ('atlasdraw-export-save',
//      'atlasdraw-export-open', plus the pre-existing 'geojson-export-download').
//   2. Clicking Save calls `persistenceStore.saveToDisk(selectDocument(...))`.
//   3. Clicking Open calls `persistenceStore.openFromDisk()` and on success
//      hands the loaded doc to `hydrate(...)`.
//
// We test the pure helper `renderAtlasdrawExportCards` directly rather than
// mounting MapEditor — Excalidraw's JSONExportDialog is what calls this
// function in production, and we don't have a clean way to drive that dialog
// open in a unit test. Test pyramid: this file covers the contract; an e2e
// test (Playwright) covers the dialog plumbing.

import React from "react";
import { describe, it, expect, vi, beforeEach, afterEach } from "vitest";
import { render, fireEvent, cleanup } from "@testing-library/react";
import type { ExcalidrawImperativeAPI } from "@excalidraw/excalidraw";
import type { AtlasdrawDocument } from "@atlasdraw/data";

// ---------------------------------------------------------------------------
// Mocks — Excalidraw is imported by MapEditor.tsx but renderAtlasdrawExport
// Cards itself doesn't need it. Mock to avoid heavy module init.
// ---------------------------------------------------------------------------

vi.mock("@excalidraw/excalidraw", async () => {
  // Pass through the type-only import; provide minimal runtime stubs for
  // anything MapEditor.tsx evaluates at module load (setExportElementTransformer
  // is called in a useEffect, but MapEditor isn't rendered here so this is
  // purely about getting the import to succeed).
  return {
    Excalidraw: () => null,
    MainMenu: Object.assign(() => null, {
      Item: () => null,
      Separator: () => null,
      DefaultItems: new Proxy({}, { get: () => () => null }),
    }),
    setExportElementTransformer: vi.fn(),
    exportToCanvas: vi.fn(),
  };
});

vi.mock("@atlasdraw/basemap", () => ({
  MapCanvas: () => null,
  compileLayer: vi.fn(),
  defaultLayerStyle: vi.fn(),
  registerPmtilesProtocol: vi.fn(),
  getBasemap: vi.fn((id: string) =>
    ({ id, label: id, styleFile: `${id}.json`, requiresRemote: false }),
  ),
  buildStyle: vi.fn(() => Promise.resolve({ version: 8, sources: {}, layers: [] })),
  BASEMAPS: [
    { id: "protomaps-light", label: "Light", styleFile: "protomaps-light.json", requiresRemote: false },
    { id: "protomaps-dark", label: "Dark", styleFile: "protomaps-dark.json", requiresRemote: false },
    { id: "openfreemap-bright", label: "Bright", styleFile: "openfreemap-bright.json", requiresRemote: true },
  ],
  resolveStyle: vi.fn(() => Promise.resolve({ version: 8, sources: {}, layers: [] })),
  BasemapRemoteGatedError: class BasemapRemoteGatedError extends Error { constructor(public readonly basemapId: string) { super(`Basemap ${basemapId} requires allow_remote=true`); this.name = "BasemapRemoteGatedError"; } },
}));

vi.mock("@atlasdraw/data", () => ({
  parse: vi.fn(),
  GeoJSONParseError: class {},
  requireHomogeneousGeometry: vi.fn(),
}));

vi.mock("@atlasdraw/tools", () => ({
  PinTool: { name: "pin" },
  annotationToFeatureCollection: vi.fn(),
  UnsupportedConvertElementError: class {},
}));

vi.mock("@atlasdraw/geo", () => ({
  isGeoCustomData: () => false,
  normalizeElementsForExport: vi.fn(),
}));

// hydrate is called from the Open card. Spy on it.
const hydrateSpy = vi.fn();
vi.mock("../../state/hydrate", () => ({ hydrate: (...args: unknown[]) => hydrateSpy(...args) }));

// selectDocument is called from the Save card. Returns a sentinel doc.
const sentinelDoc = {
  manifest: { id: "doc-x", layers: [] },
  scene: [],
  layers: new Map(),
} as unknown as AtlasdrawDocument;
vi.mock("../../state/selectDocument", () => ({
  selectDocument: vi.fn(() => sentinelDoc),
}));

// usePersistenceStore — only `getState()` is used inside the cards.
const saveToDiskMock = vi.fn(async (_doc: AtlasdrawDocument) => undefined);
const openFromDiskMock = vi.fn(async (): Promise<AtlasdrawDocument | null> => null);
const clearDirtyMock = vi.fn();
vi.mock("../../state/usePersistenceStore", () => ({
  usePersistenceStore: {
    getState: () => ({
      persistenceStore: {
        saveToDisk: saveToDiskMock,
        openFromDisk: openFromDiskMock,
      },
      clearDirty: clearDirtyMock,
    }),
  },
}));

// useLayerRegistryStore — `getState()` is read by the Save card via
// selectDocument; the mocked selectDocument ignores its arg, so a stub is fine.
vi.mock("../../state/layerRegistry", () => ({
  useLayerRegistryStore: { getState: () => ({}) },
}));

// SUT — imported AFTER all vi.mock declarations so the mocks are wired.
import { renderAtlasdrawExportCards } from "../MapEditor";

// Fake imperative API — the cards capture this in their closures and pass
// it to selectDocument / hydrate. Identity is what matters; the methods are
// only called by selectDocument (mocked) so a bare object suffices.
const fakeAPI = { id: "fake-excalidraw-api" } as unknown as ExcalidrawImperativeAPI;

describe("renderAtlasdrawExportCards (atlasdraw-9078)", () => {
  beforeEach(() => {
    saveToDiskMock.mockClear();
    openFromDiskMock.mockClear();
    clearDirtyMock.mockClear();
    hydrateSpy.mockClear();
  });

  afterEach(() => cleanup());

  it("renders all three export cards with the expected data-testids", () => {
    const { getByTestId } = render(renderAtlasdrawExportCards([], fakeAPI));
    expect(getByTestId("atlasdraw-export-save")).toBeTruthy();
    expect(getByTestId("atlasdraw-export-open")).toBeTruthy();
    // GeoJSON card disabled when no geo-anchored elements but still rendered.
    expect(getByTestId("geojson-export-download")).toBeTruthy();
  });

  it("Save card click invokes persistenceStore.saveToDisk + clearDirty", async () => {
    const { getByTestId } = render(renderAtlasdrawExportCards([], fakeAPI));
    fireEvent.click(getByTestId("atlasdraw-export-save"));
    // saveToDisk is async — flush microtasks.
    await Promise.resolve();
    await Promise.resolve();
    expect(saveToDiskMock).toHaveBeenCalledTimes(1);
    expect(saveToDiskMock).toHaveBeenCalledWith(sentinelDoc);
    expect(clearDirtyMock).toHaveBeenCalledTimes(1);
  });

  it("Open card click invokes persistenceStore.openFromDisk and (on success) hydrate", async () => {
    const loaded = {
      manifest: { id: "doc-loaded", layers: [{ id: "l", kind: "annotation" }] },
      scene: [{ id: "el-1" }],
      layers: new Map(),
    } as unknown as AtlasdrawDocument;
    openFromDiskMock.mockResolvedValueOnce(loaded);

    const { getByTestId } = render(renderAtlasdrawExportCards([], fakeAPI));
    fireEvent.click(getByTestId("atlasdraw-export-open"));
    // Two ticks: one for openFromDisk's await, one for hydrate.
    await Promise.resolve();
    await Promise.resolve();
    expect(openFromDiskMock).toHaveBeenCalledTimes(1);
    expect(hydrateSpy).toHaveBeenCalledTimes(1);
    expect(hydrateSpy).toHaveBeenCalledWith(loaded, fakeAPI);
  });

  it("Open card click skips hydrate when user cancels the file picker (returns null)", async () => {
    openFromDiskMock.mockResolvedValueOnce(null);
    const { getByTestId } = render(renderAtlasdrawExportCards([], fakeAPI));
    fireEvent.click(getByTestId("atlasdraw-export-open"));
    await Promise.resolve();
    await Promise.resolve();
    expect(openFromDiskMock).toHaveBeenCalledTimes(1);
    expect(hydrateSpy).not.toHaveBeenCalled();
  });
});
