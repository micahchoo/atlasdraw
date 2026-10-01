// SPDX-License-Identifier: AGPL-3.0-only
//
// Tests for map-overlay hazards. Each case states the correct behaviour. They
// pass because the map overlays have one writer (lib/mapOverlays.ts).
//
// The map is FakeMapLibre (lib/__tests__/fixtures/fakeMapLibre.ts): it keeps
// MapLibre 4.7.1's style state and fires "error" events where MapLibre does.
// Every assertion reads the resulting style state.

import { afterEach, beforeEach, describe, expect, it } from "vitest";
import {
  act,
  cleanup,
  fireEvent,
  render,
  renderHook,
  screen,
} from "@testing-library/react";

import type { AtlasdrawDocument, Manifest } from "@atlasdraw/data";

import type { ExcalidrawImperativeAPI } from "@atlasdraw/excalidraw";

import { useMapOverlays } from "../useMapOverlays";
import { loadDocument } from "../../state/documentIO";
import { PNG_BYTES, admittedOf } from "../../state/__tests__/fixtures/admitted";
import { useSceneBinding, useSceneStore } from "../../state/scene";
import { annotationRows } from "../../state/annotations";
import {
  createMapOverlays,
  overlaySpec,
  type StyleTarget,
} from "../../lib/mapOverlays";
import { FakeMapLibre } from "../../lib/__tests__/fixtures/fakeMapLibre";
import { LayerPanel } from "../../components/LayerPanel";
import { withSession } from "../../session/__tests__/sessionFixture";
import { StylePanel } from "../../components/StylePanel";
import { ToastProvider } from "../../components/ToastProvider";
import { AriaAnnouncer } from "../../components/AriaAnnouncer";

import {
  createDocument,
  currentDocument,
  openDocument,
} from "../../state/document";

import type { FeatureCollection } from "geojson";
import type maplibregl from "maplibre-gl";
import type { RasterCorners } from "../../state/document";

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
  currentDocument().dispatch({
    type: "add-raster-layer",
    image: new Blob(["png"]),
    id,
    label: id,
    corners: CORNERS,
    imageKey: `img-${id}`,
  });
}

function manifest(layers: Manifest["layers"]): Manifest {
  return {
    id: "01HZ8KQR5Z3MV7BJ4N6XPYD9TF",
    version: 2,
    title: "document B",
    createdAt: "2026-10-01T00:00:00.000Z",
    updatedAt: "2026-10-01T00:00:00.000Z",
    basemap: { type: "registry", id: "default" },
    camera: { center: [77.5, 17.9], zoom: 10, bearing: 0, pitch: 0 },
    world: { z0: 22, origin: { x: 0, y: 0 } },
    layers,
    permissions: { publicView: false },
  };
}

function resetStores(): void {
  openDocument(createDocument());
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
  it("hiding a raster sets visibility none on its map layer", () => {
    registerRaster("rl:sheet");
    const map = new FakeMapLibre();
    renderHook(() => useMapOverlays(asMap(map)));
    expect(map.draws("rl:sheet")).toBe(true);

    act(() =>
      currentDocument().dispatch({
        type: "set-visibility",
        id: "rl:sheet",
        visible: false,
      }),
    );

    expect(map.getLayoutProperty("rl:sheet", "visibility")).toBe("none");
  });

  it("deleting a raster removes its image source and layer", () => {
    registerRaster("rl:sheet");
    const map = new FakeMapLibre();
    renderHook(() => useMapOverlays(asMap(map)));
    expect(map.draws("rl:sheet")).toBe(true);

    act(() =>
      currentDocument().dispatch({ type: "remove-layer", id: "rl:sheet" }),
    );

    expect(map.getLayer("rl:sheet")).toBeUndefined();
    expect(map.getSource("rl:sheet")).toBeUndefined();
  });

  it("opening another document replaces the previous document's rasters", async () => {
    registerRaster("rl:doc-a");
    const map = new FakeMapLibre();
    const { api } = fakeExcalidraw();
    renderHook(() => useMapOverlays(asMap(map)));
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
      files: new Map([["img-b", new Blob([PNG_BYTES])]]),
    };
    const admittedB = await admittedOf(docB);
    await act(async () => {
      await loadDocument(admittedB, api);
    });

    expect({
      a: map.draws("rl:doc-a"),
      b: map.draws("rl:doc-b"),
    }).toEqual({ a: false, b: true });
  });
});

// ---------------------------------------------------------------------------
// Finding 2 — "Delete" on an annotation row leaves the shape
// ---------------------------------------------------------------------------

describe("annotation rows act on the scene", () => {
  it("Delete on an annotation row deletes the shape", () => {
    const scene = fakeExcalidraw();
    // Annotation rows are computed from the scene the panel is bound to.
    renderHook(() => useSceneBinding(scene.api));
    act(() =>
      scene.api.updateScene({
        elements: [
          { id: "el-1", type: "rectangle", version: 1 },
        ] as unknown as Parameters<
          ExcalidrawImperativeAPI["updateScene"]
        >[0]["elements"],
      }),
    );
    expect(
      annotationRows(
        useSceneStore.getState().elements,
        currentDocument().snapshot().world,
      ).map((r) => r.id),
    ).toEqual(["el-1"]);

    render(withSession(<LayerPanel />));
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
  it("the panel's top data row is the top data layer on the map", () => {
    const map = new FakeMapLibre();
    renderHook(() => useMapOverlays(asMap(map)));
    const ids = ["dl:roads", "dl:rivers", "dl:wells"];
    act(() => {
      for (const id of ids) {
        currentDocument().dispatch({
          type: "add-data-layer",
          id,
          fc: points([{ n: 1 }]),
          label: id,
          style: { fillColor: "#0aa", opacity: 1 },
        });
      }
    });
    expect(ids.every((id) => map.draws(id))).toBe(true);

    render(withSession(<LayerPanel />));
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
    renderHook(() => useMapOverlays(asMap(map)));
    act(() =>
      currentDocument().dispatch({
        type: "add-data-layer",
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
   * A reload: the persisted document's layers reconciled onto a fresh map. The
   * errors MapLibre fired ride along so a failure names the rejection.
   */
  function reload(id: string): { draws: boolean; errors: string[] } {
    const fresh = new FakeMapLibre();
    createMapOverlays(fresh as unknown as StyleTarget).apply(
      overlaySpec(currentDocument().snapshot()),
    );
    return { draws: fresh.draws(id), errors: fresh.errors };
  }

  function applyTwoBlankCategories(): void {
    fireEvent.click(screen.getByTestId("style-tab-categorical"));
    fireEvent.click(screen.getByTestId("cat-add-stop"));
    fireEvent.click(screen.getByTestId("cat-apply"));
  }

  it("two blank categorical rows: the layer still renders after reload", () => {
    setup(points([{ kind: "a" }, { kind: "b" }]));
    applyTwoBlankCategories();
    expect(reload("dl:wells")).toEqual({ draws: true, errors: [] });
  });

  it("two blank categorical rows: the rejection is surfaced", () => {
    setup(points([{ kind: "a" }, { kind: "b" }]));
    applyTwoBlankCategories();
    expect(document.body.textContent ?? "").toMatch(
      /invalid|rejected|not valid|unique|could ?n[o']t|failed/i,
    );
  });

  it("duplicate quantile stops: the layer still renders after reload", () => {
    setup(points([0, 0, 0, 0, 0, 0, 1, 2, 100].map((v) => ({ v }))));
    fireEvent.click(screen.getByTestId("style-tab-graduated"));
    fireEvent.change(screen.getByTestId("grad-method"), {
      target: { value: "quantile" },
    });
    fireEvent.click(screen.getByTestId("grad-compute"));
    fireEvent.click(screen.getByTestId("grad-apply"));
    expect(reload("dl:wells")).toEqual({ draws: true, errors: [] });
  });
});
