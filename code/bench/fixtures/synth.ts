// SPDX-License-Identifier: MIT
// Synthetic GeoJSON fixture generators for the bench harness.
//
// We generate fixtures programmatically rather than committing large blobs to
// keep the repo small and the bench deterministic. A linear-congruential PRNG
// (seeded) gives us reproducible coordinates without pulling a dependency.

import type { FeatureCollection, Feature, Point, Polygon } from "geojson";

// Deterministic PRNG — same seed → same sequence across Node versions.
function mulberry32(seed: number): () => number {
  let t = seed >>> 0;
  return () => {
    t = (t + 0x6d2b79f5) >>> 0;
    let r = Math.imul(t ^ (t >>> 15), 1 | t);
    r = (r + Math.imul(r ^ (r >>> 7), 61 | r)) ^ r;
    return ((r ^ (r >>> 14)) >>> 0) / 4294967296;
  };
}

/**
 * Build a FeatureCollection of `n` Point features with random lng/lat in the
 * RFC-7946 valid range. Properties carry an `id` and a synthetic `score`.
 */
export function synthPointFC(n: number, seed = 1): FeatureCollection {
  const rand = mulberry32(seed);
  const features: Feature<Point>[] = new Array(n);
  for (let i = 0; i < n; i++) {
    const lng = rand() * 360 - 180;
    const lat = rand() * 170 - 85; // avoid the poles
    features[i] = {
      type: "Feature",
      geometry: { type: "Point", coordinates: [lng, lat] },
      properties: { id: i, score: rand() },
    };
  }
  return { type: "FeatureCollection", features };
}

/**
 * Build a FeatureCollection of `n` square-ish Polygon features. Each polygon
 * is a small closed quadrilateral — first and last coordinates match per RFC
 * 7946. Useful when we want validators that walk into geometry rings.
 */
export function synthPolygonFC(n: number, seed = 2): FeatureCollection {
  const rand = mulberry32(seed);
  const features: Feature<Polygon>[] = new Array(n);
  for (let i = 0; i < n; i++) {
    const lng = rand() * 358 - 179;
    const lat = rand() * 168 - 84;
    const d = 0.001 + rand() * 0.01;
    const ring: [number, number][] = [
      [lng, lat],
      [lng + d, lat],
      [lng + d, lat + d],
      [lng, lat + d],
      [lng, lat],
    ];
    features[i] = {
      type: "Feature",
      geometry: { type: "Polygon", coordinates: [ring] },
      properties: { id: i },
    };
  }
  return { type: "FeatureCollection", features };
}
