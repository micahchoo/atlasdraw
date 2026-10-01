// SPDX-License-Identifier: AGPL-3.0-only
//
// A style the map cannot draw is refused at dispatch, whoever sends it: the
// style panel, the layer panel's width box, a room, an import. The check is
// the style panel's own (lib/layerStyle.ts#validateLayerStyle).

import { describe, expect, it } from "vitest";

import { createDocument, type DataLayerEntry } from "../document";

import type { FeatureCollection } from "geojson";

const FC: FeatureCollection = {
  type: "FeatureCollection",
  features: [
    {
      type: "Feature",
      properties: { name: "a" },
      geometry: {
        type: "LineString",
        coordinates: [
          [0, 0],
          [1, 1],
        ],
      },
    },
  ],
};

function withLayer() {
  const doc = createDocument();
  doc.dispatch({
    type: "add-data-layer",
    id: "dl:roads",
    fc: FC,
    label: "Roads",
    style: { strokeColor: "#333", strokeWidth: 2 },
  });
  return doc;
}

const roads = (doc: ReturnType<typeof createDocument>) =>
  doc.snapshot().overlays.find((e) => e.id === "dl:roads") as DataLayerEntry;

describe("style commands", () => {
  it("applies a style the map can draw", () => {
    const doc = withLayer();
    const result = doc.dispatch({
      type: "restyle",
      id: "dl:roads",
      patch: { strokeWidth: 4 },
    });
    expect(result).toEqual({ ok: true });
    expect(roads(doc).style.strokeWidth).toBe(4);
  });

  it("refuses a negative width with a reason, and keeps the old style", () => {
    const doc = withLayer();
    const before = doc.revision;
    const result = doc.dispatch({
      type: "restyle",
      id: "dl:roads",
      patch: { strokeWidth: -5 },
    });
    expect(result.ok).toBe(false);
    expect(!result.ok && result.reason).toMatch(/width/i);
    expect(roads(doc).style.strokeWidth).toBe(2);
    expect(doc.revision).toBe(before);
  });

  it("refuses a filter that would throw while it compiles", () => {
    const doc = withLayer();
    const result = doc.dispatch({
      type: "restyle",
      id: "dl:roads",
      patch: {
        filter: { property: "name", op: "contains", value: 5 as never },
      },
    });
    expect(result.ok).toBe(false);
    expect(roads(doc).style.filter).toBeUndefined();
  });

  it("refuses a new layer whose style cannot draw", () => {
    const doc = createDocument();
    const result = doc.dispatch({
      type: "add-data-layer",
      id: "dl:bad",
      fc: FC,
      label: "Bad",
      style: { opacity: 7 },
    });
    expect(result.ok).toBe(false);
    expect(doc.snapshot().overlays).toEqual([]);
  });

  it("refuses content from a room that carries a style the map cannot draw", () => {
    const doc = withLayer();
    const entry = roads(doc);
    const result = doc.dispatch({
      type: "replace-content",
      title: "Shared",
      overlays: [{ ...entry, style: { strokeWidth: -1 } }],
      featureCollections: doc.snapshot().featureCollections,
      images: {},
    });
    expect(result.ok).toBe(false);
    expect(roads(doc).style.strokeWidth).toBe(2);
  });
});
