// SPDX-License-Identifier: MIT
// packages/data/src/export.ts
// FeatureCollection → the text of a GeoJSON, CSV, KML or GPX file, for
// "Export as …".
//
// Pure module: FeatureCollection in, string out. The inverse of geojson.ts
// `parse`, csv.ts `parseCSV` and geoxml.ts `parseKML` / `parseGPX`, and
// tested against them.
//
// Every writer rounds every coordinate to 7 decimals (about 1 cm on the
// ground). That removes float noise such as 10.299999999999999 and is far
// below the accuracy of any source this app imports.

import type {
  Feature,
  FeatureCollection,
  Geometry,
  GeoJsonProperties,
  Position,
} from "geojson";

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

/** First characters that make a spreadsheet treat a cell as a formula. */
const FORMULA_START = /^[=+\-@\t\r]/;

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
    // A spreadsheet runs a cell that starts with one of these as a formula.
    // Prefix ' so the cell opens as text. Numbers never take this path.
    return FORMULA_START.test(value) ? `'${value}` : value;
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

/** Header names for the property keys: none equal to a geometry column's. */
function propertyHeaders(keys: string[], geometry: string[]): string[] {
  const taken = new Set(geometry.map((h) => h.toLowerCase()));
  for (const key of keys) {
    if (!taken.has(key.toLowerCase())) {
      taken.add(key.toLowerCase());
    }
  }
  const reserved = new Set(geometry.map((h) => h.toLowerCase()));
  return keys.map((key) => {
    if (!reserved.has(key.toLowerCase())) {
      return key;
    }
    let name = `${key} (property)`;
    for (let n = 2; taken.has(name.toLowerCase()); n++) {
      name = `${key} (property ${n})`;
    }
    taken.add(name.toLowerCase());
    return name;
  });
}

/**
 * The text of a CSV file for `fc`: RFC 4180, CRLF line ends, a header row.
 *
 * The first columns hold the geometry (see `csvGeometryMode`). Then comes
 * one column per property key, in the order the keys are first seen. A
 * feature that has no value for a key gets an empty cell.
 *
 * A property whose name is a geometry column's, in any case, is written as
 * "<name> (property)", so every header names one column.
 *
 * For a point layer, `parseCSV(toCSV(fc))` gives the same features back when
 * each property column holds only numbers or only text, with two
 * exceptions: a text column whose every value looks like a number comes
 * back as numbers, and text that starts with =, +, - or @ comes back with
 * the leading ' that keeps a spreadsheet from running it as a formula.
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
  const lines = [
    [...geometryHeader, ...propertyHeaders(keys, geometryHeader)]
      .map(csvField)
      .join(","),
  ];

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

// ---------------------------------------------------------------------------
// XML (KML and GPX)

/**
 * Characters that XML 1.0 cannot hold, not even as a character reference:
 * most control characters, lone surrogates, U+FFFE and U+FFFF.
 */
const NOT_XML = /[^\t\n\r\u0020-\uD7FF\uE000-\uFFFD\u{10000}-\u{10FFFF}]/gu;

/**
 * Text content: the five markup characters as entities, so `]]>` and `&`
 * stay text. CR is a reference, because a parser turns a raw CR into LF.
 * Characters XML cannot hold are left out.
 */
function xmlText(value: string): string {
  return value
    .replace(NOT_XML, "")
    .replace(/&/g, "&amp;")
    .replace(/</g, "&lt;")
    .replace(/>/g, "&gt;")
    .replace(/"/g, "&quot;")
    .replace(/'/g, "&apos;")
    .replace(/\r/g, "&#13;");
}

/** An attribute value: as text, and tab and LF as references too. */
function xmlAttr(value: string): string {
  return xmlText(value).replace(/\n/g, "&#10;").replace(/\t/g, "&#9;");
}

/** `<tag>text</tag>`, or nothing when there is no text. */
function element(tag: string, text: string | undefined): string {
  return text === undefined ? "" : `<${tag}>${xmlText(text)}</${tag}>`;
}

const XML_DECLARATION = '<?xml version="1.0" encoding="UTF-8"?>';

export interface XmlExportOptions {
  /** The document's name (KML `Document/name`, GPX `metadata/name`). */
  name?: string;
}

// ---- KML --------------------------------------------------------------------

/** The KML Schema type of a property, by the values it holds. */
type KmlFieldType = "double" | "bool" | "string";

/** The id of the one Schema a written KML file declares. */
const KML_SCHEMA_ID = "properties";

function kmlPosition(p: Position): string {
  return p
    .slice(0, 3)
    .map((n) => String(round(n)))
    .join(",");
}

function kmlCoordinates(positions: Position[]): string {
  return `<coordinates>${positions.map(kmlPosition).join(" ")}</coordinates>`;
}

function kmlRing(ring: Position[]): string {
  return `<LinearRing>${kmlCoordinates(ring)}</LinearRing>`;
}

function kmlPolygon(rings: Position[][]): string {
  const [outer, ...inner] = rings;
  if (!outer) {
    return "";
  }
  return `<Polygon><outerBoundaryIs>${kmlRing(outer)}</outerBoundaryIs>${inner
    .map((ring) => `<innerBoundaryIs>${kmlRing(ring)}</innerBoundaryIs>`)
    .join("")}</Polygon>`;
}

function kmlGeometry(g: Geometry): string {
  const multi = (parts: string[]) =>
    `<MultiGeometry>${parts.join("")}</MultiGeometry>`;
  switch (g.type) {
    case "Point":
      return `<Point>${kmlCoordinates([g.coordinates])}</Point>`;
    case "LineString":
      return `<LineString>${kmlCoordinates(g.coordinates)}</LineString>`;
    case "Polygon":
      return kmlPolygon(g.coordinates);
    case "MultiPoint":
      return multi(
        g.coordinates.map((p) => `<Point>${kmlCoordinates([p])}</Point>`),
      );
    case "MultiLineString":
      return multi(
        g.coordinates.map(
          (line) => `<LineString>${kmlCoordinates(line)}</LineString>`,
        ),
      );
    case "MultiPolygon":
      return multi(g.coordinates.map(kmlPolygon));
    case "GeometryCollection":
      return multi(g.geometries.map(kmlGeometry));
  }
}

/**
 * True when the property goes into the Placemark's own `<name>`: a text
 * `name`. Every other property, a `name` that is not text included, goes
 * into the ExtendedData.
 */
function isPlacemarkName(key: string, value: unknown): value is string {
  return key === "name" && typeof value === "string";
}

/**
 * Each ExtendedData key and its Schema type, in the order the keys are
 * first seen. A key whose every value is a number is "double", whose every
 * value is a boolean is "bool", and any other key is "string".
 */
function kmlFields(fc: FeatureCollection): Map<string, KmlFieldType> {
  const fields = new Map<string, KmlFieldType>();
  for (const f of fc.features) {
    for (const [key, value] of Object.entries(f.properties ?? {})) {
      if (value === null || value === undefined) {
        continue;
      }
      if (isPlacemarkName(key, value)) {
        continue;
      }
      const type: KmlFieldType =
        typeof value === "number"
          ? "double"
          : typeof value === "boolean"
          ? "bool"
          : "string";
      const held = fields.get(key);
      fields.set(key, held === undefined || held === type ? type : "string");
    }
  }
  return fields;
}

function kmlValue(value: unknown): string {
  return typeof value === "string"
    ? value
    : typeof value === "number" || typeof value === "boolean"
    ? String(value)
    : JSON.stringify(value);
}

function kmlExtendedData(
  properties: GeoJsonProperties,
  fields: Map<string, KmlFieldType>,
): string {
  const data = Object.entries(properties ?? {})
    .filter(([key, value]) => fields.has(key) && value != null)
    .filter(([key, value]) => !isPlacemarkName(key, value))
    .map(
      ([key, value]) =>
        `<SimpleData name="${xmlAttr(key)}">${xmlText(
          kmlValue(value),
        )}</SimpleData>`,
    );
  return data.length === 0
    ? ""
    : `<ExtendedData><SchemaData schemaUrl="#${KML_SCHEMA_ID}">${data.join(
        "",
      )}</SchemaData></ExtendedData>`;
}

/**
 * The text of a KML 2.2 file for `fc`: one Placemark per feature, in order.
 *
 * A text `name` property is the Placemark's name. Every other property is
 * ExtendedData under one Schema, which says which keys hold numbers and
 * which hold booleans, so `parseKML` gives them back with their types. A
 * key that holds mixed types is text; an object or array is JSON text. A
 * null value is left out. A feature's `id` is the Placemark's id. Multi-part
 * geometry is a MultiGeometry, which the importer joins back into one
 * Multi* geometry per kind.
 *
 * Styles are not written: the layer's colours stay in the map.
 */
export function toKML(
  fc: FeatureCollection,
  opts: XmlExportOptions = {},
): string {
  const fields = kmlFields(fc);
  const lines = [
    XML_DECLARATION,
    '<kml xmlns="http://www.opengis.net/kml/2.2">',
    "<Document>",
  ];
  const name = opts.name?.trim();
  if (name) {
    lines.push(element("name", name));
  }
  if (fields.size > 0) {
    lines.push(`<Schema name="${KML_SCHEMA_ID}" id="${KML_SCHEMA_ID}">`);
    for (const [key, type] of fields) {
      lines.push(`<SimpleField name="${xmlAttr(key)}" type="${type}"/>`);
    }
    lines.push("</Schema>");
  }
  for (const f of fc.features) {
    const props = f.properties ?? {};
    const id = f.id === undefined ? "" : ` id="${xmlAttr(String(f.id))}"`;
    lines.push(
      `<Placemark${id}>${
        isPlacemarkName("name", props.name) ? element("name", props.name) : ""
      }${kmlExtendedData(props, fields)}${
        f.geometry ? kmlGeometry(f.geometry) : ""
      }</Placemark>`,
    );
  }
  lines.push("</Document>", "</kml>");
  return `${lines.join("\n")}\n`;
}

// ---- GPX --------------------------------------------------------------------

/** A property as GPX text, or undefined when it is not text. */
function gpxString(props: GeoJsonProperties, key: string): string | undefined {
  const value = props?.[key];
  return typeof value === "string" ? value : undefined;
}

/** `lat="…" lon="…"`, and the elevation element when there is a third value. */
function gpxPoint(tag: string, p: Position, time?: string): string[] {
  return [
    `<${tag} lat="${round(p[1])}" lon="${round(p[0])}">`,
    p.length > 2 ? element("ele", String(round(p[2]))) : "",
    element("time", time),
  ];
}

/** The times of a line's positions, from `coordinateProperties.times`. */
function gpxTimes(
  props: GeoJsonProperties,
  segment: number,
  segments: number,
): unknown[] | undefined {
  const times = (props?.coordinateProperties as { times?: unknown } | undefined)
    ?.times;
  if (!Array.isArray(times)) {
    return undefined;
  }
  const these = segments > 1 ? times[segment] : times;
  return Array.isArray(these) ? these : undefined;
}

function gpxLinePoints(
  tag: "rtept" | "trkpt",
  line: Position[],
  times: unknown[] | undefined,
): string {
  const aligned = times?.length === line.length ? times : undefined;
  return line
    .map((p, i) => {
      const time = aligned?.[i];
      return [
        ...gpxPoint(tag, p, typeof time === "string" ? time : undefined),
        `</${tag}>`,
      ].join("");
    })
    .join("");
}

/** The description fields, in the order GPX 1.1 puts them. */
function gpxDescription(props: GeoJsonProperties): string {
  return ["name", "cmt", "desc"]
    .map((key) => element(key, gpxString(props, key)))
    .join("");
}

/**
 * The text of a GPX 1.1 file for `fc`.
 *
 * A Point or MultiPoint is a waypoint (`wpt`) per position. A line is a
 * track (`trk`), or a route (`rte`) when its `_gpxType` property is "rte",
 * which is how `parseGPX` marks a route. A MultiLineString is one track with
 * a segment per line. Areas are not written: GPX cannot hold them.
 *
 * GPX has a place for a few properties only: `name`, `cmt`, `desc` and
 * `type` on each item, `sym` and `time` on a waypoint, and a time per track
 * point from `coordinateProperties.times`. Other properties are not
 * written. A third coordinate is the elevation (`ele`). A layer read from
 * GPX gives the same features back.
 */
export function toGPX(
  fc: FeatureCollection,
  opts: XmlExportOptions = {},
): string {
  const waypoints: string[] = [];
  const routes: string[] = [];
  const tracks: string[] = [];

  for (const f of fc.features) {
    const g = f.geometry;
    const props = f.properties ?? {};
    const type = element("type", gpxString(props, "type"));
    if (g?.type === "Point" || g?.type === "MultiPoint") {
      const positions = g.type === "Point" ? [g.coordinates] : g.coordinates;
      for (const p of positions) {
        waypoints.push(
          [
            ...gpxPoint("wpt", p, gpxString(props, "time")),
            gpxDescription(props),
            element("sym", gpxString(props, "sym")),
            type,
            "</wpt>",
          ].join(""),
        );
      }
    } else if (g?.type === "LineString" && props._gpxType === "rte") {
      routes.push(
        `<rte>${gpxDescription(props)}${type}${gpxLinePoints(
          "rtept",
          g.coordinates,
          undefined,
        )}</rte>`,
      );
    } else if (g?.type === "LineString" || g?.type === "MultiLineString") {
      const lines = g.type === "LineString" ? [g.coordinates] : g.coordinates;
      const segments = lines
        .map(
          (line, i) =>
            `<trkseg>${gpxLinePoints(
              "trkpt",
              line,
              gpxTimes(props, i, lines.length),
            )}</trkseg>`,
        )
        .join("");
      tracks.push(`<trk>${gpxDescription(props)}${type}${segments}</trk>`);
    }
  }

  const name = opts.name?.trim();
  return `${[
    XML_DECLARATION,
    '<gpx version="1.1" creator="Atlasdraw" xmlns="http://www.topografix.com/GPX/1/1">',
    ...(name ? [`<metadata>${element("name", name)}</metadata>`] : []),
    ...waypoints,
    ...routes,
    ...tracks,
    "</gpx>",
  ].join("\n")}\n`;
}
