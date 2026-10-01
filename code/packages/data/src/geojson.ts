// SPDX-License-Identifier: MIT
// packages/data/src/geojson.ts
// Phase 2 Wave 1b T10 — GeoJSON parser/writer.
//
// Pure module. No Yjs, no MapLibre, no @excalidraw imports — this layer is
// strictly text-in / FeatureCollection-out (and the inverse). Higher layers
// translate the parsed FC into Yjs-backed layers or Excalidraw elements.
//
// Validation depth chosen: RFC 7946 minimum that an actionable error message
// can name a specific offending field. We verify:
//   1. JSON is well-formed (else GeoJSONParseError mentioning "JSON")
//   2. Top level is an object with type === "FeatureCollection"
//      (else error mentions "FeatureCollection")
//   3. `features` is an array
//   4. Each feature has `type === "Feature"`, a `geometry` field (null is
//      RFC-legal but we still require the key to exist), and a `properties`
//      field. The error names the offending field AND the feature index.
//
// Deliberately NOT validated here (Phase 5 concern):
//   - per-coordinate numeric range (lng ∈ [-180, 180], etc.)
//   - geometry-type-specific shape (Polygon ring closure, LineString min len)
//   - bbox / foreign members
//   - CRS objects (RFC 7946 deprecated them; we tolerate their presence)

import type {
  Feature,
  FeatureCollection,
  Geometry,
  GeometryCollection,
  Position,
} from "geojson";

/**
 * Error type for GeoJSON parse failures. Carries optional `line` (for JSON
 * syntax errors when the engine surfaces a position) and `field` (for
 * structural validation failures, e.g. "geometry", "features[2].type").
 */
export class GeoJSONParseError extends Error {
  readonly line?: number;
  readonly field?: string;

  constructor(message: string, opts: { line?: number; field?: string } = {}) {
    super(message);
    this.name = "GeoJSONParseError";
    if (opts.line !== undefined) {
      this.line = opts.line;
    }
    if (opts.field !== undefined) {
      this.field = opts.field;
    }
  }
}

/**
 * Parse a Blob as a GeoJSON FeatureCollection.
 *
 * Resolves with the FeatureCollection on success. Rejects with a
 * `GeoJSONParseError` on any failure — malformed JSON, wrong top-level type,
 * or a feature missing required fields.
 */
export async function parse(blob: Blob): Promise<FeatureCollection> {
  const text = await blob.text();

  let raw: unknown;
  try {
    raw = JSON.parse(text);
  } catch (err) {
    const detail = err instanceof Error ? err.message : String(err);
    // Try to extract a position from V8/Node SyntaxError messages like
    // "Unexpected token } in JSON at position 42". Best-effort.
    const posMatch = /position\s+(\d+)/.exec(detail);
    let line: number | undefined;
    if (posMatch) {
      const pos = Number(posMatch[1]);
      // 1-indexed line count up to byte offset `pos`.
      line = text.slice(0, pos).split("\n").length;
    }
    throw new GeoJSONParseError(`Malformed JSON: ${detail}`, { line });
  }

  if (raw === null || typeof raw !== "object" || Array.isArray(raw)) {
    throw new GeoJSONParseError(
      `Expected top-level JSON object for FeatureCollection; got ${
        raw === null ? "null" : Array.isArray(raw) ? "array" : typeof raw
      }`,
      { field: "type" },
    );
  }

  const obj = raw as Record<string, unknown>;
  const topType = obj.type;
  if (topType !== "FeatureCollection") {
    throw new GeoJSONParseError(
      `Expected top-level type "FeatureCollection", got ${JSON.stringify(
        topType,
      )}. ` +
        `Bare Feature/Geometry inputs are not accepted; wrap them in a FeatureCollection.`,
      { field: "type" },
    );
  }

  const features = obj.features;
  if (!Array.isArray(features)) {
    throw new GeoJSONParseError(
      `FeatureCollection.features must be an array; got ${typeof features}`,
      { field: "features" },
    );
  }

  features.forEach((feat, idx) => validateFeature(feat, idx));

  return obj as unknown as FeatureCollection;
}

/**
 * Serialize a FeatureCollection to a `application/json` Blob.
 *
 * No re-validation here — callers are trusted to pass a well-formed FC. The
 * round-trip `parse(write(fc))` is covered by tests.
 */
export async function write(fc: FeatureCollection): Promise<Blob> {
  const json = JSON.stringify(fc);
  return new Blob([json], { type: "application/json" });
}

/**
 * Atlasdraw v1 renders one MapLibre layer style per data layer (fill | line |
 * circle). A FeatureCollection that mixes geometry kinds (e.g. Polygon +
 * LineString) cannot be rendered correctly in this model — `inferGeometryType`
 * would silently drop all features that don't match the first.
 *
 * This is a *rendering* constraint, not a GeoJSON-spec violation, so it lives
 * outside `parse()` (which stays RFC-pure). Callers that route the FC into
 * MapLibre rendering should invoke this helper immediately after `parse()`
 * to fail fast with a user-actionable error.
 *
 * Sub-layers per kind is the planned-of-record direction for Phase 4+ when
 * self-host justifies the data-model complexity. T24 maintainer decision
 * 2026-05-05 (atlasdraw-4142): reject in v1.
 *
 * `null` geometries are RFC-legal and treated as no-op (no contribution to
 * the kind set). GeometryCollection and unknown types are rejected as
 * unsupported.
 *
 * Throws `GeoJSONParseError` with a precise field path on mixed/unsupported
 * input. Returns void on success.
 */
export function requireHomogeneousGeometry(fc: FeatureCollection): void {
  const seen = new Set<AtlasGeometryKind>();
  for (let i = 0; i < fc.features.length; i++) {
    const g = fc.features[i].geometry;
    if (g === null) {
      continue;
    }
    const kind = atlasKindOf(g.type);
    if (kind === null) {
      throw new GeoJSONParseError(
        `features[${i}].geometry.type ${JSON.stringify(
          g.type,
        )} is not supported by Atlas (use Polygon/LineString/Point variants)`,
        { field: `features[${i}].geometry.type` },
      );
    }
    seen.add(kind);
    if (seen.size > 1) {
      const kinds = Array.from(seen).sort().join(", ");
      throw new GeoJSONParseError(
        `FeatureCollection contains mixed geometry kinds (${kinds}). ` +
          `Atlas v1 supports a single geometry kind per layer; split your ` +
          `file into separate FeatureCollections by geometry type.`,
        { field: "features" },
      );
    }
  }
}

/** Atlas's MapLibre layer-kind taxonomy. */
export type AtlasGeometryKind = "fill" | "line" | "circle";

/**
 * The layer kind of a FeatureCollection: the kind of its first feature that
 * has a geometry. A `null` geometry is skipped, so a leading null feature
 * does not turn a polygon layer into vertex dots. An empty collection, or one
 * with no supported geometry, gives "circle", which draws nothing.
 */
export function geometryKindOf(fc: FeatureCollection): AtlasGeometryKind {
  for (const feature of fc.features) {
    const kind = feature.geometry ? atlasKindOf(feature.geometry.type) : null;
    if (kind) {
      return kind;
    }
  }
  return "circle";
}

/** One part of a FeatureCollection, with features of one geometry kind. */
export interface GeometryKindPart {
  kind: AtlasGeometryKind;
  fc: FeatureCollection;
}

/** Order of the parts: areas below lines, lines below points. */
const KIND_ORDER: readonly AtlasGeometryKind[] = ["fill", "line", "circle"];

/**
 * Divide a FeatureCollection into one FeatureCollection per geometry kind,
 * so that each part passes `requireHomogeneousGeometry`.
 *
 * Use this for formats where mixed kinds are normal, for example a GPX file
 * with waypoints and tracks. The parts come in the order fill, line, circle.
 * An empty kind gives no part.
 *
 * A GeometryCollection is divided by kind. Each piece becomes a feature with
 * the properties of the original feature. Two or more pieces of one kind
 * become one Multi* geometry. Features with a `null` geometry are left out.
 *
 * If all features are of one kind, the function returns the input
 * FeatureCollection as the one part.
 */
export function splitByGeometryKind(fc: FeatureCollection): GeometryKindPart[] {
  const byKind = new Map<AtlasGeometryKind, Feature[]>();
  const add = (kind: AtlasGeometryKind, feature: Feature) => {
    const list = byKind.get(kind);
    if (list) {
      list.push(feature);
    } else {
      byKind.set(kind, [feature]);
    }
  };

  let changed = false;
  for (const feature of fc.features) {
    const g = feature.geometry;
    if (g === null) {
      changed = true;
      continue;
    }
    if (g.type !== "GeometryCollection") {
      const kind = atlasKindOf(g.type);
      if (kind !== null) {
        add(kind, feature);
      }
      continue;
    }
    changed = true;
    for (const [kind, geometry] of mergeByKind(leafGeometries(g))) {
      add(kind, { ...feature, geometry });
    }
  }

  if (!changed && byKind.size === 1) {
    const [kind] = byKind.keys();
    return [{ kind, fc }];
  }
  return KIND_ORDER.filter((kind) => byKind.has(kind)).map((kind) => ({
    kind,
    fc: { type: "FeatureCollection", features: byKind.get(kind)! },
  }));
}

/** The geometries in a GeometryCollection, with nested collections opened. */
function leafGeometries(g: GeometryCollection): Geometry[] {
  return g.geometries.flatMap((member) =>
    member.type === "GeometryCollection" ? leafGeometries(member) : [member],
  );
}

/** One geometry per kind: one member as it is, more members as Multi*. */
function mergeByKind(
  geometries: Geometry[],
): Array<[AtlasGeometryKind, Geometry]> {
  const groups = new Map<AtlasGeometryKind, Geometry[]>();
  for (const g of geometries) {
    const kind = atlasKindOf(g.type);
    if (kind !== null) {
      groups.set(kind, [...(groups.get(kind) ?? []), g]);
    }
  }
  return KIND_ORDER.filter((kind) => groups.has(kind)).map((kind) => {
    const members = groups.get(kind)!;
    return [kind, members.length === 1 ? members[0] : toMulti(kind, members)];
  });
}

function toMulti(kind: AtlasGeometryKind, members: Geometry[]): Geometry {
  if (kind === "circle") {
    const coordinates: Position[] = [];
    for (const m of members) {
      if (m.type === "Point") {
        coordinates.push(m.coordinates);
      } else if (m.type === "MultiPoint") {
        coordinates.push(...m.coordinates);
      }
    }
    return { type: "MultiPoint", coordinates };
  }
  if (kind === "line") {
    const coordinates: Position[][] = [];
    for (const m of members) {
      if (m.type === "LineString") {
        coordinates.push(m.coordinates);
      } else if (m.type === "MultiLineString") {
        coordinates.push(...m.coordinates);
      }
    }
    return { type: "MultiLineString", coordinates };
  }
  const coordinates: Position[][][] = [];
  for (const m of members) {
    if (m.type === "Polygon") {
      coordinates.push(m.coordinates);
    } else if (m.type === "MultiPolygon") {
      coordinates.push(...m.coordinates);
    }
  }
  return { type: "MultiPolygon", coordinates };
}

function atlasKindOf(t: string): AtlasGeometryKind | null {
  if (t === "Polygon" || t === "MultiPolygon") {
    return "fill";
  }
  if (t === "LineString" || t === "MultiLineString") {
    return "line";
  }
  if (t === "Point" || t === "MultiPoint") {
    return "circle";
  }
  return null;
}

// ---------------------------------------------------------------------------
// internal

function validateFeature(feat: unknown, idx: number): asserts feat is Feature {
  if (feat === null || typeof feat !== "object" || Array.isArray(feat)) {
    throw new GeoJSONParseError(
      `features[${idx}] must be an object; got ${
        feat === null ? "null" : typeof feat
      }`,
      { field: `features[${idx}]` },
    );
  }
  const f = feat as Record<string, unknown>;

  if (f.type !== "Feature") {
    throw new GeoJSONParseError(
      `features[${idx}].type must be "Feature"; got ${JSON.stringify(f.type)}`,
      { field: `features[${idx}].type` },
    );
  }

  // RFC 7946 §3.2 — Feature MUST have `geometry` (may be null) and `properties`.
  if (!("geometry" in f)) {
    throw new GeoJSONParseError(
      `features[${idx}] missing required field "geometry"`,
      { field: "geometry" },
    );
  }
  if (!("properties" in f)) {
    throw new GeoJSONParseError(
      `features[${idx}] missing required field "properties"`,
      { field: "properties" },
    );
  }
}
