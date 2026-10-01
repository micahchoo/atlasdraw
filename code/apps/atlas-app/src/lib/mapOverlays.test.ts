// SPDX-License-Identifier: AGPL-3.0-only
//
// Tests for the map overlays: overlaySpec (document → sources and layers) and
// the reconciler that writes them. The map is FakeMapLibre, which keeps
// MapLibre's style state and fires "error" like MapLibre 4.7. Every assertion
// reads the resulting style state.

import { describe, expect, it } from "vitest";

import { labelLayerId, outlineLayerId } from "@atlasdraw/basemap";

import { createDocument } from "../state/document";

import { FakeMapLibre } from "./__tests__/fixtures/fakeMapLibre";
import {
  createMapOverlays,
  labelFontOf,
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
    const { d } = doc();
    d.dispatch({
      type: "add-data-layer",
      id: "dl:a",
      fc: POINTS,
      label: "a",
      style: STYLE,
    });
    overlays.apply(overlaySpec(d.snapshot()));

    const next: FeatureCollection = {
      ...POINTS,
      features: [...POINTS.features, ...POINTS.features],
    };
    const held = d.snapshot();
    d.dispatch({
      type: "replace-content",
      title: held.title,
      overlays: held.overlays,
      featureCollections: { "dl:a": next },
      images: held.images,
    });
    overlays.apply(overlaySpec(d.snapshot()));

    expect(map.getSource("dl:a")).toMatchObject({ data: next });
    expect(map.draws("dl:a")).toBe(true);

    d.dispatch({ type: "remove-layer", id: "dl:a" });
    overlays.apply(overlaySpec(d.snapshot()));
    expect(map.getSource("dl:a")).toBeUndefined();
  });

  it("reports a layer MapLibre rejects with the reason from its error event", () => {
    const { d } = doc();
    d.dispatch({
      type: "add-data-layer",
      id: "dl:a",
      fc: POINTS,
      label: "a",
      style: STYLE,
    });
    const s = overlaySpec(d.snapshot());
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

    expect(report.get("dl:a")).toEqual({
      status: "rejected",
      reason: expect.stringMatching(/number expected/i),
    });
    expect(map.getLayer("dl:a")).toBeUndefined();
  });
});

describe("tile layers (W9d)", () => {
  const URL_T = "https://tiles.example.org/{z}/{x}/{y}.png";
  const addTile = (
    d: ReturnType<typeof createDocument>,
    id: string,
    url = URL_T,
  ) =>
    d.dispatch({
      type: "add-tile-layer",
      id,
      label: id,
      url,
      attribution: "© Example",
      opacity: 0.6,
    });

  it("draws tile layers as the bottom band, under rasters and data", () => {
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
    addTile(d, "tl:t");

    expect(spec().layers.map((l) => l.spec.id)).toEqual([
      "tl:t",
      "rl:r",
      "dl:a",
    ]);
  });

  it("puts an XYZ raster source and a raster layer on the map", () => {
    const { d, spec } = doc();
    addTile(d, "tl:t");
    const map = basemap();

    const report = createMapOverlays(asTarget(map)).apply(spec());

    expect(report.get("tl:t")).toEqual({ status: "landed" });
    expect(map.getSource("tl:t")).toEqual({
      type: "raster",
      tiles: [URL_T],
      tileSize: 256,
      attribution: "© Example",
    });
    expect(map.layers.get("tl:t")?.spec.type).toBe("raster");
    expect(map.layers.get("tl:t")?.paint["raster-opacity"]).toBe(0.6);
    expect(map.getLayersOrder()).toEqual(["land", "tl:t", "places"]);
    expect(map.errors).toEqual([]);
  });

  it("fades and hides a tile layer in place", () => {
    const { d, spec } = doc();
    addTile(d, "tl:t");
    const map = basemap();
    const overlays = createMapOverlays(asTarget(map));
    overlays.apply(spec());
    const before = map.layers.get("tl:t");

    d.dispatch({ type: "set-opacity", id: "tl:t", opacity: 0.2 });
    d.dispatch({ type: "set-visibility", id: "tl:t", visible: false });
    overlays.apply(spec());

    expect(map.layers.get("tl:t")).toBe(before);
    expect(map.layers.get("tl:t")?.paint["raster-opacity"]).toBe(0.2);
    expect(map.getLayoutProperty("tl:t", "visibility")).toBe("none");
    expect(map.errors).toEqual([]);
  });

  it("rejects a tile layer whose URL the editor refuses, with the reason", () => {
    const { d, spec } = doc();
    addTile(d, "tl:t", "http://tiles.example.org/{z}/{x}/{y}.png");

    const s = spec();
    expect(s.layers).toEqual([]);
    expect(s.rejected).toEqual([
      { overlayId: "tl:t", reason: expect.stringMatching(/https/) },
    ]);
  });
});

describe("labels and filter (W9d)", () => {
  const FONT = ["Noto Sans Regular"];
  const GLYPHS = "https://glyphs.example.org/{fontstack}/{range}.pbf";
  const NAMED: FeatureCollection = {
    type: "FeatureCollection",
    features: [
      {
        type: "Feature",
        properties: { name: "Well 4", depth: 12 },
        geometry: { type: "Point", coordinates: [77.5, 17.9] },
      },
    ],
  };
  const LABEL = { property: "name", size: 12, halo: true };

  function labelled(style: Record<string, unknown> = {}) {
    const d = createDocument();
    d.dispatch({
      type: "add-data-layer",
      id: "dl:a",
      fc: NAMED,
      label: "a",
      style: { ...STYLE, ...style },
    });
    return d;
  }

  /** A basemap whose style has glyphs and a label layer in FONT. */
  function basemapWithGlyphs(): FakeMapLibre {
    const map = new FakeMapLibre();
    map.glyphs = GLYPHS;
    map.addSource("osm", {
      type: "geojson",
      data: { type: "FeatureCollection", features: [] },
    });
    map.addLayer({ id: "land", type: "fill", source: "osm" });
    map.addLayer({
      id: "places",
      type: "symbol",
      source: "osm",
      layout: { "text-field": "x", "text-font": ["Noto Sans Italic"] },
    });
    map.addLayer({
      id: "roads-label",
      type: "symbol",
      source: "osm",
      layout: { "text-field": "y", "text-font": FONT },
    });
    expect(map.errors).toEqual([]);
    return map;
  }

  it("labelFontOf reads the basemap's glyphs and prefers a Regular font", () => {
    expect(labelFontOf(basemapWithGlyphs() as never)).toEqual(FONT);
  });

  it("labelFontOf is null for a basemap without glyphs", () => {
    const map = basemapWithGlyphs();
    map.glyphs = null;
    expect(labelFontOf(map as never)).toBeNull();
  });

  it("adds a label layer when there is a font, and none without", () => {
    const d = labelled({ label: LABEL });
    const withFont = overlaySpec(d.snapshot(), { labelFont: FONT });
    expect(withFont.layers.map((l) => l.spec.id)).toEqual([
      "dl:a",
      labelLayerId("dl:a"),
    ]);
    const without = overlaySpec(d.snapshot());
    expect(without.layers.map((l) => l.spec.id)).toEqual(["dl:a"]);
    expect(without.rejected).toEqual([]);
  });

  it("draws labels above the basemap's own labels", () => {
    const d = labelled({ label: LABEL });
    const map = basemapWithGlyphs();

    const report = createMapOverlays(asTarget(map)).apply(
      overlaySpec(d.snapshot(), { labelFont: FONT }),
    );

    expect(report.get("dl:a")).toEqual({ status: "landed" });
    expect(map.getLayersOrder()).toEqual([
      "land",
      "dl:a",
      "places",
      "roads-label",
      labelLayerId("dl:a"),
    ]);
    expect(map.errors).toEqual([]);
  });

  it("changes a filter in place, and takes it off again", () => {
    const d = labelled({
      label: LABEL,
      filter: { property: "depth", op: ">", value: "5" },
    });
    const map = basemapWithGlyphs();
    const overlays = createMapOverlays(asTarget(map));
    const apply = () =>
      overlays.apply(overlaySpec(d.snapshot(), { labelFont: FONT }));
    apply();
    const point = map.layers.get("dl:a");

    d.dispatch({
      type: "restyle",
      id: "dl:a",
      patch: { filter: { property: "depth", op: "<", value: "5" } },
    });
    apply();
    const lessThan = [
      "all",
      ["!=", ["get", "depth"], null],
      ["<", ["to-number", ["get", "depth"], 1e308], 5],
    ];
    expect(map.layers.get("dl:a")).toBe(point);
    expect(map.getFilter("dl:a")).toEqual(lessThan);
    expect(map.getFilter(labelLayerId("dl:a"))).toEqual(lessThan);

    d.dispatch({ type: "restyle", id: "dl:a", patch: { filter: undefined } });
    apply();
    expect(map.getFilter("dl:a")).toBeUndefined();
    expect(map.errors).toEqual([]);
  });

  it("rejects a filter or a label the map cannot apply, with the reason", () => {
    const bad = labelled({
      filter: { property: "depth", op: "<", value: "x" },
    });
    expect(overlaySpec(bad.snapshot()).rejected).toEqual([
      { overlayId: "dl:a", reason: "Type a number to compare with < or >." },
    ]);
    const tiny = labelled({ label: { ...LABEL, size: 1 } });
    expect(overlaySpec(tiny.snapshot(), { labelFont: FONT }).rejected).toEqual([
      { overlayId: "dl:a", reason: "Use a label size from 6 to 48." },
    ]);
  });

  it("validateLayerStyle checks labels and filters before the panel saves", () => {
    expect(validateLayerStyle({ ...STYLE, label: LABEL }, "circle")).toEqual(
      [],
    );
    expect(
      validateLayerStyle(
        { ...STYLE, filter: { property: "", op: "==", value: "" } },
        "fill",
      ),
    ).toEqual(["Choose a property to filter by."]);
  });
});
