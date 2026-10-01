// SPDX-License-Identifier: AGPL-3.0-only
//
// Tests for the map overlays: overlaySpec (document → sources and layers) and
// the reconciler that writes them. The map is FakeMapLibre, which keeps
// MapLibre's style state and fires "error" like MapLibre 4.7. Every assertion
// reads the resulting style state.

import { describe, expect, it } from "vitest";

import { outlineLayerId } from "@atlasdraw/basemap";

import { createDocument, type DocumentState } from "../state/document";

import { FakeMapLibre } from "./__tests__/fixtures/fakeMapLibre";
import {
  COLLAB_OVERLAY_ID,
  createMapOverlays,
  overlaySpec,
  validateLayerStyle,
  type OverlaySpec,
  type StyleTarget,
} from "./mapOverlays";

import type { RasterCorners } from "../state/document";
import type { FeatureCollection } from "geojson";

const asTarget = (m: FakeMapLibre) => m as unknown as StyleTarget;

const CORNERS: RasterCorners = [
  [77.4, 17.95],
  [77.6, 17.95],
  [77.6, 17.85],
  [77.4, 17.85],
];

const POINTS: FeatureCollection = {
  type: "FeatureCollection",
  features: [
    {
      type: "Feature",
      properties: { n: 1 },
      geometry: { type: "Point", coordinates: [77.5, 17.9] },
    },
  ],
};

const SQUARE: FeatureCollection = {
  type: "FeatureCollection",
  features: [
    {
      type: "Feature",
      properties: {},
      geometry: {
        type: "Polygon",
        coordinates: [
          [
            [77, 17],
            [78, 17],
            [78, 18],
            [77, 17],
          ],
        ],
      },
    },
  ],
};

const STYLE = {
  fillColor: "#0aa",
  strokeColor: "#077",
  strokeWidth: 1,
  opacity: 0.5,
};

/** A document to build specs from, driven by commands like the editor. */
function doc() {
  const d = createDocument();
  const spec = (): OverlaySpec =>
    overlaySpec(d.snapshot(), { imageUrl: (id) => `blob:test/${id}` });
  return { d, spec };
}

/** A basemap with one fill layer under one label layer. */
function basemap(): FakeMapLibre {
  const map = new FakeMapLibre();
  map.addSource("osm", {
    type: "geojson",
    data: { type: "FeatureCollection", features: [] },
  });
  map.addLayer({ id: "land", type: "fill", source: "osm" });
  map.addLayer({
    id: "places",
    type: "symbol",
    source: "osm",
    layout: { "icon-image": "dot" },
  });
  expect(map.errors).toEqual([]);
  return map;
}

describe("overlaySpec", () => {
  it("puts rasters below data layers, each band in document order", () => {
    const { d, spec } = doc();
    d.dispatch({
      type: "add-data-layer",
      id: "dl:a",
      fc: POINTS,
      label: "a",
      style: STYLE,
    });
    d.dispatch({
      type: "add-raster-layer",
      id: "rl:r",
      label: "r",
      corners: CORNERS,
      imageKey: "r.png",
      image: new Blob(["png"]),
    });
    d.dispatch({
      type: "add-data-layer",
      id: "dl:b",
      fc: SQUARE,
      label: "b",
      style: STYLE,
    });

    expect(spec().layers.map((l) => l.spec.id)).toEqual([
      "rl:r",
      "dl:a",
      "dl:b",
      outlineLayerId("dl:b"),
    ]);
  });

  it("rejects an overlay whose style MapLibre would reject, with the reason", () => {
    const { d, spec } = doc();
    d.dispatch({
      type: "add-data-layer",
      id: "dl:a",
      fc: POINTS,
      label: "a",
      style: {
        ...STYLE,
        expression: {
          kind: "categorical",
          property: "kind",
          stops: [
            { value: "", color: "#111111" },
            { value: "", color: "#222222" },
          ],
          fallback: "#000000",
        },
      },
    });

    const s = spec();
    expect(s.layers).toEqual([]);
    expect(s.rejected).toEqual([
      { overlayId: "dl:a", reason: expect.stringMatching(/unique/i) },
    ]);
  });

  it("draws the collaboration layer on top", () => {
    const { d } = doc();
    d.dispatch({
      type: "add-data-layer",
      id: "dl:a",
      fc: POINTS,
      label: "a",
      style: STYLE,
    });
    const s = overlaySpec(d.snapshot(), { collab: SQUARE });
    expect(s.layers.map((l) => l.spec.id).slice(-2)).toEqual([
      COLLAB_OVERLAY_ID,
      outlineLayerId(COLLAB_OVERLAY_ID),
    ]);
  });
});

describe("validateLayerStyle", () => {
  it("accepts the default style for every geometry kind", () => {
    for (const kind of ["fill", "line", "circle"] as const) {
      expect(validateLayerStyle(STYLE, kind)).toEqual([]);
    }
  });

  it("names the defect in graduated stops that do not ascend", () => {
    expect(
      validateLayerStyle(
        {
          ...STYLE,
          expression: {
            kind: "graduated",
            property: "v",
            method: "quantile",
            stops: [
              { stop: 0, color: "#000000" },
              { stop: 0, color: "#111111" },
            ],
            fallback: "#cccccc",
          },
        },
        "circle",
      ),
    ).toEqual([expect.stringMatching(/ascending/i)]);
  });
});

describe("createMapOverlays — apply", () => {
  it("draws overlays beneath the basemap's labels", () => {
    const { d, spec } = doc();
    d.dispatch({
      type: "add-data-layer",
      id: "dl:a",
      fc: SQUARE,
      label: "a",
      style: STYLE,
    });
    const map = basemap();

    const report = createMapOverlays(asTarget(map)).apply(spec());

    expect(report.get("dl:a")).toEqual({ status: "landed" });
    expect(map.getLayersOrder()).toEqual([
      "land",
      "dl:a",
      outlineLayerId("dl:a"),
      "places",
    ]);
  });

  it("changes a polygon's stroke width in place, on the outline layer", () => {
    const { d, spec } = doc();
    d.dispatch({
      type: "add-data-layer",
      id: "dl:a",
      fc: SQUARE,
      label: "a",
      style: STYLE,
    });
    const map = basemap();
    const overlays = createMapOverlays(asTarget(map));
    overlays.apply(spec());
    const fillBefore = map.layers.get("dl:a");

    d.dispatch({ type: "restyle", id: "dl:a", patch: { strokeWidth: 4 } });
    overlays.apply(spec());

    expect(map.layers.get(outlineLayerId("dl:a"))?.paint["line-width"]).toBe(4);
    expect(map.layers.get("dl:a")).toBe(fillBefore);
    expect(map.errors).toEqual([]);
  });

  it("hides, restacks and removes a raster", () => {
    const { d, spec } = doc();
    for (const id of ["rl:a", "rl:b"]) {
      d.dispatch({
        type: "add-raster-layer",
        id,
        label: id,
        corners: CORNERS,
        imageKey: `${id}.png`,
        image: new Blob([id]),
      });
    }
    const map = basemap();
    const overlays = createMapOverlays(asTarget(map));
    overlays.apply(spec());

    d.dispatch({ type: "set-visibility", id: "rl:a", visible: false });
    d.dispatch({ type: "reorder", id: "rl:a", order: 1 });
    overlays.apply(spec());
    expect(map.getLayoutProperty("rl:a", "visibility")).toBe("none");
    expect(map.topFirst(["rl:a", "rl:b"])).toEqual(["rl:a", "rl:b"]);

    d.dispatch({ type: "remove-layer", id: "rl:a" });
    overlays.apply(spec());
    expect(map.getLayer("rl:a")).toBeUndefined();
    expect(map.getSource("rl:a")).toBeUndefined();
    expect(map.draws("rl:b")).toBe(true);
    expect(map.errors).toEqual([]);
  });

  it("puts every overlay back after the basemap style dropped them", () => {
    const { d, spec } = doc();
    d.dispatch({
      type: "add-data-layer",
      id: "dl:a",
      fc: POINTS,
      label: "a",
      style: STYLE,
    });
    const map = basemap();
    const overlays = createMapOverlays(asTarget(map));
    const s = spec();
    overlays.apply(s);

    // A new style: MapLibre drops every source and layer, then loads the
    // basemap's own.
    for (const id of map.getLayersOrder()) {
      map.removeLayer(id);
    }
    for (const id of Array.from(map.sources.keys())) {
      map.removeSource(id);
    }
    const fresh = basemap();
    for (const [id, source] of fresh.sources) {
      map.addSource(id, source);
    }
    for (const id of fresh.getLayersOrder()) {
      map.addLayer(fresh.layers.get(id)!.spec);
    }

    overlays.apply(s);
    expect(map.getLayersOrder()).toEqual(["land", "dl:a", "places"]);
    expect(map.errors).toEqual([]);
  });

  it("replaces a layer's data when the FeatureCollection changes", () => {
    const map = basemap();
    const overlays = createMapOverlays(asTarget(map));
    overlays.apply(
      overlaySpec(createDocument().snapshot(), { collab: POINTS }),
    );

    const next: FeatureCollection = {
      ...POINTS,
      features: [...POINTS.features, ...POINTS.features],
    };
    overlays.apply(overlaySpec(createDocument().snapshot(), { collab: next }));

    expect(map.getSource(COLLAB_OVERLAY_ID)).toMatchObject({ data: next });
    expect(map.draws(COLLAB_OVERLAY_ID)).toBe(true);

    overlays.apply(overlaySpec(createDocument().snapshot(), { collab: null }));
    expect(map.getSource(COLLAB_OVERLAY_ID)).toBeUndefined();
  });

  it("reports a layer MapLibre rejects with the reason from its error event", () => {
    const state: Pick<
      DocumentState,
      "overlays" | "featureCollections" | "images"
    > = { overlays: [], featureCollections: {}, images: {} };
    const s = overlaySpec(state, { collab: POINTS });
    // A paint value no validator in this module saw.
    const bad: OverlaySpec = {
      ...s,
      layers: s.layers.map((l) => ({
        ...l,
        spec: { ...l.spec, paint: { "circle-radius": "large" } },
      })) as OverlaySpec["layers"],
    };
    const map = basemap();

    const report = createMapOverlays(asTarget(map)).apply(bad);

    expect(report.get(COLLAB_OVERLAY_ID)).toEqual({
      status: "rejected",
      reason: expect.stringMatching(/number expected/i),
    });
    expect(map.getLayer(COLLAB_OVERLAY_ID)).toBeUndefined();
  });
});
