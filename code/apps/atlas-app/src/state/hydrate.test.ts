// SPDX-License-Identifier: AGPL-3.0-only
// Phase 4 Wave 0 prereq (atlasdraw-3601) — hydrate() unit tests.

import { beforeEach, describe, expect, it, vi } from "vitest";
import type { FeatureCollection } from "geojson";

import type {
  AtlasdrawDocument,
  Manifest,
  SceneElement,
} from "@atlasdraw/data";
import type { ExcalidrawImperativeAPI } from "@excalidraw/excalidraw";

import { hydrate } from "./hydrate";
import { useLayerRegistryStore } from "./layerRegistry";
import { useDataLayerFCStore } from "./useDataLayerFCStore";
import { usePersistenceStore } from "./usePersistenceStore";
import { selectDocument } from "./selectDocument";

// ---------------------------------------------------------------------------
// Fixtures
// ---------------------------------------------------------------------------

const VALID_ULID = "01HZ8KQR5Z3MV7BJ4N6XPYD9TF";

const baseManifest = (
  overrides: Partial<Manifest> = {},
): Manifest => ({
  id: VALID_ULID,
  version: 1,
  title: "hydrate fixture",
  createdAt: "2026-05-06T00:00:00.000Z",
  updatedAt: "2026-05-06T00:00:00.000Z",
  basemap: { type: "registry", id: "default" },
  camera: { center: [0, 0], zoom: 4, bearing: 0, pitch: 0 },
  layers: [],
  permissions: { publicView: false },
  ...overrides,
});

const sampleFC: FeatureCollection = {
  type: "FeatureCollection",
  features: [
    {
      type: "Feature",
      geometry: { type: "Point", coordinates: [10, 20] },
      properties: { name: "p1" },
    },
  ],
};

const makeAPI = (): {
  api: ExcalidrawImperativeAPI;
  updateScene: ReturnType<typeof vi.fn>;
} => {
  const updateScene = vi.fn();
  const elementsRef: { current: ReadonlyArray<unknown> } = { current: [] };
  const api = {
    updateScene: vi.fn((opts: { elements?: ReadonlyArray<unknown> }) => {
      elementsRef.current = opts.elements ?? [];
      updateScene(opts);
    }),
    getSceneElements: vi.fn(() => elementsRef.current),
    getAppState: vi.fn(() => ({})),
    getFiles: vi.fn(() => ({})),
    addFiles: vi.fn(),
  } as unknown as ExcalidrawImperativeAPI;
  return { api, updateScene };
};

const sceneEl = (id: string, type = "rectangle"): SceneElement => ({
  id,
  type,
  version: 1,
  x: 0,
  y: 0,
});

// ---------------------------------------------------------------------------
// Setup
// ---------------------------------------------------------------------------

beforeEach(() => {
  // Module singletons — wipe per test.
  useDataLayerFCStore.getState().clear();
  // Registry: drop any entries from prior tests.
  const reg = useLayerRegistryStore.getState();
  for (const id of reg.entries.map((e) => e.id)) reg.remove(id);
  usePersistenceStore.setState({ isDirty: false });
});

// ---------------------------------------------------------------------------
// Tests
// ---------------------------------------------------------------------------

describe("hydrate", () => {
  it("calls updateScene with the loaded scene elements", () => {
    const { api } = makeAPI();
    const scene: ReadonlyArray<SceneElement> = [sceneEl("el-1"), sceneEl("el-2", "text")];
    const loaded: AtlasdrawDocument = {
      manifest: baseManifest(),
      scene,
      layers: new Map(),
      styleRef: {},
      files: new Map(),
    };

    hydrate(loaded, api);

    expect(api.updateScene).toHaveBeenCalledTimes(1);
    expect(api.updateScene).toHaveBeenCalledWith({ elements: scene });
  });

  it("registers annotation layers from the manifest", () => {
    const { api } = makeAPI();
    const loaded: AtlasdrawDocument = {
      manifest: baseManifest({
        layers: [
          { kind: "annotation", id: "anno-1", label: "Notes", visible: true },
        ],
      }),
      scene: [],
      layers: new Map(),
      styleRef: {},
      files: new Map(),
    };

    hydrate(loaded, api);

    const entries = useLayerRegistryStore.getState().entries;
    expect(entries).toHaveLength(1);
    expect(entries[0]).toMatchObject({
      kind: "annotation",
      id: "anno-1",
      label: "Notes",
      visible: true,
    });
  });

  it("registers data layers and seeds the FC store", () => {
    const { api } = makeAPI();
    const loaded: AtlasdrawDocument = {
      manifest: baseManifest({
        layers: [
          {
            kind: "data",
            id: "dl:cities",
            label: "Cities",
            visible: true,
            featureCount: 1,
            style: { fillColor: "#0aa" },
            source: "data/layer-dl:cities.geojson",
          },
        ],
      }),
      scene: [],
      layers: new Map([["dl:cities", sampleFC]]),
      styleRef: {},
      files: new Map(),
    };

    hydrate(loaded, api);

    const entries = useLayerRegistryStore.getState().entries;
    expect(entries).toHaveLength(1);
    expect(entries[0]).toMatchObject({ kind: "data", id: "dl:cities", label: "Cities" });
    expect(useDataLayerFCStore.getState().get("dl:cities")).toEqual(sampleFC);
  });

  it("preserves visible=false from the manifest after register stamps true", () => {
    const { api } = makeAPI();
    const loaded: AtlasdrawDocument = {
      manifest: baseManifest({
        layers: [
          { kind: "annotation", id: "hidden", label: "h", visible: false },
        ],
      }),
      scene: [],
      layers: new Map(),
      styleRef: {},
      files: new Map(),
    };

    hydrate(loaded, api);

    const entry = useLayerRegistryStore.getState().entries[0];
    expect(entry?.visible).toBe(false);
  });

  it("clears prior registry + FC entries before applying the loaded doc", () => {
    const { api } = makeAPI();

    // Pre-populate as if the user had imported layers before hitting Open.
    useLayerRegistryStore.getState().registerDataLayer({
      id: "dl:stale",
      fc: sampleFC,
      label: "stale",
      style: { fillColor: "#000" },
    });
    useLayerRegistryStore
      .getState()
      .registerAnnotation("anno-stale", "stale-anno");
    expect(useLayerRegistryStore.getState().entries).toHaveLength(2);
    expect(useDataLayerFCStore.getState().get("dl:stale")).toBeDefined();

    const loaded: AtlasdrawDocument = {
      manifest: baseManifest({
        layers: [
          { kind: "annotation", id: "fresh", label: "Fresh", visible: true },
        ],
      }),
      scene: [],
      layers: new Map(),
      styleRef: {},
      files: new Map(),
    };

    hydrate(loaded, api);

    const entries = useLayerRegistryStore.getState().entries;
    expect(entries).toHaveLength(1);
    expect(entries[0]?.id).toBe("fresh");
    expect(useDataLayerFCStore.getState().get("dl:stale")).toBeUndefined();
  });

  it("resets isDirty=false after hydration (microtask-deferred)", async () => {
    const { api } = makeAPI();
    // Pre-mark dirty to prove the reset actually runs.
    usePersistenceStore.setState({ isDirty: true });
    const loaded: AtlasdrawDocument = {
      manifest: baseManifest(),
      scene: [],
      layers: new Map(),
      styleRef: {},
      files: new Map(),
    };

    hydrate(loaded, api);
    // Flush the microtask queue.
    await Promise.resolve();

    expect(usePersistenceStore.getState().isDirty).toBe(false);
  });

  it("skips data-layer entries whose FC is missing from the doc", () => {
    const { api } = makeAPI();
    const warn = vi.spyOn(console, "warn").mockImplementation(() => {});
    const loaded: AtlasdrawDocument = {
      manifest: baseManifest({
        layers: [
          {
            kind: "data",
            id: "dl:orphan",
            label: "Orphan",
            visible: true,
            featureCount: 0,
            style: {},
            source: "data/layer-dl:orphan.geojson",
          },
        ],
      }),
      scene: [],
      layers: new Map(), // FC missing
      styleRef: {},
      files: new Map(),
    };

    hydrate(loaded, api);

    expect(useLayerRegistryStore.getState().entries).toHaveLength(0);
    expect(warn).toHaveBeenCalled();
    warn.mockRestore();
  });
});

// ---------------------------------------------------------------------------
// Round-trip — hydrate( selectDocument(...) ) approximates identity.
// ---------------------------------------------------------------------------

describe("hydrate ∘ selectDocument round-trip", () => {
  it("re-applies a snapshot taken from a populated registry", () => {
    // Seed a registry + FC store as if the user had imported a layer.
    const reg = useLayerRegistryStore.getState();
    reg.registerDataLayer({
      id: "dl:source-of-truth",
      fc: sampleFC,
      label: "Cities",
      style: { fillColor: "#fff" },
    });
    reg.registerAnnotation("anno-1", "Note");

    const sceneElements: ReadonlyArray<SceneElement> = [sceneEl("el-A")];
    const { api } = makeAPI();
    (api.getSceneElements as ReturnType<typeof vi.fn>).mockReturnValue(sceneElements);

    // Snapshot.
    const snap = selectDocument(api, useLayerRegistryStore.getState());

    // Wipe live state and rehydrate.
    for (const id of useLayerRegistryStore.getState().entries.map((e) => e.id)) {
      useLayerRegistryStore.getState().remove(id);
    }
    expect(useLayerRegistryStore.getState().entries).toHaveLength(0);

    const { api: api2 } = makeAPI();
    hydrate(snap, api2);

    // Registry shape matches.
    const restored = useLayerRegistryStore.getState().entries;
    expect(restored.map((e) => e.id).sort()).toEqual(
      ["anno-1", "dl:source-of-truth"].sort(),
    );
    // FC store has the data layer's payload.
    expect(useDataLayerFCStore.getState().get("dl:source-of-truth")).toEqual(
      sampleFC,
    );
    // Excalidraw received the scene.
    expect(api2.updateScene).toHaveBeenCalledWith({ elements: sceneElements });
  });
});
