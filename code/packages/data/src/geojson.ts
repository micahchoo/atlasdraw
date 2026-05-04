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

import type { Feature, FeatureCollection } from "geojson";

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
    if (opts.line !== undefined) this.line = opts.line;
    if (opts.field !== undefined) this.field = opts.field;
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
      "Expected top-level JSON object for FeatureCollection; got " +
        (raw === null ? "null" : Array.isArray(raw) ? "array" : typeof raw),
      { field: "type" },
    );
  }

  const obj = raw as Record<string, unknown>;
  const topType = obj["type"];
  if (topType !== "FeatureCollection") {
    throw new GeoJSONParseError(
      `Expected top-level type "FeatureCollection", got ${JSON.stringify(topType)}. ` +
        `Bare Feature/Geometry inputs are not accepted; wrap them in a FeatureCollection.`,
      { field: "type" },
    );
  }

  const features = obj["features"];
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

// ---------------------------------------------------------------------------
// internal

function validateFeature(feat: unknown, idx: number): asserts feat is Feature {
  if (feat === null || typeof feat !== "object" || Array.isArray(feat)) {
    throw new GeoJSONParseError(
      `features[${idx}] must be an object; got ${feat === null ? "null" : typeof feat}`,
      { field: `features[${idx}]` },
    );
  }
  const f = feat as Record<string, unknown>;

  if (f["type"] !== "Feature") {
    throw new GeoJSONParseError(
      `features[${idx}].type must be "Feature"; got ${JSON.stringify(f["type"])}`,
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
