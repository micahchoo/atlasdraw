// SPDX-License-Identifier: AGPL-3.0-only
// Phase 3 Wave 2 Task T9 — selectDocument unit tests.

import { describe, expect, it, vi } from "vitest";

import { selectDocument } from "./selectDocument";
import type { LayerRegistryState } from "./layerRegistry";
import type { ExcalidrawImperativeAPI } from "@excalidraw/excalidraw";
import type { Manifest } from "@atlasdraw/data";

// ---------------------------------------------------------------------------
// Fixtures
// ---------------------------------------------------------------------------

const NOW = "2026-05-06T12:00:00.000Z";

const makeAPI = (
  overrides: Partial<{
    elements: unknown[];
    files: Record<string, { dataURL: string; mimeType: string }>;
  }> = {},
): ExcalidrawImperativeAPI => {
  const elements = overrides.elements ?? [];
  const files = overrides.files ?? {};
  return {
    getSceneElements: vi.fn(() => elements),
    getAppState: vi.fn(() => ({})),
    getFiles: vi.fn(() => files),
  } as unknown as ExcalidrawImperativeAPI;
};

const makeRegistry = (
  entries: LayerRegistryState["entries"] = [],
): LayerRegistryState =>
  ({
    entries,
    registerAnnotation: vi.fn(),
    registerDataLayer: vi.fn(),
    convertAnnotationToDataLayer: vi.fn(),
    setVisibility: vi.fn(),
    reorder: vi.fn(),
    updateStyle: vi.fn(),
    remove: vi.fn(),
  }) as unknown as LayerRegistryState;

// ---------------------------------------------------------------------------
// Tests
// ---------------------------------------------------------------------------

describe("selectDocument", () => {
  it("mints a new ULID manifest when no baseManifest is provided", () => {
    const api = makeAPI();
    const reg = makeRegistry();
    const doc = selectDocument(api, reg, { now: () => NOW });

    expect(doc.manifest.version).toBe(1);
    expect(doc.manifest.createdAt).toBe(NOW);
    expect(doc.manifest.updatedAt).toBe(NOW);
    expect(doc.manifest.title).toBe("Untitled atlasdraw");
    expect(doc.manifest.basemap).toEqual({ type: "registry", id: "default" });
    expect(doc.manifest.layers).toEqual([]);
    // ULID = 26 chars in Crockford base32.
    expect(doc.manifest.id).toMatch(/^[0-9A-HJKMNP-TV-Z]{26}$/);
  });

  it("preserves base manifest id + createdAt, refreshes updatedAt", () => {
    const base: Manifest = {
      id: "01J0000000000000000000000A",
      version: 1,
      title: "My atlas",
      createdAt: "2026-01-01T00:00:00.000Z",
      updatedAt: "2026-01-01T00:00:00.000Z",
      basemap: { type: "registry", id: "satellite" },
      camera: { center: [-122.4, 37.78], zoom: 10, bearing: 0, pitch: 0 },
      layers: [],
      permissions: { publicView: false },
    };

    const api = makeAPI();
    const reg = makeRegistry();
    const doc = selectDocument(api, reg, { baseManifest: base, now: () => NOW });

    expect(doc.manifest.id).toBe(base.id);
    expect(doc.manifest.title).toBe("My atlas");
    expect(doc.manifest.createdAt).toBe(base.createdAt);
    expect(doc.manifest.updatedAt).toBe(NOW);
    expect(doc.manifest.basemap.id).toBe("satellite");
  });

  it("captures Excalidraw scene elements unchanged", () => {
    const elements = [{ id: "el-1", type: "rectangle" }];
    const api = makeAPI({ elements });
    const reg = makeRegistry();
    const doc = selectDocument(api, reg, { now: () => NOW });

    expect(doc.scene).toBe(elements);
  });

  it("maps layer registry entries into the manifest layer list", () => {
    const reg = makeRegistry([
      {
        kind: "annotation",
        id: "el-abc",
        label: "Pin 1",
        visible: true,
        order: 0,
      },
      {
        kind: "data",
        id: "dl:abc-123",
        label: "Trails",
        visible: false,
        order: 1,
        featureCount: 42,
        style: { fillColor: "#0aa", strokeColor: "#077", strokeWidth: 1, opacity: 0.5 },
      },
    ]);
    const doc = selectDocument(makeAPI(), reg, { now: () => NOW });

    expect(doc.manifest.layers).toHaveLength(2);
    expect(doc.manifest.layers[0]).toEqual({
      kind: "annotation",
      id: "el-abc",
      label: "Pin 1",
      visible: true,
    });
    expect(doc.manifest.layers[1]).toMatchObject({
      kind: "data",
      id: "dl:abc-123",
      label: "Trails",
      visible: false,
      featureCount: 42,
      source: "data/layer-dl:abc-123.geojson",
    });
  });

  it("layers Map is empty for v1 (FC storage gap documented)", () => {
    const doc = selectDocument(makeAPI(), makeRegistry(), { now: () => NOW });
    expect(doc.layers).toBeInstanceOf(Map);
    expect(doc.layers.size).toBe(0);
  });

  it("converts Excalidraw binary files (dataURL) into Blob entries", () => {
    // 1x1 transparent PNG (base64).
    const dataURL =
      "data:image/png;base64,iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAQAAAC1HAwCAAAAC0lEQVR42mNkYAAAAAYAAjCB0C8AAAAASUVORK5CYII=";
    const api = makeAPI({
      files: { "img-1": { dataURL, mimeType: "image/png" } },
    });
    const doc = selectDocument(api, makeRegistry(), { now: () => NOW });

    expect(doc.files.size).toBe(1);
    const blob = doc.files.get("img-1");
    expect(blob).toBeInstanceOf(Blob);
    expect(blob!.type).toBe("image/png");
  });

  it("survives a malformed dataURL (skips file rather than throwing)", () => {
    const api = makeAPI({
      files: { "broken": { dataURL: "not-a-data-url", mimeType: "image/png" } },
    });
    const doc = selectDocument(api, makeRegistry(), { now: () => NOW });
    expect(doc.files.size).toBe(0);
  });
});
