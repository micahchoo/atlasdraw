// SPDX-License-Identifier: MIT
//
// Length and area on the WGS84 ellipsoid.
//
// Length: Vincenty's inverse formula (1975), which is correct to 0.5 mm on
// the ellipsoid. It does not converge for points that are nearly antipodal;
// for those the length is the great circle on the mean-radius sphere, which
// is correct to 0.5%.
//
// Area: the shoelace formula on the cylindrical equal-area projection of the
// ellipsoid (x = λ, y = sin β, with β the authalic latitude, scaled by the
// authalic radius). That projection keeps area, so the result is exact for a
// ring whose edges are straight in it: meridians and parallels are, so a
// lng/lat cell is exact. Any other edge is exact to the extent that its
// vertices are dense; `sceneMeasure.ts` adds vertices for that reason.

export interface LngLat {
  readonly lng: number;
  readonly lat: number;
}

/** WGS84 semi-major axis, metres. */
const A = 6_378_137;
/** WGS84 flattening. */
const F = 1 / 298.257_223_563;
const B = A * (1 - F);
const E2 = F * (2 - F);
const E = Math.sqrt(E2);
/** Mean radius (2a + b) / 3, for the antipodal fallback. */
const MEAN_RADIUS = (2 * A + B) / 3;

const RAD = Math.PI / 180;

function greatCircle(a: LngLat, b: LngLat): number {
  const p1 = a.lat * RAD;
  const p2 = b.lat * RAD;
  const dp = p2 - p1;
  const dl = (b.lng - a.lng) * RAD;
  const h =
    Math.sin(dp / 2) ** 2 + Math.cos(p1) * Math.cos(p2) * Math.sin(dl / 2) ** 2;
  return 2 * MEAN_RADIUS * Math.asin(Math.min(1, Math.sqrt(h)));
}

/** The shortest distance between two points on WGS84, metres. */
export function geodesicDistance(a: LngLat, b: LngLat): number {
  if (a.lng === b.lng && a.lat === b.lat) {
    return 0;
  }
  const L = (b.lng - a.lng) * RAD;
  const U1 = Math.atan((1 - F) * Math.tan(a.lat * RAD));
  const U2 = Math.atan((1 - F) * Math.tan(b.lat * RAD));
  const sinU1 = Math.sin(U1);
  const cosU1 = Math.cos(U1);
  const sinU2 = Math.sin(U2);
  const cosU2 = Math.cos(U2);

  let lambda = L;
  for (let i = 0; i < 200; i++) {
    const sinL = Math.sin(lambda);
    const cosL = Math.cos(lambda);
    const sinSigma = Math.sqrt(
      (cosU2 * sinL) ** 2 + (cosU1 * sinU2 - sinU1 * cosU2 * cosL) ** 2,
    );
    if (sinSigma === 0) {
      return 0;
    }
    const cosSigma = sinU1 * sinU2 + cosU1 * cosU2 * cosL;
    const sigma = Math.atan2(sinSigma, cosSigma);
    const sinAlpha = (cosU1 * cosU2 * sinL) / sinSigma;
    const cos2Alpha = 1 - sinAlpha * sinAlpha;
    // On the equator cos²α is 0 and the term goes away.
    const cos2SigmaM =
      cos2Alpha === 0 ? 0 : cosSigma - (2 * sinU1 * sinU2) / cos2Alpha;
    const C = (F / 16) * cos2Alpha * (4 + F * (4 - 3 * cos2Alpha));
    const prev = lambda;
    lambda =
      L +
      (1 - C) *
        F *
        sinAlpha *
        (sigma +
          C *
            sinSigma *
            (cos2SigmaM + C * cosSigma * (-1 + 2 * cos2SigmaM ** 2)));
    if (Math.abs(lambda) > Math.PI) {
      // The iteration has left the valid range: a nearly antipodal pair.
      break;
    }
    if (Math.abs(lambda - prev) < 1e-12) {
      const u2 = (cos2Alpha * (A * A - B * B)) / (B * B);
      const k1 =
        1 + (u2 / 16384) * (4096 + u2 * (-768 + u2 * (320 - 175 * u2)));
      const k2 = (u2 / 1024) * (256 + u2 * (-128 + u2 * (74 - 47 * u2)));
      const dSigma =
        k2 *
        sinSigma *
        (cos2SigmaM +
          (k2 / 4) *
            (cosSigma * (-1 + 2 * cos2SigmaM ** 2) -
              (k2 / 6) *
                cos2SigmaM *
                (-3 + 4 * sinSigma ** 2) *
                (-3 + 4 * cos2SigmaM ** 2)));
      return B * k1 * (sigma - dSigma);
    }
  }
  return greatCircle(a, b);
}

/** The length of a line string: the sum of its geodesic segments, metres. */
export function lengthOf(line: readonly LngLat[]): number {
  let total = 0;
  for (let i = 1; i < line.length; i++) {
    total += geodesicDistance(line[i - 1], line[i]);
  }
  return total;
}

/** q(φ) of the authalic latitude: sin β = q(φ) / q(90°). */
function authalicQ(latDeg: number): number {
  const s = Math.sin(latDeg * RAD);
  return (
    (1 - E2) *
    (s / (1 - E2 * s * s) - (1 / (2 * E)) * Math.log((1 - E * s) / (1 + E * s)))
  );
}

/** a² q(90°) / 2: the authalic radius squared. */
const AUTHALIC_R2 = ((A * A) / 2) * authalicQ(90);

/**
 * The area of a ring on WGS84, m². Either winding; a repeated closing point
 * is ignored. Edges are straight in the equal-area cylinder (see the header).
 */
export function areaOf(ring: readonly LngLat[]): number {
  let pts = ring;
  if (
    pts.length > 1 &&
    pts[0].lng === pts[pts.length - 1].lng &&
    pts[0].lat === pts[pts.length - 1].lat
  ) {
    pts = pts.slice(0, -1);
  }
  const n = pts.length;
  if (n < 3) {
    return 0;
  }
  const qp = authalicQ(90);
  let sum = 0;
  for (let i = 0; i < n; i++) {
    const prev = pts[(i + n - 1) % n];
    const next = pts[(i + 1) % n];
    sum += (next.lng - prev.lng) * RAD * (authalicQ(pts[i].lat) / qp);
  }
  return Math.abs((sum * AUTHALIC_R2) / 2);
}
