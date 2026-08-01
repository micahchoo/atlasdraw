// @atlasdraw/data — tests for the observeDeep + keyed-cache layer projection.
//
// Contract under test: after EVERY mutation kind yjs-layer.ts exports, the
// observer fires and its snapshot deep-equals a full `toGeoJSON(layer)`
// rebuild. The shallow-`observe` predecessor missed appendVertex /
// deleteVertex / setProperty entirely.

import { describe, expect, it } from "vitest";

import {
  YjsLayer,
  addFeature,
  appendVertex,
  deleteFeature,
  deleteVertex,
  setProperty,
} from "./yjs-layer.js";
import { observeLayer, toGeoJSON } from "./yjs-snapshot.js";

import type { FeatureCollection } from "geojson";

function makeLayer() {
  const yjsLayer = new YjsLayer();
  const layer = yjsLayer.getOrCreateLayer("default");
  addFeature(
    layer,
    "line-1",
    "LineString",
    [
      [
        [0, 0],
        [1, 1],
      ],
    ],
    { stroke: "#f00" },
  );
  addFeature(layer, "poly-1", "Polygon", [
    [
      [10, 10],
      [11, 10],
      [11, 11],
      [10, 10],
    ],
  ]);
  return layer;
}

describe("toGeoJSON", () => {
  it("converts features with geometry, id, and properties", () => {
    const layer = makeLayer();
    const fc = toGeoJSON(layer);
    expect(fc.features).toHaveLength(2);
    const line = fc.features.find((f) => f.id === "line-1")!;
    expect(line.geometry).toEqual({
      type: "LineString",
      coordinates: [
        [
          [0, 0],
          [1, 1],
        ],
      ],
    });
    expect(line.properties).toEqual({ stroke: "#f00" });
    const poly = fc.features.find((f) => f.id === "poly-1")!;
    expect(poly.properties).toBeNull();
  });
});

describe("observeLayer", () => {
  it("fires synchronously with the initial snapshot", () => {
    const layer = makeLayer();
    const snapshots: FeatureCollection[] = [];
    const unsubscribe = observeLayer(layer, (s) => snapshots.push(s));
    expect(snapshots).toHaveLength(1);
    expect(snapshots[0]).toEqual(toGeoJSON(layer));
    unsubscribe();
  });

  it("fires for every mutator and always matches a full rebuild", () => {
    const layer = makeLayer();
    const snapshots: FeatureCollection[] = [];
    const unsubscribe = observeLayer(layer, (s) => snapshots.push(s));

    const mutations: Array<[string, () => void]> = [
      ["addFeature", () => addFeature(layer, "pt-1", "Point", [[[5, 5]]])],
      // These three never fired under shallow observe — the fixed bug.
      ["appendVertex", () => appendVertex(layer, "line-1", 0, [2, 2])],
      ["setProperty", () => setProperty(layer, "line-1", "stroke", "#0f0")],
      ["deleteVertex", () => deleteVertex(layer, "poly-1", 0, 1)],
      ["deleteFeature", () => deleteFeature(layer, "poly-1")],
    ];

    let expectedFires = 1;
    for (const [label, mutate] of mutations) {
      mutate();
      expectedFires++;
      expect(snapshots, `observer did not fire for ${label}`).toHaveLength(
        expectedFires,
      );
      expect(
        snapshots[snapshots.length - 1],
        `snapshot after ${label} diverged from full rebuild`,
      ).toEqual(toGeoJSON(layer));
    }
    unsubscribe();
  });

  it("reflects a nested edit in the snapshot content", () => {
    const layer = makeLayer();
    let latest: FeatureCollection | null = null;
    const unsubscribe = observeLayer(layer, (s) => (latest = s));

    appendVertex(layer, "line-1", 0, [9, 9]);
    const line = latest!.features.find((f) => f.id === "line-1")!;
    expect(line.geometry).toEqual({
      type: "LineString",
      coordinates: [
        [
          [0, 0],
          [1, 1],
          [9, 9],
        ],
      ],
    });

    setProperty(layer, "line-1", "stroke", "#00f");
    expect(latest!.features.find((f) => f.id === "line-1")!.properties).toEqual(
      { stroke: "#00f" },
    );
    unsubscribe();
  });

  it("reuses untouched Feature objects between snapshots (keyed cache)", () => {
    const layer = makeLayer();
    const snapshots: FeatureCollection[] = [];
    const unsubscribe = observeLayer(layer, (s) => snapshots.push(s));

    appendVertex(layer, "line-1", 0, [3, 3]);
    const [before, after] = snapshots.slice(-2);
    const untouchedBefore = before.features.find((f) => f.id === "poly-1");
    const untouchedAfter = after.features.find((f) => f.id === "poly-1");
    expect(untouchedAfter).toBe(untouchedBefore); // identity, not just equality
    const touchedAfter = after.features.find((f) => f.id === "line-1");
    expect(touchedAfter).not.toBe(
      before.features.find((f) => f.id === "line-1"),
    );
    unsubscribe();
  });

  it("stops firing after unsubscribe", () => {
    const layer = makeLayer();
    const snapshots: FeatureCollection[] = [];
    const unsubscribe = observeLayer(layer, (s) => snapshots.push(s));
    unsubscribe();
    appendVertex(layer, "line-1", 0, [4, 4]);
    deleteFeature(layer, "poly-1");
    expect(snapshots).toHaveLength(1);
  });

  it("handles delete + re-add of the same id in one transaction", () => {
    const layer = makeLayer();
    let latest: FeatureCollection | null = null;
    const unsubscribe = observeLayer(layer, (s) => (latest = s));

    layer.doc!.transact(() => {
      deleteFeature(layer, "line-1");
      addFeature(layer, "line-1", "Point", [[[7, 7]]]);
    });

    expect(latest).toEqual(toGeoJSON(layer));
    expect(latest!.features.find((f) => f.id === "line-1")!.geometry).toEqual({
      type: "Point",
      coordinates: [[[7, 7]]],
    });
    unsubscribe();
  });
});
