// packages/geo/src/parseGeoCustomData.ts
// SPDX-License-Identifier: MIT
// Deep parser + migration shim for GeoCustomData.
// Closes hardening seeds: atlasdraw-db43 (parseGeoCustomData) + atlasdraw-072a (migrate).
//
// Project convention: throw a named error class on failure (matches GeoJSONParseError
// in @atlasdraw/data). DO NOT switch to a Result<T, E> shape — emergent codebase pattern
// is throw + named error.

import { isValidZRef, MAX_ZREF } from "./types.js";

import type { GeoAnchor, GeoCustomData, ScaleMode } from "./types.js";

/**
 * Thrown by parseGeoCustomData / migrate when input is not valid GeoCustomData.
 * Message includes a concise reason (which field failed validation).
 */
export class GeoCustomDataParseError extends Error {
  constructor(reason: string) {
    super(`GeoCustomData parse failed: ${reason}`);
    this.name = "GeoCustomDataParseError";
  }
}

const SCALE_MODES: ReadonlySet<ScaleMode> = new Set<ScaleMode>([
  "geographic",
  "screen",
  "hybrid",
]);

const ANCHOR_KINDS = new Set(["point", "bbox", "polyline"] as const);

const isObject = (v: unknown): v is Record<string, unknown> =>
  typeof v === "object" && v !== null && !Array.isArray(v);

const isFiniteNumber = (v: unknown): v is number =>
  typeof v === "number" && Number.isFinite(v);

const fail = (reason: string): never => {
  throw new GeoCustomDataParseError(reason);
};

function parseGeoAnchor(g: unknown): GeoAnchor {
  if (!isObject(g)) {
    fail("geo: not an object");
  }
  const obj = g as Record<string, unknown>;
  const kind = obj.kind;
  if (typeof kind !== "string" || !ANCHOR_KINDS.has(kind as never)) {
    fail(`geo.kind: unknown or missing kind "${String(kind)}"`);
  }

  if (kind === "point") {
    if (!isFiniteNumber(obj.lng)) {
      fail("geo.lng: must be a finite number");
    }
    if (!isFiniteNumber(obj.lat)) {
      fail("geo.lat: must be a finite number");
    }
    if (!isValidZRef(obj.zRef)) {
      fail(`geo.zRef: must be a finite number in [0, ${MAX_ZREF}]`);
    }
    return {
      kind: "point",
      lng: obj.lng as number,
      lat: obj.lat as number,
      zRef: obj.zRef as number,
    };
  }

  if (kind === "bbox") {
    if (!isFiniteNumber(obj.west)) {
      fail("geo.west: must be a finite number");
    }
    if (!isFiniteNumber(obj.south)) {
      fail("geo.south: must be a finite number");
    }
    if (!isFiniteNumber(obj.east)) {
      fail("geo.east: must be a finite number");
    }
    if (!isFiniteNumber(obj.north)) {
      fail("geo.north: must be a finite number");
    }
    if (!isValidZRef(obj.zRef)) {
      fail(`geo.zRef: must be a finite number in [0, ${MAX_ZREF}]`);
    }
    const west = obj.west as number;
    const east = obj.east as number;
    const south = obj.south as number;
    const north = obj.north as number;
    if (!(west < east)) {
      fail(`geo bbox: west (${west}) must be < east (${east})`);
    }
    if (!(south < north)) {
      fail(`geo bbox: south (${south}) must be < north (${north})`);
    }
    return { kind: "bbox", west, south, east, north, zRef: obj.zRef as number };
  }

  // polyline
  if (!Array.isArray(obj.coordinates)) {
    fail("geo.coordinates: must be an array");
  }
  const coords = obj.coordinates as unknown[];
  if (coords.length < 2) {
    fail("geo.coordinates: polyline must have at least 2 points");
  }
  const validated: Array<[number, number]> = [];
  for (let i = 0; i < coords.length; i++) {
    const c = coords[i];
    if (!Array.isArray(c) || c.length !== 2) {
      fail(`geo.coordinates[${i}]: must be a [lng, lat] tuple`);
    }
    const tuple = c as unknown[];
    if (!isFiniteNumber(tuple[0]) || !isFiniteNumber(tuple[1])) {
      fail(`geo.coordinates[${i}]: lng/lat must be finite numbers`);
    }
    validated.push([tuple[0] as number, tuple[1] as number]);
  }
  if (!isValidZRef(obj.zRef)) {
    fail(`geo.zRef: must be a finite number in [0, ${MAX_ZREF}]`);
  }
  return { kind: "polyline", coordinates: validated, zRef: obj.zRef as number };
}

function parseValidatedV1(value: unknown): GeoCustomData {
  if (!isObject(value)) {
    fail("top-level: not an object");
  }
  const v = value as Record<string, unknown>;

  if (typeof v.schemaVersion !== "number") {
    fail("schemaVersion: missing or not a number");
  }
  if (v.schemaVersion !== 1) {
    fail(`schemaVersion: expected 1, got ${String(v.schemaVersion)}`);
  }

  if (v.projection !== "mercator") {
    fail(`projection: expected "mercator", got ${String(v.projection)}`);
  }

  if (
    typeof v.scaleMode !== "string" ||
    !SCALE_MODES.has(v.scaleMode as ScaleMode)
  ) {
    fail(
      `scaleMode: must be one of geographic|screen|hybrid, got ${String(
        v.scaleMode,
      )}`,
    );
  }

  const geo = parseGeoAnchor(v.geo);
  return {
    geo,
    scaleMode: v.scaleMode as ScaleMode,
    projection: "mercator",
    schemaVersion: 1,
  };
}

/**
 * Deep parser for untrusted GeoCustomData input (file imports, persisted state,
 * peer messages). Throws GeoCustomDataParseError with a precise reason on failure.
 *
 * Routes through migrate() if schemaVersion !== 1.
 *
 * The shallow `isGeoCustomData` type guard remains as a fast-path for values
 * already trusted by construction.
 */
export function parseGeoCustomData(value: unknown): GeoCustomData {
  if (!isObject(value)) {
    fail("top-level: not an object");
  }
  const v = value as Record<string, unknown>;

  if (typeof v.schemaVersion !== "number") {
    fail("schemaVersion: missing or not a number");
  }
  if (v.schemaVersion !== 1) {
    return migrate(value, v.schemaVersion as number);
  }
  return parseValidatedV1(value);
}

/**
 * Migration shim. v1 → v1 is identity (subject to validation). Future versions
 * add branches here.
 */
export function migrate(value: unknown, fromVersion: number): GeoCustomData {
  switch (fromVersion) {
    case 1:
      return parseValidatedV1(value);
    default:
      fail(`unknown version: ${fromVersion}`);
      // unreachable — fail() throws
      throw new GeoCustomDataParseError("unreachable");
  }
}
