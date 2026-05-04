// packages/geo/bench/synthetic-scene-gen.ts
// SPDX-License-Identifier: MIT
// Phase 1 Wave 3b Task 16 — synthetic scene generator for coord-sync bench.
//
// Generates N elements with random geo anchors covering all three GeoAnchor
// kinds (point | bbox | polyline) and all three scaleModes. Deterministic via
// mulberry32 PRNG seeded with a constant — runs are reproducible.
//
// The element shape is the minimal subset CoordinateSync.syncMapToScene reads:
// id, x, y, width, height, points, customData. We do NOT depend on
// @excalidraw/excalidraw — see ExcalidrawElementLike in CoordinateSync.ts.

import type {
  ExcalidrawElementLike,
  // ExcalidrawElementLike is the structural type CoordinateSync expects.
} from "../src/CoordinateSync.js";
import type { GeoAnchor, GeoCustomData, ScaleMode } from "../src/types.js";

// ---------------------------------------------------------------------------
// Deterministic PRNG (mulberry32) — small, fast, good enough for bench data.
// ---------------------------------------------------------------------------
function mulberry32(seed: number): () => number {
  let a = seed >>> 0;
  return function next() {
    a = (a + 0x6d2b79f5) >>> 0;
    let t = a;
    t = Math.imul(t ^ (t >>> 15), t | 1);
    t ^= t + Math.imul(t ^ (t >>> 7), t | 61);
    return ((t ^ (t >>> 14)) >>> 0) / 4294967296;
  };
}

const SEED = 0x12345;

const KINDS: ReadonlyArray<GeoAnchor["kind"]> = ["point", "bbox", "polyline"];
const SCALE_MODES: ReadonlyArray<ScaleMode> = [
  "geographic",
  "screen",
  "hybrid",
];

function randInRange(rand: () => number, lo: number, hi: number): number {
  return lo + rand() * (hi - lo);
}

function makeAnchor(rand: () => number, kind: GeoAnchor["kind"]): GeoAnchor {
  const zRef = Math.floor(randInRange(rand, 0, 18));
  if (kind === "point") {
    return {
      kind: "point",
      lng: randInRange(rand, -180, 180),
      lat: randInRange(rand, -85, 85),
      zRef,
    };
  }
  if (kind === "bbox") {
    // Ensure west < east and south < north by sampling two values and ordering.
    const lngA = randInRange(rand, -180, 180);
    const lngB = randInRange(rand, -180, 180);
    const latA = randInRange(rand, -85, 85);
    const latB = randInRange(rand, -85, 85);
    const west = Math.min(lngA, lngB);
    const east = Math.max(lngA, lngB);
    const south = Math.min(latA, latB);
    const north = Math.max(latA, latB);
    // Guard against degenerate zero-span bboxes — nudge by 1e-6 deg.
    return {
      kind: "bbox",
      west,
      south,
      east: east === west ? east + 1e-6 : east,
      north: north === south ? north + 1e-6 : north,
      zRef,
    };
  }
  // polyline — 5..20 random coords
  const count = 5 + Math.floor(rand() * 16);
  const coordinates: Array<[number, number]> = [];
  for (let i = 0; i < count; i++) {
    coordinates.push([
      randInRange(rand, -180, 180),
      randInRange(rand, -85, 85),
    ]);
  }
  return { kind: "polyline", coordinates, zRef };
}

/**
 * Generate `n` synthetic Excalidraw elements with geo customData.
 *
 * Deterministic — same `n` always yields the same scene (mulberry32 seeded).
 *
 * Each element gets:
 * - stable `id` of `el-${i}`
 * - non-zero placeholder `x/y/width/height` (CoordinateSync overwrites these
 *   from the geo anchor on every sync)
 * - `customData.geo` random anchor; `customData.scaleMode` random;
 *   `customData.projection: "mercator"`; `customData.schemaVersion: 1`
 */
export function generateScene(n: number): ExcalidrawElementLike[] {
  const rand = mulberry32(SEED);
  const out: ExcalidrawElementLike[] = new Array(n);
  for (let i = 0; i < n; i++) {
    const kind = KINDS[Math.floor(rand() * KINDS.length)]!;
    const scaleMode = SCALE_MODES[Math.floor(rand() * SCALE_MODES.length)]!;
    const anchor = makeAnchor(rand, kind);
    const customData: GeoCustomData = {
      geo: anchor,
      scaleMode,
      projection: "mercator",
      schemaVersion: 1,
    };
    const el: ExcalidrawElementLike = {
      id: `el-${i}`,
      x: 100,
      y: 100,
      width: 50,
      height: 50,
      customData,
    };
    if (kind === "polyline") {
      // Provide a placeholder points array; CoordinateSync overwrites it.
      el.points = [
        [0, 0],
        [10, 10],
      ];
    }
    out[i] = el;
  }
  return out;
}
