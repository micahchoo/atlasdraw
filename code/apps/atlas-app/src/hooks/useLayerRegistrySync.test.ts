// SPDX-License-Identifier: AGPL-3.0-only
//
// Tests for useLayerRegistrySync (Phase 2 W-A — Bug A + Bug B).
//
// We test the exported factory functions directly rather than driving the
// React hook — same approach as useGeoAnchor.test.ts and useAtlasdrawTool.test.ts
// (no @testing-library/react dep needed). The hook itself is a thin
// useEffect wrapper around these factories; the React seam is covered by the
// hooks lifecycle, not by us.

import { describe, it, expect, vi, beforeEach } from "vitest";

import {
  buildSceneDiffHandler,
  generateLayerLabel,
  applyVisibilityToScene,
  applyVisibilityToMap,
  diffVisibility,
  ATLAS_ORIGINAL_OPACITY_KEY,
  type SyncSceneElement,
  type MapLayoutSurface,
} from "./useLayerRegistrySync";

import type { LayerRegistryEntry } from "../state/layerRegistry";

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
// Bug B — applyVisibilityToMap (data layer kind)
// ---------------------------------------------------------------------------

describe("applyVisibilityToMap — MapLibre setLayoutProperty (Bug B)", () => {
  beforeEach(() => {
    vi.clearAllMocks();
  });

  function makeMap(impl?: (id: string, name: string, value: unknown) => void) {
    const setLayoutProperty = vi.fn(impl ?? (() => {}));
    const map: MapLayoutSurface = { setLayoutProperty };
    return { map, setLayoutProperty };
  }

  it("calls setLayoutProperty with 'none' when hidden", () => {
    const { map, setLayoutProperty } = makeMap();
    applyVisibilityToMap(map, "dl:foo", false);
    expect(setLayoutProperty).toHaveBeenCalledWith(
      "dl:foo",
      "visibility",
      "none",
    );
  });

  it("calls setLayoutProperty with 'visible' when shown", () => {
    const { map, setLayoutProperty } = makeMap();
    applyVisibilityToMap(map, "dl:foo", true);
    expect(setLayoutProperty).toHaveBeenCalledWith(
      "dl:foo",
      "visibility",
      "visible",
    );
  });

  it("swallows errors when the layer doesn't exist (logs warn, no throw)", () => {
    const warn = vi.spyOn(console, "warn").mockImplementation(() => {});
    const { map } = makeMap(() => {
      throw new Error("Layer 'dl:missing' does not exist");
    });

    expect(() => applyVisibilityToMap(map, "dl:missing", false)).not.toThrow();
    expect(warn).toHaveBeenCalledTimes(1);
    expect(warn.mock.calls[0][0]).toContain("dl:missing");

    warn.mockRestore();
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
