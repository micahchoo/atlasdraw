// SPDX-License-Identifier: AGPL-3.0-only
// Phase 3 Wave 2 Task T9 — selectDocument unit tests.
// Phase 4 W0 update (atlasdraw-ad27): adds an FC-store integration test.

import { beforeEach, describe, expect, it, vi } from "vitest";
import type { FeatureCollection } from "geojson";

import { selectDocument } from "./selectDocument";
import type { LayerRegistryState } from "./layerRegistry";
import { useDataLayerFCStore } from "./useDataLayerFCStore";
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

// FC store is a module-singleton — reset per test so we can't accidentally
// inherit fcs registered by another test file in the same vitest worker.
beforeEach(() => {
  useDataLayerFCStore.getState().clear();
});

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

  it("layers Map is empty when no data layers exist (annotation-only registry)", () => {
    const reg = makeRegistry([
      { kind: "annotation", id: "el-1", label: "p", visible: true, order: 0 },
    ]);
    const doc = selectDocument(makeAPI(), reg, { now: () => NOW });
    expect(doc.layers).toBeInstanceOf(Map);
    expect(doc.layers.size).toBe(0);
  });

  it("populates layers Map from FC store for matching data-layer entries (Phase 4 W0)", () => {
    // The data layer is in BOTH the registry AND the FC store. selectDocument
    // intersects them and emits a Map keyed by `dl:` id with the FC payload.
    const fc: FeatureCollection = {
      type: "FeatureCollection",
      features: [
        {
          type: "Feature",
          properties: { name: "Trail A" },
          geometry: { type: "LineString", coordinates: [[0, 0], [1, 1]] },
        },
      ],
    };
    const reg = makeRegistry([
      {
        kind: "annotation",
        id: "el-skip",
        label: "skipped",
        visible: true,
        order: 0,
      },
      {
        kind: "data",
        id: "dl:trails-1",
        label: "Trails",
        visible: true,
        order: 1,
        featureCount: 1,
        style: { fillColor: "#000", strokeColor: "#000", strokeWidth: 1, opacity: 1 },
      },
    ]);

    const doc = selectDocument(makeAPI(), reg, {
      now: () => NOW,
      fcMap: { "dl:trails-1": fc },
    });

    // Annotation entries are excluded from the layers Map; only data entries
    // present in the FC source land in the result.
    expect(doc.layers.size).toBe(1);
    expect(doc.layers.get("dl:trails-1")).toBe(fc);
    expect(doc.layers.has("el-skip")).toBe(false);
  });

  it("defaults to reading from the live FC store when fcMap is not provided", () => {
    // Demonstrates the production wiring path: registry actions push to the
    // FC store; selectDocument reads the singleton implicitly.
    const fc: FeatureCollection = {
      type: "FeatureCollection",
      features: [],
    };
    useDataLayerFCStore.getState().set("dl:from-store", fc);

    const reg = makeRegistry([
      {
        kind: "data",
        id: "dl:from-store",
        label: "Live",
        visible: true,
        order: 0,
        featureCount: 0,
        style: { fillColor: "#000", strokeColor: "#000", strokeWidth: 1, opacity: 1 },
      },
    ]);

    const doc = selectDocument(makeAPI(), reg, { now: () => NOW });
    expect(doc.layers.get("dl:from-store")).toBe(fc);
  });

  it("omits a data-layer from the layers Map when its FC is missing (load-in-flight tolerance)", () => {
    // Registry has the entry but FC store does not (e.g. mid-load). selectDocument
    // omits it from layers rather than inserting a stub; the manifest layer
    // list still records the metadata, so the next tick can pick it up.
    const reg = makeRegistry([
      {
        kind: "data",
        id: "dl:not-yet-loaded",
        label: "pending",
        visible: true,
        order: 0,
        featureCount: 5,
        style: { fillColor: "#000", strokeColor: "#000", strokeWidth: 1, opacity: 1 },
      },
    ]);

    const doc = selectDocument(makeAPI(), reg, {
      now: () => NOW,
      fcMap: {},
    });
    expect(doc.layers.size).toBe(0);
    expect(doc.manifest.layers).toHaveLength(1); // metadata still present
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
