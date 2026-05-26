// @atlasdraw/data — YjsLayer CRDT type model tests.
// Phase 5 Task 4: CRDT-native feature storage with conflict-free vertex edits.

import { describe, it, expect } from "vitest";
import * as Y from "yjs";

import {
  YjsLayer,
  addFeature,
  deleteFeature,
  appendVertex,
  deleteVertex,
  setProperty,
} from "../src/yjs-layer";

describe("YjsLayer basic structure", () => {
  it("creates a Y.Doc and exposes the root layers map", () => {
    const yl = new YjsLayer();
    expect(yl.doc).toBeInstanceOf(Y.Doc);
    const layers = yl.getLayers();
    expect(layers).toBeInstanceOf(Y.Map);
  });

  it("getOrCreateLayer returns an existing or new named layer", () => {
    const yl = new YjsLayer();
    const roads = yl.getOrCreateLayer("roads");
    expect(roads).toBeInstanceOf(Y.Map);

    // Same reference on second call
    const roadsAgain = yl.getOrCreateLayer("roads");
    expect(roadsAgain).toBe(roads);

    // Different layer is distinct
    const buildings = yl.getOrCreateLayer("buildings");
    expect(buildings).not.toBe(roads);
  });
});

describe("addFeature", () => {
  it("creates a feature in the correct layer map", () => {
    const yl = new YjsLayer();
    const layer = yl.getOrCreateLayer("test-layer");

    addFeature(
      layer,
      "feat-1",
      "LineString",
      [
        [
          [0, 0],
          [1, 1],
          [2, 2],
        ],
      ],
      {
        name: "test feature",
      },
    );

    expect(layer.has("feat-1")).toBe(true);

    const featMap = layer.get("feat-1") as Y.Map<unknown>;
    expect(featMap.get("type")).toBe("Feature");

    const geometry = featMap.get("geometry") as Y.Map<unknown>;
    expect(geometry).toBeDefined();
    expect(geometry.get("type")).toBe("LineString");

    const coords = geometry.get("coordinates") as Y.Array<
      Y.Array<Y.Array<number>>
    >;
    expect(coords).toBeDefined();
    expect(coords.length).toBe(1); // one ring
    const ring = coords.get(0);
    expect(ring.length).toBe(3); // three vertices

    // Check first vertex
    const v0 = ring.get(0);
    expect(v0.toArray()).toEqual([0, 0]);

    // Check properties
    const props = featMap.get("properties") as Y.Map<unknown>;
    expect(props).toBeDefined();
    expect(props.get("name")).toBe("test feature");
  });

  it("supports Polygon geometry with multiple rings", () => {
    const yl = new YjsLayer();
    const layer = yl.getOrCreateLayer("shapes");

    // Polygon with exterior ring + hole
    addFeature(layer, "poly-1", "Polygon", [
      [
        [0, 0],
        [10, 0],
        [10, 10],
        [0, 10],
        [0, 0],
      ], // exterior
      [
        [2, 2],
        [8, 2],
        [8, 8],
        [2, 8],
        [2, 2],
      ], // hole
    ]);

    const featMap = layer.get("poly-1") as Y.Map<unknown>;
    const geometry = featMap.get("geometry") as Y.Map<unknown>;
    const coords = geometry.get("coordinates") as Y.Array<
      Y.Array<Y.Array<number>>
    >;

    expect(coords.length).toBe(2); // two rings
    expect(coords.get(0).length).toBe(5); // 5 vertices in outer ring
    expect(coords.get(1).length).toBe(5); // 5 vertices in hole
  });

  it("supports features without properties", () => {
    const yl = new YjsLayer();
    const layer = yl.getOrCreateLayer("bare");

    addFeature(layer, "bare-1", "Point", [[[1, 2]]]);

    const featMap = layer.get("bare-1") as Y.Map<unknown>;
    const props = featMap.get("properties") as Y.Map<unknown>;
    expect(props).toBeDefined();
    // Properties map exists but is empty
  });
});

describe("deleteFeature", () => {
  it("removes a feature from the layer map", () => {
    const yl = new YjsLayer();
    const layer = yl.getOrCreateLayer("data");

    addFeature(layer, "feat-1", "LineString", [
      [
        [0, 0],
        [1, 1],
      ],
    ]);
    expect(layer.has("feat-1")).toBe(true);

    deleteFeature(layer, "feat-1");
    expect(layer.has("feat-1")).toBe(false);
  });

  it("is a no-op when feature does not exist", () => {
    const yl = new YjsLayer();
    const layer = yl.getOrCreateLayer("data");
    // Should not throw
    deleteFeature(layer, "nonexistent");
    expect(layer.size).toBe(0);
  });
});

describe("appendVertex", () => {
  it("appends a vertex to the specified ring", () => {
    const yl = new YjsLayer();
    const layer = yl.getOrCreateLayer("lines");

    addFeature(layer, "line-1", "LineString", [
      [
        [0, 0],
        [1, 1],
      ],
    ]);

    appendVertex(layer, "line-1", 0, [2, 2]);

    const featMap = layer.get("line-1") as Y.Map<unknown>;
    const geometry = featMap.get("geometry") as Y.Map<unknown>;
    const coords = geometry.get("coordinates") as Y.Array<
      Y.Array<Y.Array<number>>
    >;
    const ring = coords.get(0);

    expect(ring.length).toBe(3);
    const last = ring.get(2);
    expect(last.toArray()).toEqual([2, 2]);
  });

  it("throws when feature does not exist", () => {
    const yl = new YjsLayer();
    const layer = yl.getOrCreateLayer("empty");

    expect(() => appendVertex(layer, "ghost", 0, [1, 1])).toThrow(
      'Feature "ghost" not found',
    );
  });

  it("throws when ring index is out of range", () => {
    const yl = new YjsLayer();
    const layer = yl.getOrCreateLayer("data");
    addFeature(layer, "f1", "Polygon", [
      [
        [0, 0],
        [1, 0],
        [1, 1],
        [0, 1],
        [0, 0],
      ],
    ]);

    expect(() => appendVertex(layer, "f1", 99, [5, 5])).toThrow(
      "Ring index 99 not found",
    );
  });
});

describe("deleteVertex", () => {
  it("removes a vertex from the specified ring", () => {
    const yl = new YjsLayer();
    const layer = yl.getOrCreateLayer("lines");

    addFeature(layer, "line-1", "LineString", [
      [
        [0, 0],
        [1, 1],
        [2, 2],
      ],
    ]);

    deleteVertex(layer, "line-1", 0, 1); // remove middle vertex

    const featMap = layer.get("line-1") as Y.Map<unknown>;
    const geometry = featMap.get("geometry") as Y.Map<unknown>;
    const coords = geometry.get("coordinates") as Y.Array<
      Y.Array<Y.Array<number>>
    >;
    const ring = coords.get(0);

    expect(ring.length).toBe(2);
    expect(ring.get(0).toArray()).toEqual([0, 0]);
    expect(ring.get(1).toArray()).toEqual([2, 2]);
  });
});

describe("setProperty", () => {
  it("sets a property value on a feature", () => {
    const yl = new YjsLayer();
    const layer = yl.getOrCreateLayer("data");

    addFeature(layer, "f1", "Point", [[[0, 0]]], { color: "red" });

    setProperty(layer, "f1", "color", "blue");
    setProperty(layer, "f1", "opacity", 0.5);

    const featMap = layer.get("f1") as Y.Map<unknown>;
    const props = featMap.get("properties") as Y.Map<unknown>;
    expect(props.get("color")).toBe("blue");
    expect(props.get("opacity")).toBe(0.5);
  });

  it("throws when feature does not exist", () => {
    const yl = new YjsLayer();
    const layer = yl.getOrCreateLayer("data");

    expect(() => setProperty(layer, "ghost", "key", "val")).toThrow(
      'Feature "ghost" not found',
    );
  });
});

describe("CRDT concurrent appendVertex", () => {
  it("merges concurrent vertex appends from two Y.Doc replicas without data loss", () => {
    // Create docA with initial polygon
    const ylA = new YjsLayer();
    const layerA = ylA.getOrCreateLayer("shapes");
    addFeature(layerA, "poly-1", "Polygon", [
      [
        [0, 0],
        [10, 0],
        [10, 10],
        [0, 10],
        [0, 0],
      ],
    ]);

    // Serialize docA state and apply to docB
    const stateA = Y.encodeStateAsUpdate(ylA.doc);
    const docB = new Y.Doc();
    Y.applyUpdate(docB, stateA);
    const layersB = docB.getMap("layers") as Y.Map<Y.Map<Y.Map<unknown>>>;
    const layerB = layersB.get("shapes") as Y.Map<Y.Map<unknown>>;

    // Concurrently append different vertices (no sync between)
    appendVertex(layerA, "poly-1", 0, [20, 20]);
    appendVertex(layerB, "poly-1", 0, [-10, -10]);

    // Sync both ways — CRDT merge
    const updateA = Y.encodeStateAsUpdate(ylA.doc);
    const updateB = Y.encodeStateAsUpdate(docB);
    Y.applyUpdate(docB, updateA);
    Y.applyUpdate(ylA.doc, updateB);

    // --- Assert docA ---
    const featA = layerA.get("poly-1") as Y.Map<unknown>;
    const geoA = featA.get("geometry") as Y.Map<unknown>;
    const coordsA = geoA.get("coordinates") as Y.Array<
      Y.Array<Y.Array<number>>
    >;
    const ringA = coordsA.get(0);

    const verticesA = ringA
      .toArray()
      .map((p) => p.toArray() as [number, number]);
    expect(verticesA).toContainEqual([20, 20]);
    expect(verticesA).toContainEqual([-10, -10]);
    // Original vertices preserved
    expect(verticesA).toContainEqual([0, 0]);
    expect(verticesA).toContainEqual([10, 0]);
    expect(verticesA).toContainEqual([10, 10]);
    expect(verticesA).toContainEqual([0, 10]);
    // No duplication — total vertices = 5 original + 2 appended = 7
    expect(verticesA.length).toBe(7);

    // --- Assert docB (identical result) ---
    const featB = layerB.get("poly-1") as Y.Map<unknown>;
    const geoB = featB.get("geometry") as Y.Map<unknown>;
    const coordsB = geoB.get("coordinates") as Y.Array<
      Y.Array<Y.Array<number>>
    >;
    const ringB = coordsB.get(0);

    const verticesB = ringB
      .toArray()
      .map((p) => p.toArray() as [number, number]);
    expect(verticesB).toEqual(verticesA);
  });
});
