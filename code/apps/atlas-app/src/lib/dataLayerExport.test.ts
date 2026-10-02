// SPDX-License-Identifier: AGPL-3.0-only
// The files the layer panel and the Export dialog write for data layers.

import { describe, expect, it } from "vitest";

import { parseGPX, parseKML } from "@atlasdraw/data";

import { createDocument, type DataLayerEntry } from "../state/document";

import {
  dataLayerFile,
  exportChoices,
  geoJsonExportFile,
  withDataLayers,
} from "./dataLayerExport";

import type { FeatureCollection } from "geojson";

const cafes: FeatureCollection = {
  type: "FeatureCollection",
  features: [
    {
      type: "Feature",
      geometry: { type: "Point", coordinates: [-122.4, 47.6] },
      properties: { name: "Pike, Place", seats: 12 },
    },
  ],
};

const roads: FeatureCollection = {
  type: "FeatureCollection",
  features: [
    {
      type: "Feature",
      geometry: {
        type: "LineString",
        coordinates: [
          [0, 0],
          [1, 1],
        ],
      },
      properties: { ref: "A1", layer: "from the file" },
    },
  ],
};

/** A file's text as the parsers read it; jsdom's Blob has no `text()`. */
const asBlob = (text: string) => ({ text: async () => text } as Blob);

function docWithLayers() {
  const doc = createDocument();
  doc.dispatch({
    type: "add-data-layer",
    id: "dl:cafes",
    fc: cafes,
    label: "Cafés: 2026/10",
    style: {},
  });
  doc.dispatch({
    type: "add-data-layer",
    id: "dl:roads",
    fc: roads,
    label: "Roads",
    style: {},
  });
  doc.dispatch({
    type: "add-tile-layer",
    id: "tl:osm",
    label: "OSM",
    url: "https://tile.example/{z}/{x}/{y}.png",
  });
  return doc.snapshot();
}

describe("dataLayerFile", () => {
  it("names a GeoJSON file after the layer label, made safe", () => {
    const file = dataLayerFile(docWithLayers(), "dl:cafes", "geojson");
    expect(file?.fileName).toBe("Caf_s_ 2026_10.geojson");
    expect(file?.type).toBe("application/geo+json");
    expect(JSON.parse(file!.text)).toEqual({
      type: "FeatureCollection",
      name: "Cafés: 2026/10",
      features: cafes.features,
    });
  });

  it("writes a point layer's CSV with longitude and latitude", () => {
    const file = dataLayerFile(docWithLayers(), "dl:cafes", "csv");
    expect(file?.fileName).toBe("Caf_s_ 2026_10.csv");
    expect(file?.type).toBe("text/csv");
    expect(file?.text).toBe(
      'longitude,latitude,name,seats\r\n-122.4,47.6,"Pike, Place",12\r\n',
    );
  });

  it("writes a line layer's CSV with a WKT geometry column", () => {
    const file = dataLayerFile(docWithLayers(), "dl:roads", "csv");
    expect(file?.text).toBe(
      'geometry,ref,layer\r\n"LINESTRING (0 0, 1 1)",A1,from the file\r\n',
    );
  });

  it("writes KML and GPX that the importers read back", async () => {
    const kml = dataLayerFile(docWithLayers(), "dl:cafes", "kml")!;
    expect(kml.fileName).toBe("Caf_s_ 2026_10.kml");
    expect(kml.type).toBe("application/vnd.google-earth.kml+xml");
    expect((await parseKML(asBlob(kml.text))).fc.features).toEqual(
      cafes.features,
    );

    const gpx = dataLayerFile(docWithLayers(), "dl:roads", "gpx")!;
    expect(gpx.fileName).toBe("Roads.gpx");
    expect(gpx.type).toBe("application/gpx+xml");
    expect((await parseGPX(asBlob(gpx.text))).fc.features[0]!.geometry).toEqual(
      roads.features[0]!.geometry,
    );
  });

  it("gives nothing for a layer that is not a data layer", () => {
    expect(dataLayerFile(docWithLayers(), "tl:osm", "geojson")).toBeNull();
    expect(dataLayerFile(docWithLayers(), "dl:gone", "csv")).toBeNull();
  });
});

describe("exportChoices", () => {
  const entry = (geometryKind: DataLayerEntry["geometryKind"]) =>
    ({ kind: "data", geometryKind } as DataLayerEntry);

  it("offers GPX for points and lines, never for areas", () => {
    expect(exportChoices(entry("circle"), cafes).map((c) => c.format)).toEqual([
      "geojson",
      "csv",
      "kml",
      "gpx",
    ]);
    expect(exportChoices(entry("fill"), roads).map((c) => c.format)).toEqual([
      "geojson",
      "csv",
      "kml",
    ]);
  });

  it("says when the CSV geometry goes out as WKT", () => {
    const csv = (fc: FeatureCollection) =>
      exportChoices(entry("line"), fc).find((c) => c.format === "csv")?.label;
    expect(csv(cafes)).toBe("Export as CSV");
    expect(csv(roads)).toBe("Export as CSV (geometry as WKT)");
  });
});

describe("withDataLayers", () => {
  it("adds one feature per data feature after the drawn ones, with a layer property", () => {
    const drawn: FeatureCollection = {
      type: "FeatureCollection",
      features: [
        {
          type: "Feature",
          geometry: { type: "Point", coordinates: [5, 5] },
          properties: {},
        },
      ],
    };
    const out = withDataLayers(drawn, docWithLayers());
    expect(out.features).toEqual([
      drawn.features[0],
      {
        ...cafes.features[0],
        properties: { name: "Pike, Place", seats: 12, layer: "Cafés: 2026/10" },
      },
      { ...roads.features[0], properties: { ref: "A1", layer: "Roads" } },
    ]);
  });

  it("leaves the drawn collection as it is when there are no data layers", () => {
    const drawn: FeatureCollection = {
      type: "FeatureCollection",
      features: [],
    };
    expect(withDataLayers(drawn, createDocument().snapshot())).toEqual(drawn);
  });
});

describe("geoJsonExportFile", () => {
  const drawn: FeatureCollection = {
    type: "FeatureCollection",
    features: [
      {
        type: "Feature",
        geometry: { type: "Point", coordinates: [5.123456789, 5] },
        properties: {},
      },
    ],
  };

  it("writes only the drawn shapes when data layers are not included", () => {
    const file = geoJsonExportFile(drawn, docWithLayers(), {
      includeDataLayers: false,
    });
    expect(file.type).toBe("application/geo+json");
    expect(file.fileName).toBe("Untitled map.geojson");
    expect(JSON.parse(file.text)).toEqual({
      type: "FeatureCollection",
      name: "Untitled map",
      features: [
        {
          type: "Feature",
          geometry: { type: "Point", coordinates: [5.1234568, 5] },
          properties: {},
        },
      ],
    });
  });

  it("adds every data feature with its layer when data layers are included", () => {
    const file = geoJsonExportFile(drawn, docWithLayers(), {
      includeDataLayers: true,
    });
    const features = JSON.parse(file.text).features;
    expect(features.map((f: { properties: object }) => f.properties)).toEqual([
      {},
      { name: "Pike, Place", seats: 12, layer: "Cafés: 2026/10" },
      { ref: "A1", layer: "Roads" },
    ]);
  });
});
