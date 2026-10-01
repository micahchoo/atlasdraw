// SPDX-License-Identifier: MIT
// packages/data/src/coordinates.ts
//
// A parsed FeatureCollection made ready for the map: positions in longitude
// and latitude, every feature drawable, one part per geometry kind.
//
//   prepareForMap(fc)  { parts, dropped, reprojectedFrom } or a CoordinateError
//
// The rules, in order:
//   1. A declared CRS (the legacy GeoJSON `crs` member) of Web Mercator
//      (EPSG:3857 and its aliases) is converted to EPSG:4326. Any other
//      declared projected CRS is refused, and the message names it and the
//      fix. CRS84 and EPSG:4326 pass.
//   2. A feature with no geometry, a geometry with no valid positions, or a
//      position off the globe (|lat| > 90, |lng| > 360) is dropped and
//      counted. If every feature with positions is off the globe, the file is
//      in a projected CRS it does not declare: refused, with the fix.
//   3. The rest is divided by geometry kind (splitByGeometryKind).

import { splitByGeometryKind, type GeometryKindPart } from "./geojson.js";

import type { Feature, FeatureCollection, Geometry, Position } from "geojson";

export type CoordinateErrorCode = "PROJECTED" | "UNKNOWN_CRS";

export class CoordinateError extends Error {
  readonly code: CoordinateErrorCode;
  constructor(code: CoordinateErrorCode, message: string) {
    super(message);
    this.code = code;
    this.name = "CoordinateError";
  }
}

export interface PreparedLayers {
  /** One part per geometry kind, in the order fill, line, circle. */
  parts: GeometryKindPart[];
  /** Features left out because the map cannot draw them. */
  dropped: number;
  /** The CRS the positions were converted from, or null. */
  reprojectedFrom: string | null;
}

const FIX =
  "Atlasdraw reads longitude and latitude (EPSG:4326). Reproject the file, for example with: ogr2ogr -t_srs EPSG:4326 out.geojson in.geojson";

/** Web Mercator's EPSG codes, the current one and its aliases. */
const WEB_MERCATOR = new Set(["3857", "900913", "3785", "102100", "102113"]);

/** The EPSG code a `crs` member names; "4326" for CRS84; null for none. */
function declaredCrs(fc: FeatureCollection): string | null {
  const crs = (fc as { crs?: { properties?: { name?: unknown } } }).crs;
  const name = crs?.properties?.name;
  if (typeof name !== "string") {
    return null;
  }
  if (/CRS:?84$/i.test(name)) {
    return "4326";
  }
  const code = /EPSG:{1,2}(\d+)$/i.exec(name)?.[1];
  return code ?? name;
}

const R = 6378137;

function fromWebMercator([x, y, ...rest]: Position): Position {
  return [
    (x! / R) * (180 / Math.PI),
    (2 * Math.atan(Math.exp(y! / R)) - Math.PI / 2) * (180 / Math.PI),
    ...rest,
  ];
}

const DEPTH: Readonly<Record<string, number>> = {
  Point: 0,
  MultiPoint: 1,
  LineString: 1,
  MultiLineString: 2,
  Polygon: 2,
  MultiPolygon: 3,
};

type Check = "ok" | "invalid" | "off-globe";

function isPosition(p: unknown): p is Position {
  return (
    Array.isArray(p) &&
    p.length >= 2 &&
    p.every((n) => typeof n === "number" && Number.isFinite(n))
  );
}

/** Positions at `depth`, mapped by `f`; null when the shape is wrong. */
function mapPositions(
  coords: unknown,
  depth: number,
  f: (p: Position) => Position,
): unknown {
  if (depth === 0) {
    return isPosition(coords) ? f(coords) : null;
  }
  if (!Array.isArray(coords) || coords.length === 0) {
    return null;
  }
  const out: unknown[] = [];
  for (const child of coords) {
    const mapped = mapPositions(child, depth - 1, f);
    if (mapped === null) {
      return null;
    }
    out.push(mapped);
  }
  return out;
}

/** A geometry with its positions mapped by `f`, or null when one is wrong. */
function mapGeometry(
  g: Geometry,
  f: (p: Position) => Position,
): Geometry | null {
  if (g.type === "GeometryCollection") {
    if (!Array.isArray(g.geometries) || g.geometries.length === 0) {
      return null;
    }
    const members: Geometry[] = [];
    for (const member of g.geometries) {
      const mapped = mapGeometry(member, f);
      if (!mapped) {
        return null;
      }
      members.push(mapped);
    }
    return { ...g, geometries: members };
  }
  const depth = DEPTH[(g as { type: string }).type];
  if (depth === undefined) {
    return null;
  }
  const coordinates = mapPositions(
    (g as { coordinates?: unknown }).coordinates,
    depth,
    f,
  );
  return coordinates === null ? null : ({ ...g, coordinates } as Geometry);
}

function onGlobe([lng, lat]: Position): boolean {
  return Math.abs(lat!) <= 90 && Math.abs(lng!) <= 360;
}

function checkGeometry(g: Geometry): Check {
  let off = false;
  const valid = mapGeometry(g, (p) => {
    if (!onGlobe(p)) {
      off = true;
    }
    return p;
  });
  return valid === null ? "invalid" : off ? "off-globe" : "ok";
}

/** A sample position of a geometry, for a message. */
function firstPosition(g: Geometry): Position | null {
  let first: Position | null = null;
  mapGeometry(g, (p) => {
    first ??= p;
    return p;
  });
  return first;
}

/**
 * Make a parsed FeatureCollection ready for the map; see the file header.
 * Throws CoordinateError when the positions are not longitude and latitude
 * and cannot be made so.
 */
export function prepareForMap(fc: FeatureCollection): PreparedLayers {
  const crs = declaredCrs(fc);
  let reprojectedFrom: string | null = null;
  let source = fc.features;
  if (crs !== null && crs !== "4326") {
    if (!WEB_MERCATOR.has(crs)) {
      throw new CoordinateError(
        "UNKNOWN_CRS",
        `The file is in ${/^\d+$/.test(crs) ? `EPSG:${crs}` : crs}. ${FIX}`,
      );
    }
    reprojectedFrom = "EPSG:3857";
    source = fc.features.map((f) => {
      const geometry = f.geometry
        ? mapGeometry(f.geometry, fromWebMercator)
        : null;
      return geometry ? { ...f, geometry } : f;
    });
  }

  const kept: Feature[] = [];
  let dropped = 0;
  let offGlobe = 0;
  let sample: Position | null = null;
  for (const f of source) {
    const check = f.geometry ? checkGeometry(f.geometry) : "invalid";
    if (check === "ok") {
      kept.push(f);
      continue;
    }
    dropped += 1;
    if (check === "off-globe") {
      offGlobe += 1;
      sample ??= firstPosition(f.geometry!);
    }
  }
  if (kept.length === 0 && offGlobe > 0) {
    const at = sample ? ` (${sample[0]}, ${sample[1]})` : "";
    throw new CoordinateError(
      "PROJECTED",
      `The positions in this file${at} are not longitude and latitude; they look like metres in a projected system. ${FIX}`,
    );
  }

  const ready: FeatureCollection =
    dropped === 0 && reprojectedFrom === null
      ? fc
      : { type: "FeatureCollection", features: kept };
  return { parts: splitByGeometryKind(ready), dropped, reprojectedFrom };
}
