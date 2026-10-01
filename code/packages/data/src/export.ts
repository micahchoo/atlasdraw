// SPDX-License-Identifier: MIT
// packages/data/src/export.ts
// FeatureCollection → the text of a GeoJSON or CSV file, for "Export as …".
//
// Pure module: FeatureCollection in, string out. The inverse of geojson.ts
// `parse` and csv.ts `parseCSV`, and tested against them.
//
// Both writers round every coordinate to 7 decimals (about 1 cm on the
// ground). That removes float noise such as 10.299999999999999 and is far
// below the accuracy of any source this app imports.

import type { Feature, FeatureCollection, Geometry, Position } from "geojson";

const COORDINATE_DECIMALS = 7;

function round(value: number): number {
  return Number(value.toFixed(COORDINATE_DECIMALS));
}

function roundPosition(position: Position): Position {
  return position.map(round);
}

/** A copy of the geometry with only `type` and coordinates, rounded. */
function cleanGeometry(g: Geometry): Geometry {
  switch (g.type) {
    case "Point":
      return { type: g.type, coordinates: roundPosition(g.coordinates) };
    case "MultiPoint":
    case "LineString":
      return { type: g.type, coordinates: g.coordinates.map(roundPosition) };
    case "MultiLineString":
    case "Polygon":
      return {
        type: g.type,
        coordinates: g.coordinates.map((ring) => ring.map(roundPosition)),
      };
    case "MultiPolygon":
      return {
        type: g.type,
        coordinates: g.coordinates.map((polygon) =>
          polygon.map((ring) => ring.map(roundPosition)),
        ),
      };
    case "GeometryCollection":
      return { type: g.type, geometries: g.geometries.map(cleanGeometry) };
  }
}

export interface GeoJSONTextOptions {
  /**
   * Written as the top-level `name` member, which QGIS and GDAL read as the
   * layer name. Omitted when empty. It is the only foreign member written.
   */
  name?: string;
}

/**
 * The text of an RFC 7946 GeoJSON file for `fc`.
 *
 * Each feature keeps its `id` and its properties. Foreign members, `bbox`
 * and `crs` are not written: a bbox can be stale after an edit, and RFC 7946
 * removed `crs`.
 */
export function toGeoJSONText(
  fc: FeatureCollection,
  opts: GeoJSONTextOptions = {},
): string {
  // `geometry: null` is RFC-legal (§3.2); the typings here say otherwise.
  const features = fc.features.map((f) => {
    const out: Feature<Geometry | null> = {
      type: "Feature",
      geometry: f.geometry ? cleanGeometry(f.geometry) : null,
      properties: f.properties ?? null,
    };
    if (f.id !== undefined) {
      out.id = f.id;
    }
    return out;
  });
  const name = opts.name?.trim();
  return JSON.stringify({
    type: "FeatureCollection",
    ...(name ? { name } : {}),
    features,
  });
}

// ---------------------------------------------------------------------------
// CSV

/**
 * How `toCSV` writes the geometry. "point": `longitude` and `latitude`
 * columns, which the CSV importer reads back. "wkt": one `geometry` column
 * of Well-Known Text, for lines, areas and multi-part geometry.
 */
export type CsvGeometryMode = "point" | "wkt";

/**
 * "point" when every feature that has a geometry has a Point; else "wkt".
 * An empty layer is "point".
 */
export function csvGeometryMode(fc: FeatureCollection): CsvGeometryMode {
  return fc.features.every((f) => !f.geometry || f.geometry.type === "Point")
    ? "point"
    : "wkt";
}

const NEEDS_QUOTES = /[",\r\n]/;

/** One RFC 4180 field. */
function csvField(text: string): string {
  return NEEDS_QUOTES.test(text) ? `"${text.replace(/"/g, '""')}"` : text;
}

/**
 * A property value as cell text. A number is written as JavaScript prints
 * it, so the importer reads the same number back. An object or array is
 * JSON. null and undefined are an empty cell.
 */
function cellText(value: unknown): string {
  if (value === null || value === undefined) {
    return "";
  }
  if (typeof value === "string") {
    return value;
  }
  if (typeof value === "number" || typeof value === "boolean") {
    return String(value);
  }
  return JSON.stringify(value);
}

function wktPosition(p: Position): string {
  return `${round(p[0])} ${round(p[1])}`;
}

function wktList(positions: Position[]): string {
  return `(${positions.map(wktPosition).join(", ")})`;
}

function wktRings(rings: Position[][]): string {
  return `(${rings.map(wktList).join(", ")})`;
}

/**
 * Well-Known Text for a geometry, in 2D: a third coordinate (elevation) is
 * not written. Use the GeoJSON export to keep it.
 */
export function toWKT(g: Geometry): string {
  const tag = g.type.toUpperCase();
  const empty =
    g.type === "GeometryCollection"
      ? g.geometries.length === 0
      : g.coordinates.length === 0;
  if (empty) {
    return `${tag} EMPTY`;
  }
  switch (g.type) {
    case "Point":
      return `${tag} (${wktPosition(g.coordinates)})`;
    case "MultiPoint":
      return `${tag} (${g.coordinates
        .map((p) => `(${wktPosition(p)})`)
        .join(", ")})`;
    case "LineString":
      return `${tag} ${wktList(g.coordinates)}`;
    case "MultiLineString":
    case "Polygon":
      return `${tag} ${wktRings(g.coordinates)}`;
    case "MultiPolygon":
      return `${tag} (${g.coordinates.map(wktRings).join(", ")})`;
    case "GeometryCollection":
      return `${tag} (${g.geometries.map(toWKT).join(", ")})`;
  }
}

/**
 * The text of a CSV file for `fc`: RFC 4180, CRLF line ends, a header row.
 *
 * The first columns hold the geometry (see `csvGeometryMode`). Then comes
 * one column per property key, in the order the keys are first seen. A
 * feature that has no value for a key gets an empty cell.
 *
 * For a point layer, `parseCSV(toCSV(fc))` gives the same features back when
 * each property column holds only numbers or only text. A text column whose
 * every value looks like a number comes back as numbers.
 */
export function toCSV(fc: FeatureCollection): string {
  const mode = csvGeometryMode(fc);
  const keys: string[] = [];
  const seen = new Set<string>();
  for (const f of fc.features) {
    for (const key of Object.keys(f.properties ?? {})) {
      if (!seen.has(key)) {
        seen.add(key);
        keys.push(key);
      }
    }
  }

  const geometryHeader =
    mode === "point" ? ["longitude", "latitude"] : ["geometry"];
  const lines = [[...geometryHeader, ...keys].map(csvField).join(",")];

  for (const f of fc.features) {
    const g = f.geometry;
    const geometryCells =
      mode === "wkt"
        ? [g ? toWKT(g) : ""]
        : g?.type === "Point"
        ? [String(round(g.coordinates[0])), String(round(g.coordinates[1]))]
        : ["", ""];
    const props = f.properties ?? {};
    const cells = [
      ...geometryCells,
      ...keys.map((key) => cellText(props[key])),
    ];
    lines.push(cells.map(csvField).join(","));
  }
  return lines.map((line) => `${line}\r\n`).join("");
}
