// SPDX-License-Identifier: AGPL-3.0-only
//
// Known-red tests for the map-overlay defects in the 2026-10 architecture
// audit (audit-04, map side). Each `it.fails` states the CORRECT behaviour
// and fails on today's code. The W5 map-overlay wave flips each to `it()`.
//
// The map here is `FakeMapLibre`, not a call recorder. It keeps the style
// state MapLibre 4.7.1 keeps (sources, layers, paint, layout, order) and
// follows its error contract, read from maplibre-gl-dev.js 4.7.1:
//   - addLayer / setPaintProperty / setLayoutProperty / moveLayer /
//     removeLayer on an invalid spec or a missing layer FIRE an "error" event
//     and return. They do not throw (Style#addLayer :44860, :45045, :45071).
//   - addSource on a duplicate id and removeSource on a missing id THROW.
//   - removeSource while a layer uses the source fires "error" and returns.
// Validation uses the real @maplibre/maplibre-gl-style-spec validator, so a
// spec this fake accepts is one MapLibre accepts. Every assertion reads the
// resulting style state.

import { afterEach, beforeEach, describe, expect, it } from "vitest";
import {
  act,
  cleanup,
  fireEvent,
  render,
  renderHook,
  screen,
} from "@testing-library/react";
import { validateStyleMin } from "@maplibre/maplibre-gl-style-spec";

import type { AtlasdrawDocument, Manifest } from "@atlasdraw/data";

import type { ExcalidrawImperativeAPI } from "@atlasdraw/excalidraw";

import { useLayerRegistrySync } from "../useLayerRegistrySync";
import { useLayerRegistryStore } from "../../state/layerRegistry";
import { useDataLayerFCStore } from "../../state/useDataLayerFCStore";
import { useRasterImageStore } from "../../state/useRasterImageStore";
import { hydrate } from "../../state/hydrate";
import { reconcileDataLayers } from "../../lib/dataLayerRender";
import { LayerPanel } from "../../components/LayerPanel";
import { StylePanel } from "../../components/StylePanel";
import { ToastProvider } from "../../components/ToastProvider";
import { AriaAnnouncer } from "../../components/AriaAnnouncer";

import type { StyleSpecification } from "@maplibre/maplibre-gl-style-spec";

import type { FeatureCollection } from "geojson";
import type maplibregl from "maplibre-gl";
import type { RasterCorners } from "../../state/layerRegistry";

// ---------------------------------------------------------------------------
// FakeMapLibre — style state + the 4.7.1 error contract
// ---------------------------------------------------------------------------

type LayerState = {
  spec: Record<string, unknown>;
  paint: Record<string, unknown>;
  layout: Record<string, unknown>;
};

type ErrorListener = (e: { error: Error }) => void;

class FakeMapLibre {
  readonly sources = new Map<string, Record<string, unknown>>();
  readonly layers = new Map<string, LayerState>();
  /** Bottom-first, like Style#_order. */
  readonly order: string[] = [];
  readonly errors: string[] = [];
  private readonly errorListeners = new Set<ErrorListener>();

  on(type: string, fn: ErrorListener): this {
    if (type === "error") {
      this.errorListeners.add(fn);
    }
    return this;
  }

  off(type: string, fn: ErrorListener): this {
    if (type === "error") {
      this.errorListeners.delete(fn);
    }
    return this;
  }

  private fire(message: string): void {
    this.errors.push(message);
    for (const fn of this.errorListeners) {
      fn({ error: new Error(message) });
    }
  }

  private validateLayer(spec: Record<string, unknown>): string[] {
    const style = {
      version: 8,
      sources: Object.fromEntries(this.sources),
      layers: [spec],
    } as unknown as StyleSpecification;
    return validateStyleMin(style).map((e) => e.message);
  }

  addSource(id: string, spec: Record<string, unknown>): void {
    if (this.sources.has(id)) {
      throw new Error(`Source "${id}" already exists.`);
    }
    const errs = validateStyleMin({
      version: 8,
      sources: { [id]: spec },
      layers: [],
    } as unknown as StyleSpecification).map((e) => e.message);
    if (errs.length > 0) {
      errs.forEach((m) => this.fire(m));
      return;
    }
    this.sources.set(id, spec);
  }

  getSource(id: string): unknown {
    return this.sources.get(id);
  }

  removeSource(id: string): void {
    if (!this.sources.has(id)) {
      throw new Error("There is no source with this ID");
    }
    for (const [layerId, layer] of this.layers) {
      if (layer.spec.source === id) {
        this.fire(
          `Source "${id}" cannot be removed while layer "${layerId}" is using it.`,
        );
        return;
      }
    }
    this.sources.delete(id);
  }

  addLayer(spec: Record<string, unknown>, before?: string): void {
    const id = spec.id as string;
    if (this.layers.has(id)) {
      this.fire(`Layer "${id}" already exists on this map.`);
      return;
    }
    const errs = this.validateLayer(spec);
    if (errs.length > 0) {
      errs.forEach((m) => this.fire(m));
      return;
    }
    const index = before ? this.order.indexOf(before) : this.order.length;
    if (before && index === -1) {
      this.fire(
        `Cannot add layer "${id}" before non-existing layer "${before}".`,
      );
      return;
    }
    this.order.splice(index, 0, id);
    this.layers.set(id, {
      spec,
      paint: { ...((spec.paint as Record<string, unknown>) ?? {}) },
      layout: { ...((spec.layout as Record<string, unknown>) ?? {}) },
    });
  }

  getLayer(id: string): unknown {
    return this.layers.get(id)?.spec;
  }

  removeLayer(id: string): void {
    if (!this.layers.has(id)) {
      this.fire(`Cannot remove non-existing layer "${id}".`);
      return;
    }
    this.layers.delete(id);
    this.order.splice(this.order.indexOf(id), 1);
  }

  moveLayer(id: string, before?: string): void {
    if (!this.layers.has(id)) {
      this.fire(
        `The layer '${id}' does not exist in the map's style and cannot be moved.`,
      );
      return;
    }
    if (id === before) {
      return;
    }
    this.order.splice(this.order.indexOf(id), 1);
    const index = before ? this.order.indexOf(before) : this.order.length;
    if (before && index === -1) {
      this.fire(
        `Cannot move layer "${id}" before non-existing layer "${before}".`,
      );
      return;
    }
    this.order.splice(index, 0, id);
  }

  getLayersOrder(): string[] {
    return [...this.order];
  }

  private setProperty(
    bucket: "paint" | "layout",
    layerId: string,
    name: string,
    value: unknown,
  ): void {
    const layer = this.layers.get(layerId);
    if (!layer) {
      this.fire(`Cannot style non-existing layer "${layerId}".`);
      return;
    }
    const candidate = {
      ...layer.spec,
      paint: layer.paint,
      layout: layer.layout,
      [bucket]: { ...layer[bucket], [name]: value },
    };
    const errs = this.validateLayer(candidate);
    if (errs.length > 0) {
      errs.forEach((m) => this.fire(m));
      return;
    }
    layer[bucket][name] = value;
  }

  setPaintProperty(layerId: string, name: string, value: unknown): void {
    this.setProperty("paint", layerId, name, value);
  }

  setLayoutProperty(layerId: string, name: string, value: unknown): void {
    this.setProperty("layout", layerId, name, value);
  }

  getLayoutProperty(layerId: string, name: string): unknown {
    return this.layers.get(layerId)?.layout[name];
  }

  /** True when a layer AND its source are in the style. */
  draws(id: string): boolean {
    return this.layers.has(id) && this.sources.has(id);
  }

  /** Same-named overlay ids, top of the stack first. */
  topFirst(ids: readonly string[]): string[] {
    const wanted = new Set(ids);
    return this.order.filter((id) => wanted.has(id)).reverse();
  }
}

const asMap = (m: FakeMapLibre) => m as unknown as maplibregl.Map;

// ---------------------------------------------------------------------------
// FakeExcalidraw — a scene that fires onChange on updateScene
// ---------------------------------------------------------------------------

type Element = {
  id: string;
  type: string;
  version: number;
  isDeleted?: boolean;
  opacity?: number;
};

function fakeExcalidraw(initial: Element[] = []) {
  let elements: Element[] = initial;
  const listeners = new Set<(els: readonly Element[]) => void>();
  const api = {
    getSceneElements: () => elements.filter((e) => !e.isDeleted),
    getSceneElementsIncludingDeleted: () => elements,
    getAppState: () => ({ selectedElementIds: {} }),
    getFiles: () => ({}),
    updateScene: (opts: { elements?: readonly Element[] }) => {
      if (opts.elements) {
        elements = [...opts.elements];
      }
      for (const fn of listeners) {
        fn(elements);
      }
    },
    onChange: (fn: (els: readonly Element[]) => void) => {
      listeners.add(fn);
      return () => listeners.delete(fn);
    },
  };
  return {
    api: api as unknown as ExcalidrawImperativeAPI,
    live: () => elements.filter((e) => !e.isDeleted).map((e) => e.id),
  };
}

// ---------------------------------------------------------------------------
// Fixtures
// ---------------------------------------------------------------------------

const CORNERS: RasterCorners = [
  [77.4, 17.95],
  [77.6, 17.95],
  [77.6, 17.85],
  [77.4, 17.85],
];

function points(values: Array<Record<string, unknown>>): FeatureCollection {
  return {
    type: "FeatureCollection",
    features: values.map((properties, i) => ({
      type: "Feature",
      properties,
      geometry: { type: "Point", coordinates: [77 + i * 0.01, 17.9] },
    })),
  };
}

function registerRaster(id: string): void {
  useRasterImageStore.getState().set(id, new Blob(["png"]));
  useLayerRegistryStore.getState().registerRasterLayer({
    id,
    label: id,
    corners: CORNERS,
    imageKey: `img-${id}`,
  });
}

function manifest(layers: Manifest["layers"]): Manifest {
  return {
    id: "01HZ8KQR5Z3MV7BJ4N6XPYD9TF",
    version: 1,
    title: "document B",
    createdAt: "2026-10-01T00:00:00.000Z",
    updatedAt: "2026-10-01T00:00:00.000Z",
    basemap: { type: "registry", id: "default" },
    camera: { center: [77.5, 17.9], zoom: 10, bearing: 0, pitch: 0 },
    layers,
    permissions: { publicView: false },
  };
}

function resetStores(): void {
  useLayerRegistryStore.setState({ entries: [] });
  useDataLayerFCStore.getState().clear();
  useRasterImageStore.getState().clear();
}

beforeEach(resetStores);
afterEach(() => {
  cleanup();
  resetStores();
});

// ---------------------------------------------------------------------------
// Finding 1 — rasters are disconnected from the map after first mount
// ---------------------------------------------------------------------------

describe("raster layers follow the registry onto the map", () => {
  // KNOWN-RED (W5 map overlays): hiding a raster flips the registry but sets no visibility on the map, because the visibility diff has branches for annotation and data only. Flip to it() when fixed.
  it.fails("hiding a raster sets visibility none on its map layer", () => {
    registerRaster("rl:sheet");
    const map = new FakeMapLibre();
    renderHook(() => useLayerRegistrySync(asMap(map), null));
    expect(map.draws("rl:sheet")).toBe(true);

    act(() =>
      useLayerRegistryStore.getState().setVisibility("rl:sheet", false),
    );

    expect(map.getLayoutProperty("rl:sheet", "visibility")).toBe("none");
  });

  // KNOWN-RED (W5 map overlays): deleting a raster removes its registry row but leaves its image source and layer on the map, because the membership diff counts data ids only. Flip to it() when fixed.
  it.fails("deleting a raster removes its image source and layer", () => {
    registerRaster("rl:sheet");
    const map = new FakeMapLibre();
    renderHook(() => useLayerRegistrySync(asMap(map), null));
    expect(map.draws("rl:sheet")).toBe(true);

    act(() => useLayerRegistryStore.getState().remove("rl:sheet"));

    expect(map.getLayer("rl:sheet")).toBeUndefined();
    expect(map.getSource("rl:sheet")).toBeUndefined();
  });

  // KNOWN-RED (W5 map overlays): opening document B leaves document A's raster drawn and never draws B's, because no data id changed so nothing reconciles rasters. Flip to it() when fixed.
  it.fails(
    "opening another document replaces the previous document's rasters",
    async () => {
      registerRaster("rl:doc-a");
      const map = new FakeMapLibre();
      const { api } = fakeExcalidraw();
      renderHook(() => useLayerRegistrySync(asMap(map), api));
      expect(map.draws("rl:doc-a")).toBe(true);

      const docB: AtlasdrawDocument = {
        manifest: manifest([
          {
            kind: "raster",
            id: "rl:doc-b",
            label: "B sheet",
            visible: true,
            corners: CORNERS,
            opacity: 1,
            imageKey: "img-b",
          },
        ]),
        scene: [],
        layers: new Map(),
        styleRef: {},
        files: new Map([["img-b", new Blob(["png-b"])]]),
      };
      await act(async () => {
        await hydrate(docB, api);
      });

      expect({
        a: map.draws("rl:doc-a"),
        b: map.draws("rl:doc-b"),
      }).toEqual({ a: false, b: true });
    },
  );
});

// ---------------------------------------------------------------------------
// Finding 2 — "Delete" on an annotation row leaves the shape
// ---------------------------------------------------------------------------

describe("annotation rows act on the scene", () => {
  // KNOWN-RED (W5 map overlays): confirming Delete on an annotation row removes the registry entry and leaves the Excalidraw element live in the scene. Flip to it() when fixed.
  it.fails("Delete on an annotation row deletes the shape", () => {
    const scene = fakeExcalidraw();
    renderHook(() => useLayerRegistrySync(null, scene.api));
    act(() =>
      scene.api.updateScene({
        elements: [
          { id: "el-1", type: "rectangle", version: 1 },
        ] as unknown as Parameters<
          ExcalidrawImperativeAPI["updateScene"]
        >[0]["elements"],
      }),
    );
    expect(useLayerRegistryStore.getState().entries.map((e) => e.id)).toEqual([
      "el-1",
    ]);

    render(<LayerPanel />);
    fireEvent.click(screen.getByTestId("layer-menu-el-1"));
    fireEvent.click(screen.getByTestId("layer-delete-el-1"));
    fireEvent.click(screen.getByTestId("layer-delete-confirm-el-1"));

    expect(screen.queryByTestId("layer-row-el-1")).toBeNull();
    expect(scene.live()).not.toContain("el-1");
  });
});

// ---------------------------------------------------------------------------
// Finding 3 — the panel's list direction is the reverse of the map's z-order
// ---------------------------------------------------------------------------

describe("data-layer panel order matches map z-order", () => {
  // KNOWN-RED (W5 map overlays): the Data Layers section lists order 0 at the top, but MapLibre draws order 0 at the bottom, so the top row is drawn underneath. Flip to it() when fixed.
  it.fails("the panel's top data row is the top data layer on the map", () => {
    const map = new FakeMapLibre();
    renderHook(() => useLayerRegistrySync(asMap(map), null));
    const ids = ["dl:roads", "dl:rivers", "dl:wells"];
    act(() => {
      for (const id of ids) {
        useLayerRegistryStore.getState().registerDataLayer({
          id,
          fc: points([{ n: 1 }]),
          label: id,
          style: { fillColor: "#0aa", opacity: 1 },
        });
      }
    });
    expect(ids.every((id) => map.draws(id))).toBe(true);

    render(<LayerPanel />);
    const section = screen.getByLabelText("Data Layers");
    const panelTopFirst = Array.from(
      section.querySelectorAll<HTMLElement>('[data-testid^="layer-row-"]'),
    )
      .map((el) => el.dataset.testid!.replace(/^layer-row-/, ""))
      .filter((id) => ids.includes(id));

    expect(panelTopFirst).toEqual(map.topFirst(ids));
  });
});

// ---------------------------------------------------------------------------
// Finding 4 — StylePanel can commit a style MapLibre rejects
// ---------------------------------------------------------------------------

describe("a style MapLibre rejects is not committed", () => {
  function setup(fc: FeatureCollection) {
    const map = new FakeMapLibre();
    renderHook(() => useLayerRegistrySync(asMap(map), null));
    act(() =>
      useLayerRegistryStore.getState().registerDataLayer({
        id: "dl:wells",
        fc,
        label: "Wells",
        style: { fillColor: "#0aa", opacity: 1 },
      }),
    );
    expect(map.draws("dl:wells")).toBe(true);
    render(
      <ToastProvider>
        <AriaAnnouncer />
        <StylePanel layerId="dl:wells" />
      </ToastProvider>,
    );
    return map;
  }

  /**
   * A reload: the persisted registry state reconciled onto a fresh map. The
   * errors MapLibre fired ride along so a failure names the rejection.
   */
  function reload(id: string): { draws: boolean; errors: string[] } {
    const fresh = new FakeMapLibre();
    reconcileDataLayers(
      asMap(fresh),
      useLayerRegistryStore.getState().entries,
      useDataLayerFCStore.getState().getAll(),
    );
    return { draws: fresh.draws(id), errors: fresh.errors };
  }

  function applyTwoBlankCategories(): void {
    fireEvent.click(screen.getByTestId("style-tab-categorical"));
    fireEvent.click(screen.getByTestId("cat-add-stop"));
    fireEvent.click(screen.getByTestId("cat-apply"));
  }

  // KNOWN-RED (W5 map overlays): two blank categorical rows compile to a match with duplicate labels; MapLibre rejects it with an error event, yet the registry keeps it and the layer is missing after reload. Flip to it() when fixed.
  it.fails(
    "two blank categorical rows: the layer still renders after reload",
    () => {
      setup(points([{ kind: "a" }, { kind: "b" }]));
      applyTwoBlankCategories();
      expect(reload("dl:wells")).toEqual({ draws: true, errors: [] });
    },
  );

  // KNOWN-RED (W5 map overlays): applying a categorical style MapLibre rejects shows the user nothing; the error event goes to the console only. Flip to it() when fixed.
  it.fails("two blank categorical rows: the rejection is surfaced", () => {
    setup(points([{ kind: "a" }, { kind: "b" }]));
    applyTwoBlankCategories();
    expect(document.body.textContent ?? "").toMatch(
      /invalid|rejected|not valid|unique|could ?n[o']t|failed/i,
    );
  });

  // KNOWN-RED (W5 map overlays): quantile stops on skewed data are not deduplicated, so the interpolate stops are not strictly ascending; MapLibre rejects them, yet the registry keeps them and the layer is missing after reload. Flip to it() when fixed.
  it.fails(
    "duplicate quantile stops: the layer still renders after reload",
    () => {
      setup(points([0, 0, 0, 0, 0, 0, 1, 2, 100].map((v) => ({ v }))));
      fireEvent.click(screen.getByTestId("style-tab-graduated"));
      fireEvent.change(screen.getByTestId("grad-method"), {
        target: { value: "quantile" },
      });
      fireEvent.click(screen.getByTestId("grad-compute"));
      fireEvent.click(screen.getByTestId("grad-apply"));
      expect(reload("dl:wells")).toEqual({ draws: true, errors: [] });
    },
  );
});
