// SPDX-License-Identifier: AGPL-3.0-only
//
// Tests for useLayerRegistrySync (Phase 2 W-A — Bug A + Bug B).
//
// We test the exported factory functions directly rather than driving the
// React hook — same approach as useGeoAnchor.test.ts and useAtlasdrawTool.test.ts.
// The one exception is the store→map subscriber at the bottom of this file: the
// bug it closes (a reorder that never reached MapLibre) lives in the wiring, not
// in any one factory, so it is only observable through the real hook.
//
// The map-writing side of this pair (addDataLayerToMap / applyVisibilityToMap /
// reconcileDataLayers / removeDataLayersFromMap / applyOrderToMap) is unit
// tested in lib/dataLayerRender.test.ts.

import { describe, it, expect, vi, beforeEach, afterEach } from "vitest";
import { renderHook, cleanup } from "@testing-library/react";

import { useLayerRegistryStore } from "../state/layerRegistry";
import { useDataLayerFCStore } from "../state/useDataLayerFCStore";

import {
  buildSceneDiffHandler,
  generateLayerLabel,
  applyVisibilityToScene,
  applyStyleToMap,
  diffVisibility,
  diffStyles,
  diffDataLayerIds,
  useLayerRegistrySync,
  ATLAS_ORIGINAL_OPACITY_KEY,
  type SyncSceneElement,
  type MapPaintSurface,
} from "./useLayerRegistrySync";

import type { LayerRegistryEntry, LayerStyle } from "../state/layerRegistry";
import type maplibregl from "maplibre-gl";
import type { FeatureCollection } from "geojson";

// ---------------------------------------------------------------------------
// Test fixtures
// ---------------------------------------------------------------------------
//
// Per project rule (.claude/rules/test-fixtures.md): if a test needs a
// different shape, construct a NEW fixture (never mutate to fix one test).

function makeRegistryStubs() {
  const registerAnnotation = vi.fn();
  const updateAnnotationLabel = vi.fn();
  const remove = vi.fn();
  return { registerAnnotation, updateAnnotationLabel, remove };
}

// ---------------------------------------------------------------------------
// Bug A — buildSceneDiffHandler
// ---------------------------------------------------------------------------

describe("buildSceneDiffHandler — Excalidraw → registry sync (Bug A)", () => {
  beforeEach(() => {
    vi.clearAllMocks();
  });

  it("registers each element on the initial scene with labels", () => {
    const { registerAnnotation, updateAnnotationLabel, remove } =
      makeRegistryStubs();
    const knownIds = new Set<string>();
    const handler = buildSceneDiffHandler({
      knownIds,
      registerAnnotation,
      updateAnnotationLabel,
      remove,
      existsInRegistry: () => false,
    });

    handler([
      { id: "a", type: "rectangle" },
      { id: "b", type: "ellipse" },
    ]);

    expect(registerAnnotation).toHaveBeenCalledTimes(2);
    expect(registerAnnotation).toHaveBeenNthCalledWith(1, "a", "Rectangle");
    expect(registerAnnotation).toHaveBeenNthCalledWith(2, "b", "Ellipse");
    expect(remove).not.toHaveBeenCalled();
    expect(knownIds.has("a")).toBe(true);
    expect(knownIds.has("b")).toBe(true);
  });

  it("dedupes — second call with same scene is a no-op", () => {
    const { registerAnnotation, updateAnnotationLabel, remove } =
      makeRegistryStubs();
    const knownIds = new Set<string>();
    const handler = buildSceneDiffHandler({
      knownIds,
      registerAnnotation,
      updateAnnotationLabel,
      remove,
      existsInRegistry: () => false,
    });

    handler([{ id: "a" }, { id: "b" }]);
    registerAnnotation.mockClear();
    remove.mockClear();
    handler([{ id: "a" }, { id: "b" }]);

    expect(registerAnnotation).not.toHaveBeenCalled();
    expect(remove).not.toHaveBeenCalled();
  });

  it("registers a newly-added element exactly once with label", () => {
    const { registerAnnotation, updateAnnotationLabel, remove } =
      makeRegistryStubs();
    const knownIds = new Set<string>(["a"]);
    const handler = buildSceneDiffHandler({
      knownIds,
      registerAnnotation,
      updateAnnotationLabel,
      remove,
      existsInRegistry: () => false,
    });

    handler([
      { id: "a", type: "rectangle" },
      { id: "b", type: "freedraw" },
    ]);

    expect(registerAnnotation).toHaveBeenCalledTimes(1);
    expect(registerAnnotation).toHaveBeenCalledWith("b", "Freehand");
    expect(remove).not.toHaveBeenCalled();
    expect(knownIds.has("b")).toBe(true);
  });

  it("removes an element that vanished from the scene", () => {
    const { registerAnnotation, updateAnnotationLabel, remove } =
      makeRegistryStubs();
    const knownIds = new Set<string>(["a", "b"]);
    const handler = buildSceneDiffHandler({
      knownIds,
      registerAnnotation,
      updateAnnotationLabel,
      remove,
      existsInRegistry: () => false,
    });

    handler([{ id: "a" }]);

    expect(remove).toHaveBeenCalledTimes(1);
    expect(remove).toHaveBeenCalledWith("b");
    expect(registerAnnotation).not.toHaveBeenCalled();
    expect(knownIds.has("b")).toBe(false);
  });

  it("ignores resize/drag — same id with mutated props is a no-op", () => {
    const { registerAnnotation, updateAnnotationLabel, remove } =
      makeRegistryStubs();
    const knownIds = new Set<string>(["a"]);
    const handler = buildSceneDiffHandler({
      knownIds,
      registerAnnotation,
      updateAnnotationLabel,
      remove,
      existsInRegistry: () => false,
    });

    // Simulating a drag/resize: same id, different element fields.
    handler([{ id: "a", opacity: 50 }]);
    handler([{ id: "a", opacity: 100, customData: { x: 1 } }]);

    expect(registerAnnotation).not.toHaveBeenCalled();
    expect(remove).not.toHaveBeenCalled();
  });

  it("treats deleted elements as absent (removes if previously known)", () => {
    const { registerAnnotation, updateAnnotationLabel, remove } =
      makeRegistryStubs();
    const knownIds = new Set<string>(["a"]);
    const handler = buildSceneDiffHandler({
      knownIds,
      registerAnnotation,
      updateAnnotationLabel,
      remove,
      existsInRegistry: () => false,
    });

    handler([{ id: "a", isDeleted: true }]);

    expect(remove).toHaveBeenCalledTimes(1);
    expect(remove).toHaveBeenCalledWith("a");
    expect(registerAnnotation).not.toHaveBeenCalled();
  });

  it("does NOT register newly-added deleted elements", () => {
    const { registerAnnotation, updateAnnotationLabel, remove } =
      makeRegistryStubs();
    const knownIds = new Set<string>();
    const handler = buildSceneDiffHandler({
      knownIds,
      registerAnnotation,
      updateAnnotationLabel,
      remove,
      existsInRegistry: () => false,
    });

    handler([{ id: "a", isDeleted: true }]);

    expect(registerAnnotation).not.toHaveBeenCalled();
    expect(remove).not.toHaveBeenCalled();
  });

  it("enriches the label when geo data appears after registration", () => {
    const { registerAnnotation, updateAnnotationLabel, remove } =
      makeRegistryStubs();
    const knownIds = new Set<string>();
    const handler = buildSceneDiffHandler({
      knownIds,
      registerAnnotation,
      updateAnnotationLabel,
      remove,
      existsInRegistry: () => false,
    });

    // First call: element has no geo data — label is just the type.
    handler([{ id: "a", type: "rectangle" }]);
    expect(registerAnnotation).toHaveBeenCalledWith("a", "Rectangle");

    // Second call: element now has geo data — label should be updated.
    handler([
      {
        id: "a",
        type: "rectangle",
        customData: {
          schemaVersion: 1,
          projection: "mercator",
          scaleMode: "geographic",
          geo: { kind: "point", lng: -74.006, lat: 40.7128, zRef: 10 },
        },
      },
    ]);

    expect(updateAnnotationLabel).toHaveBeenCalledTimes(1);
    expect(updateAnnotationLabel).toHaveBeenCalledWith(
      "a",
      "Rectangle near 40.7°N, 74.0°W",
    );
  });

  it("falls back to element id when type is unknown", () => {
    const { registerAnnotation, updateAnnotationLabel, remove } =
      makeRegistryStubs();
    const knownIds = new Set<string>();
    const handler = buildSceneDiffHandler({
      knownIds,
      registerAnnotation,
      updateAnnotationLabel,
      remove,
      existsInRegistry: () => false,
    });

    handler([{ id: "abc-123" }]);
    expect(registerAnnotation).toHaveBeenCalledWith("abc-123", "abc-123");
  });

  // The stubs above prove the handler *calls* updateAnnotationLabel. Whether a
  // user's rename survives that call is a property of the two together, so
  // this one wires the real store in.
  it("does not overwrite a name the user typed, on any later scene change", () => {
    useLayerRegistryStore.setState({ entries: [] });
    const store = useLayerRegistryStore.getState();
    const knownIds = new Set<string>();
    const handler = buildSceneDiffHandler({
      knownIds,
      registerAnnotation: (id, label) => store.registerAnnotation(id, label),
      updateAnnotationLabel: (id, label) =>
        store.updateAnnotationLabel(id, label),
      remove: (id) => store.remove(id),
      existsInRegistry: (id) =>
        useLayerRegistryStore.getState().entries.some((e) => e.id === id),
    });

    handler([{ id: "a", type: "rectangle" }]);
    store.renameLayer("a", "Ward 3");

    // The shape acquires a geo anchor, then moves — two more scene changes,
    // each one a chance for the generator to take the name back.
    const anchored = (lat: number, lng: number): SyncSceneElement => ({
      id: "a",
      type: "rectangle",
      customData: {
        schemaVersion: 1,
        projection: "mercator",
        scaleMode: "geographic",
        geo: { kind: "point", lng, lat, zRef: 10 },
      },
    });
    handler([anchored(40.7128, -74.006)]);
    handler([anchored(40.9, -74.2)]);

    expect(useLayerRegistryStore.getState().entries[0]).toMatchObject({
      id: "a",
      label: "Ward 3",
      renamedByUser: true,
    });
  });
});

// ---------------------------------------------------------------------------
// generateLayerLabel
// ---------------------------------------------------------------------------

describe("generateLayerLabel", () => {
  it('formats "Type near lat, lng" when geo data is present', () => {
    const el: SyncSceneElement = {
      id: "x",
      type: "rectangle",
      customData: {
        schemaVersion: 1,
        projection: "mercator",
        scaleMode: "geographic",
        geo: { kind: "point", lng: -74.006, lat: 40.7128, zRef: 10 },
      },
    };
    expect(generateLayerLabel(el)).toBe("Rectangle near 40.7°N, 74.0°W");
  });

  it("uses only the type name when geo data is absent", () => {
    expect(generateLayerLabel({ id: "x", type: "freedraw" })).toBe("Freehand");
  });

  it("falls back to id when type is missing", () => {
    expect(generateLayerLabel({ id: "abc-123" })).toBe("abc-123");
  });

  it("extracts the center of a bbox anchor", () => {
    const el: SyncSceneElement = {
      id: "x",
      type: "ellipse",
      customData: {
        schemaVersion: 1,
        projection: "mercator",
        scaleMode: "geographic",
        geo: {
          kind: "bbox",
          west: -0.2,
          south: 51.4,
          east: 0.0,
          north: 51.6,
          zRef: 10,
        },
      },
    };
    expect(generateLayerLabel(el)).toBe("Ellipse near 51.5°N, 0.1°W");
  });
});

// ---------------------------------------------------------------------------
// Bug B — applyVisibilityToScene (annotation kind)
// ---------------------------------------------------------------------------

describe("applyVisibilityToScene — annotation visibility rewrite (Bug B)", () => {
  it("hides an element by setting opacity:0 and stashing original", () => {
    const elements: SyncSceneElement[] = [
      { id: "x", opacity: 80 },
      { id: "y", opacity: 100 },
    ];

    const next = applyVisibilityToScene(elements, "x", false);

    expect(next).not.toBe(elements);
    expect(next[0]).toEqual({
      id: "x",
      opacity: 0,
      customData: { [ATLAS_ORIGINAL_OPACITY_KEY]: 80 },
    });
    // The non-matching element is referentially identical (we only allocate
    // for the matched element).
    expect(next[1]).toBe(elements[1]);
  });

  it("defaults original opacity to 100 when input has none", () => {
    const elements: SyncSceneElement[] = [{ id: "x" }];
    const next = applyVisibilityToScene(elements, "x", false);
    expect(next[0]).toEqual({
      id: "x",
      opacity: 0,
      customData: { [ATLAS_ORIGINAL_OPACITY_KEY]: 100 },
    });
  });

  it("restores opacity from customData on show", () => {
    const elements: SyncSceneElement[] = [
      {
        id: "x",
        opacity: 0,
        customData: { [ATLAS_ORIGINAL_OPACITY_KEY]: 60 },
      },
    ];

    const next = applyVisibilityToScene(elements, "x", true);

    expect(next[0]).toEqual({
      id: "x",
      opacity: 60,
      customData: {},
    });
  });

  it("round-trips hide → show preserving original opacity", () => {
    const original: SyncSceneElement[] = [{ id: "x", opacity: 75 }];
    const hidden = applyVisibilityToScene(original, "x", false);
    const shown = applyVisibilityToScene(hidden, "x", true);
    expect(shown[0].opacity).toBe(75);
    expect(shown[0].customData).toEqual({});
  });

  it("preserves other customData keys across hide/show", () => {
    const original: SyncSceneElement[] = [
      { id: "x", opacity: 100, customData: { geo: { kind: "point" } } },
    ];
    const hidden = applyVisibilityToScene(original, "x", false);
    expect(hidden[0].customData).toEqual({
      geo: { kind: "point" },
      [ATLAS_ORIGINAL_OPACITY_KEY]: 100,
    });
    const shown = applyVisibilityToScene(hidden, "x", true);
    expect(shown[0].customData).toEqual({ geo: { kind: "point" } });
    expect(shown[0].opacity).toBe(100);
  });

  it("hide is idempotent — second hide does not overwrite stash", () => {
    const original: SyncSceneElement[] = [{ id: "x", opacity: 50 }];
    const once = applyVisibilityToScene(original, "x", false);
    const twice = applyVisibilityToScene(once, "x", false);
    // Stash from the first call survives — original opacity was 50, not 0.
    expect(twice[0].customData).toEqual({ [ATLAS_ORIGINAL_OPACITY_KEY]: 50 });
    expect(twice[0].opacity).toBe(0);
  });

  it("show on already-visible element is a no-op (referentially identical)", () => {
    const elements: SyncSceneElement[] = [{ id: "x", opacity: 100 }];
    const next = applyVisibilityToScene(elements, "x", true);
    // No stash → nothing to restore. Element returned by reference.
    expect(next[0]).toBe(elements[0]);
  });

  it("returns input array unchanged when no element matches", () => {
    const elements: SyncSceneElement[] = [{ id: "x" }, { id: "y" }];
    const next = applyVisibilityToScene(elements, "missing", false);
    expect(next).toBe(elements);
  });
});

// ---------------------------------------------------------------------------
// diffVisibility — entry-flip detector used by the registry subscriber
// ---------------------------------------------------------------------------

describe("diffVisibility — registry entry visibility flips", () => {
  function annotation(
    id: string,
    visible: boolean,
    order = 0,
  ): LayerRegistryEntry {
    return { kind: "annotation", id, label: id, visible, order };
  }

  it("returns empty when nothing changed", () => {
    const a = annotation("x", true);
    const b = annotation("y", true);
    expect(diffVisibility([a, b], [a, b])).toEqual([]);
  });

  it("returns flipped entries only", () => {
    const flips = diffVisibility(
      [annotation("x", true), annotation("y", true)],
      [annotation("x", false), annotation("y", true)],
    );
    expect(flips).toHaveLength(1);
    expect(flips[0]).toMatchObject({ id: "x", visible: false });
  });

  it("ignores newly-added entries (no prior visibility to flip from)", () => {
    const flips = diffVisibility(
      [annotation("x", true)],
      [annotation("x", true), annotation("y", true)],
    );
    expect(flips).toEqual([]);
  });

  it("ignores removed entries", () => {
    const flips = diffVisibility(
      [annotation("x", true), annotation("y", true)],
      [annotation("x", true)],
    );
    expect(flips).toEqual([]);
  });

  it("detects multiple simultaneous flips", () => {
    const flips = diffVisibility(
      [annotation("x", true), annotation("y", false)],
      [annotation("x", false), annotation("y", true)],
    );
    expect(flips).toHaveLength(2);
    expect(flips.map((f) => f.id).sort()).toEqual(["x", "y"]);
  });
});

// ---------------------------------------------------------------------------
// Shared fixtures for the data-layer render tests (P1 + P2)
// ---------------------------------------------------------------------------

const POLY_FC: FeatureCollection = {
  type: "FeatureCollection",
  features: [
    {
      type: "Feature",
      properties: { cat: "a" },
      geometry: {
        type: "Polygon",
        coordinates: [
          [
            [0, 0],
            [1, 0],
            [1, 1],
            [0, 0],
          ],
        ],
      },
    },
  ],
};

const POINT_FC: FeatureCollection = {
  type: "FeatureCollection",
  features: [
    {
      type: "Feature",
      properties: {},
      geometry: { type: "Point", coordinates: [1, 2] },
    },
  ],
};

const TEAL: LayerStyle = {
  fillColor: "#0aa",
  strokeColor: "#077",
  strokeWidth: 1,
  opacity: 0.5,
};

function dataEntry(
  id: string,
  style: LayerStyle,
  visible = true,
  order = 0,
): LayerRegistryEntry {
  return {
    kind: "data",
    id,
    label: id,
    visible,
    order,
    featureCount: 1,
    style,
  };
}

// ---------------------------------------------------------------------------
// P1 — applyStyleToMap (MapLibre setPaintProperty)
// ---------------------------------------------------------------------------

describe("applyStyleToMap — MapLibre setPaintProperty (P1)", () => {
  function makePaintMap(impl?: (id: string, name: string, v: unknown) => void) {
    const setPaintProperty = vi.fn(impl ?? (() => {}));
    const map: MapPaintSurface = { setPaintProperty };
    return { map, setPaintProperty };
  }

  it("pushes only the paint property that actually changed", () => {
    const { map, setPaintProperty } = makePaintMap();
    applyStyleToMap(map, "dl:a", TEAL, { ...TEAL, fillColor: "#f00" }, "fill");
    expect(setPaintProperty.mock.calls).toEqual([
      ["dl:a", "fill-color", "#f00"],
    ]);
  });

  it("pushes nothing when the style is unchanged", () => {
    const { map, setPaintProperty } = makePaintMap();
    applyStyleToMap(map, "dl:a", TEAL, { ...TEAL }, "fill");
    expect(setPaintProperty).not.toHaveBeenCalled();
  });

  it("pushes every changed property in one patch", () => {
    const { map, setPaintProperty } = makePaintMap();
    applyStyleToMap(
      map,
      "dl:a",
      TEAL,
      { ...TEAL, fillColor: "#f00", opacity: 0.9 },
      "fill",
    );
    expect(setPaintProperty.mock.calls).toEqual([
      ["dl:a", "fill-color", "#f00"],
      ["dl:a", "fill-opacity", 0.9],
    ]);
  });

  it("routes opacity + width onto the line geometry's own paint names", () => {
    const { map, setPaintProperty } = makePaintMap();
    applyStyleToMap(
      map,
      "dl:a",
      TEAL,
      { ...TEAL, strokeWidth: 4, opacity: 0.25 },
      "line",
    );
    expect(setPaintProperty.mock.calls).toEqual([
      ["dl:a", "line-width", 4],
      ["dl:a", "line-opacity", 0.25],
    ]);
  });

  it("routes fillColor onto circle-color for point layers", () => {
    const { map, setPaintProperty } = makePaintMap();
    applyStyleToMap(
      map,
      "dl:a",
      TEAL,
      { ...TEAL, fillColor: "#123" },
      "circle",
    );
    expect(setPaintProperty.mock.calls).toEqual([
      ["dl:a", "circle-color", "#123"],
    ]);
  });

  it("pushes a compiled data-driven expression on the primary color", () => {
    const { map, setPaintProperty } = makePaintMap();
    const next: LayerStyle = {
      ...TEAL,
      expression: {
        kind: "categorical",
        property: "cat",
        stops: [{ value: "a", color: "#111" }],
        fallback: "#999",
      },
    };
    applyStyleToMap(map, "dl:a", TEAL, next, "fill");
    expect(setPaintProperty.mock.calls).toEqual([
      ["dl:a", "fill-color", ["match", ["get", "cat"], "a", "#111", "#999"]],
    ]);
  });

  it("does not re-push a structurally identical expression", () => {
    const { map, setPaintProperty } = makePaintMap();
    const expression: LayerStyle["expression"] = {
      kind: "categorical",
      property: "cat",
      stops: [{ value: "a", color: "#111" }],
      fallback: "#999",
    };
    // Fresh object with the same shape — a re-render must not thrash the map.
    applyStyleToMap(
      map,
      "dl:a",
      { ...TEAL, expression },
      { ...TEAL, expression: { ...expression } },
      "fill",
    );
    expect(setPaintProperty).not.toHaveBeenCalled();
  });

  it("swallows errors when the layer doesn't exist (logs warn, no throw)", () => {
    const warn = vi.spyOn(console, "warn").mockImplementation(() => {});
    const { map } = makePaintMap(() => {
      throw new Error("Layer 'dl:missing' does not exist");
    });

    expect(() =>
      applyStyleToMap(
        map,
        "dl:missing",
        TEAL,
        { ...TEAL, fillColor: "#f00" },
        "fill",
      ),
    ).not.toThrow();
    expect(warn).toHaveBeenCalledTimes(1);
    expect(warn.mock.calls[0][0]).toContain("dl:missing");

    warn.mockRestore();
  });
});

// ---------------------------------------------------------------------------
// P1 — diffStyles (entry-style change detector used by the subscriber)
// ---------------------------------------------------------------------------

describe("diffStyles — registry entry style changes (P1)", () => {
  it("returns empty when the style object is referentially identical", () => {
    const a = dataEntry("dl:a", TEAL);
    expect(diffStyles([a], [a])).toEqual([]);
  });

  it("reports the previous and next style for a changed entry", () => {
    const prevStyle = TEAL;
    const nextStyle = { ...TEAL, fillColor: "#f00" };
    const changes = diffStyles(
      [dataEntry("dl:a", prevStyle)],
      [dataEntry("dl:a", nextStyle)],
    );
    expect(changes).toHaveLength(1);
    expect(changes[0]).toEqual({
      id: "dl:a",
      prevStyle,
      nextStyle,
    });
  });

  it("ignores annotation entries (no style field)", () => {
    const prev: LayerRegistryEntry[] = [
      { kind: "annotation", id: "x", label: "x", visible: true, order: 0 },
    ];
    const next: LayerRegistryEntry[] = [
      {
        kind: "annotation",
        id: "x",
        label: "renamed",
        visible: true,
        order: 0,
      },
    ];
    expect(diffStyles(prev, next)).toEqual([]);
  });

  it("ignores newly-added entries (their style is baked into addLayer)", () => {
    const changes = diffStyles([], [dataEntry("dl:a", TEAL)]);
    expect(changes).toEqual([]);
  });

  it("ignores label/visibility-only changes", () => {
    const changes = diffStyles(
      [dataEntry("dl:a", TEAL, true)],
      [dataEntry("dl:a", TEAL, false)],
    );
    expect(changes).toEqual([]);
  });
});

// ---------------------------------------------------------------------------
// diffDataLayerIds — membership + stacking detector used by the subscriber
// ---------------------------------------------------------------------------

describe("diffDataLayerIds — data-layer id set and sequence (P2/P3)", () => {
  it("reports nothing for identical snapshots", () => {
    const prev = [dataEntry("dl:a", TEAL, true, 0)];
    expect(diffDataLayerIds(prev, prev)).toEqual({
      added: [],
      removed: [],
      orderChanged: false,
    });
  });

  it("reports an added id", () => {
    expect(
      diffDataLayerIds(
        [dataEntry("dl:a", TEAL)],
        [dataEntry("dl:a", TEAL, true, 0), dataEntry("dl:b", TEAL, true, 1)],
      ),
    ).toEqual({ added: ["dl:b"], removed: [], orderChanged: false });
  });

  it("reports a removed id", () => {
    expect(
      diffDataLayerIds(
        [dataEntry("dl:a", TEAL, true, 0), dataEntry("dl:b", TEAL, true, 1)],
        [dataEntry("dl:a", TEAL, true, 0)],
      ),
    ).toEqual({ added: [], removed: ["dl:b"], orderChanged: false });
  });

  it("detects a same-length swap — convertAnnotationToDataLayer's shape", () => {
    // convertAnnotationToDataLayer removes one annotation and pushes one data
    // layer in a single immer draft, so `entries.length` never changes. The
    // old length heuristic saw nothing and the new layer never hit the map.
    const prev: LayerRegistryEntry[] = [
      {
        kind: "annotation",
        id: "elem-1",
        label: "Rectangle",
        visible: true,
        order: 0,
      },
    ];
    const next: LayerRegistryEntry[] = [dataEntry("dl:new", TEAL, true, 0)];
    expect(prev.length).toBe(next.length);
    expect(diffDataLayerIds(prev, next)).toEqual({
      added: ["dl:new"],
      removed: [],
      orderChanged: false,
    });
  });

  it("detects a whole-document swap — hydrate()'s shape", () => {
    expect(
      diffDataLayerIds(
        [
          dataEntry("dl:old1", TEAL, true, 0),
          dataEntry("dl:old2", TEAL, true, 1),
        ],
        [
          dataEntry("dl:new1", TEAL, true, 0),
          dataEntry("dl:new2", TEAL, true, 1),
        ],
      ),
    ).toEqual({
      added: ["dl:new1", "dl:new2"],
      removed: ["dl:old1", "dl:old2"],
      orderChanged: false,
    });
  });

  it("reports a permutation as orderChanged", () => {
    expect(
      diffDataLayerIds(
        [dataEntry("dl:a", TEAL, true, 0), dataEntry("dl:b", TEAL, true, 1)],
        [dataEntry("dl:b", TEAL, true, 0), dataEntry("dl:a", TEAL, true, 1)],
      ),
    ).toEqual({ added: [], removed: [], orderChanged: true });
  });

  it("ignores annotation entries entirely", () => {
    const withAnnotations: LayerRegistryEntry[] = [
      { kind: "annotation", id: "elem-1", label: "a", visible: true, order: 0 },
      dataEntry("dl:a", TEAL, true, 0),
    ];
    expect(
      diffDataLayerIds([dataEntry("dl:a", TEAL)], withAnnotations),
    ).toEqual({
      added: [],
      removed: [],
      orderChanged: false,
    });
  });

  it("does not call an interleaved annotation removal a reorder", () => {
    const prev: LayerRegistryEntry[] = [
      dataEntry("dl:a", TEAL, true, 0),
      { kind: "annotation", id: "elem-1", label: "a", visible: true, order: 0 },
      dataEntry("dl:b", TEAL, true, 1),
    ];
    const next: LayerRegistryEntry[] = [
      dataEntry("dl:a", TEAL, true, 0),
      dataEntry("dl:b", TEAL, true, 1),
    ];
    expect(diffDataLayerIds(prev, next).orderChanged).toBe(false);
  });

  it("does not call a mid-array insertion a reorder of the survivors", () => {
    expect(
      diffDataLayerIds(
        [dataEntry("dl:a", TEAL, true, 0), dataEntry("dl:b", TEAL, true, 1)],
        [
          dataEntry("dl:a", TEAL, true, 0),
          dataEntry("dl:mid", TEAL, true, 1),
          dataEntry("dl:b", TEAL, true, 2),
        ],
      ),
    ).toEqual({ added: ["dl:mid"], removed: [], orderChanged: false });
  });
});

// ---------------------------------------------------------------------------
// The store → map subscriber, through the real hook.
//
// The factories above are all pure; the bugs this section pins are in the
// wiring — a store mutation that never reaches MapLibre. Only the hook can show
// that, so this is the one place we mount it.
// ---------------------------------------------------------------------------

/** Stub map that models MapLibre's layer list well enough to assert z-order. */
function makeSubscriberStubMap() {
  const order: string[] = [];
  const sources = new Set<string>();
  const map = {
    addSource: vi.fn((id: string) => {
      sources.add(id);
    }),
    addLayer: vi.fn((spec: { id: string }) => {
      order.push(spec.id);
    }),
    removeSource: vi.fn((id: string) => {
      sources.delete(id);
    }),
    removeLayer: vi.fn((id: string) => {
      const i = order.indexOf(id);
      if (i !== -1) {
        order.splice(i, 1);
      }
    }),
    getLayer: vi.fn((id: string) => (order.includes(id) ? { id } : undefined)),
    getSource: vi.fn((id: string) => (sources.has(id) ? { id } : undefined)),
    setLayoutProperty: vi.fn(),
    setPaintProperty: vi.fn(),
    getLayersOrder: vi.fn(() => [...order]),
    moveLayer: vi.fn((id: string, beforeId?: string) => {
      const from = order.indexOf(id);
      if (from === -1) {
        throw new Error(`The layer '${id}' does not exist in the map's style`);
      }
      order.splice(from, 1);
      if (beforeId === undefined) {
        order.push(id);
        return;
      }
      const at = order.indexOf(beforeId);
      if (at === -1) {
        throw new Error(
          `The layer '${beforeId}' does not exist in the map's style`,
        );
      }
      order.splice(at, 0, id);
    }),
  };
  return {
    map: map as unknown as maplibregl.Map,
    raw: map,
    order: () => [...order],
  };
}

describe("useLayerRegistrySync — store → map subscriber", () => {
  beforeEach(() => {
    vi.clearAllMocks();
    useLayerRegistryStore.setState({ entries: [] });
    useDataLayerFCStore.getState().clear();
    vi.spyOn(console, "warn").mockImplementation(() => {});
  });

  afterEach(() => {
    cleanup();
    vi.restoreAllMocks();
  });

  function mountWith(map: maplibregl.Map) {
    return renderHook(() => useLayerRegistrySync(map, null));
  }

  it("reorder repaints — a permuted registry restacks the MapLibre style (P3)", () => {
    const { map, order } = makeSubscriberStubMap();
    mountWith(map);
    const registry = useLayerRegistryStore.getState();
    registry.registerDataLayer({
      id: "dl:a",
      fc: POLY_FC,
      label: "a",
      style: TEAL,
    });
    registry.registerDataLayer({
      id: "dl:b",
      fc: POINT_FC,
      label: "b",
      style: TEAL,
    });
    expect(order()).toEqual(["dl:a", "dl:b"]);

    // "Move dl:b up" in the panel — index 0 within the data-layer stack.
    useLayerRegistryStore.getState().reorder("dl:b", 0);

    expect(order()).toEqual(["dl:b", "dl:a"]);
  });

  it("never asks MapLibre to move an annotation entry", () => {
    const { map, raw } = makeSubscriberStubMap();
    mountWith(map);
    const registry = useLayerRegistryStore.getState();
    registry.registerAnnotation("elem-1", "Rectangle");
    registry.registerAnnotation("elem-2", "Ellipse");
    registry.registerDataLayer({
      id: "dl:a",
      fc: POLY_FC,
      label: "a",
      style: TEAL,
    });
    registry.registerDataLayer({
      id: "dl:b",
      fc: POINT_FC,
      label: "b",
      style: TEAL,
    });

    useLayerRegistryStore.getState().reorder("elem-2", 0);

    expect(raw.moveLayer).not.toHaveBeenCalled();
  });

  it("adds a data layer whose arrival didn't change entries.length (D)", () => {
    const { map, raw } = makeSubscriberStubMap();
    mountWith(map);
    useLayerRegistryStore.getState().registerAnnotation("elem-1", "Rectangle");
    raw.addLayer.mockClear();

    // convertAnnotationToDataLayer: one entry out, one in, same length.
    useLayerRegistryStore
      .getState()
      .convertAnnotationToDataLayer("elem-1", POLY_FC);

    expect(raw.addLayer).toHaveBeenCalledTimes(1);
    expect(raw.addLayer.mock.calls[0][0].id).toMatch(/^dl:/);
  });

  it("removes the previous document's layers when the registry drops them (D)", () => {
    const { map, raw, order } = makeSubscriberStubMap();
    mountWith(map);
    useLayerRegistryStore.getState().registerDataLayer({
      id: "dl:old",
      fc: POLY_FC,
      label: "old",
      style: TEAL,
    });
    expect(order()).toEqual(["dl:old"]);

    // What hydrate() does: swap the whole entries array for another document's.
    useDataLayerFCStore.getState().set("dl:new", POINT_FC);
    useLayerRegistryStore.setState({
      entries: [dataEntry("dl:new", TEAL, true, 0)],
    });

    expect(raw.removeLayer).toHaveBeenCalledWith("dl:old");
    expect(raw.removeSource).toHaveBeenCalledWith("dl:old");
    expect(order()).toEqual(["dl:new"]);
  });

  it("removes a single deleted data layer from the style", () => {
    const { map, raw, order } = makeSubscriberStubMap();
    mountWith(map);
    const registry = useLayerRegistryStore.getState();
    registry.registerDataLayer({
      id: "dl:a",
      fc: POLY_FC,
      label: "a",
      style: TEAL,
    });
    registry.registerDataLayer({
      id: "dl:b",
      fc: POINT_FC,
      label: "b",
      style: TEAL,
    });

    useLayerRegistryStore.getState().remove("dl:a");

    expect(raw.removeLayer).toHaveBeenCalledWith("dl:a");
    expect(order()).toEqual(["dl:b"]);
  });

  it("issues no moveLayer for a plain visibility toggle", () => {
    const { map, raw } = makeSubscriberStubMap();
    mountWith(map);
    const registry = useLayerRegistryStore.getState();
    registry.registerDataLayer({
      id: "dl:a",
      fc: POLY_FC,
      label: "a",
      style: TEAL,
    });
    registry.registerDataLayer({
      id: "dl:b",
      fc: POINT_FC,
      label: "b",
      style: TEAL,
    });
    raw.moveLayer.mockClear();

    useLayerRegistryStore.getState().setVisibility("dl:a", false);

    expect(raw.setLayoutProperty).toHaveBeenCalledWith(
      "dl:a",
      "visibility",
      "none",
    );
    expect(raw.moveLayer).not.toHaveBeenCalled();
  });

  it("stops touching the map after unmount", () => {
    const { map, raw } = makeSubscriberStubMap();
    const { unmount } = mountWith(map);
    unmount();
    useLayerRegistryStore.getState().registerDataLayer({
      id: "dl:a",
      fc: POLY_FC,
      label: "a",
      style: TEAL,
    });
    expect(raw.addLayer).not.toHaveBeenCalled();
  });
});
