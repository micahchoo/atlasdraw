import { isGeoCustomData } from "./types.js";

import { normalizeLng } from "./projection.js";

import type { GeoAnchor } from "./types.js";

// Web Mercator at canonical zoom 0 (world fits in 256 px).
// Stable reference independent of the live map viewport.
const TILE_SIZE = 256;

function mercX(lng: number): number {
  // Normalize before computing so out-of-range anchors (e.g. lng=-254°) map
  // to the correct [0, 256] canonical range rather than producing negative values.
  return ((normalizeLng(lng) + 180) / 360) * TILE_SIZE;
}

function mercY(lat: number): number {
  const siny = Math.sin((lat * Math.PI) / 180);
  return (0.5 - Math.log((1 + siny) / (1 - siny)) / (4 * Math.PI)) * TILE_SIZE;
}

function applyAnchor(
  el: Record<string, unknown>,
  anchor: GeoAnchor,
): Record<string, unknown> {
  // _lastSync is a CoordinateSync field stored in customData alongside the geo
  // anchor. It records the last viewport-space position CoordinateSync wrote so
  // that reanchorIfMoved can detect user drags without a map.unproject call.
  //
  // After normalization x/y/points are canonical zoom-0 values, not viewport
  // values. We must overwrite _lastSync with the canonical coords so that when
  // the file is loaded, reanchorIfMoved sees "last sync matches current position"
  // and does NOT re-anchor. CoordinateSync will overwrite _lastSync with fresh
  // viewport values on the first camera event.
  const cd = el.customData as Record<string, unknown>;

  if (anchor.kind === "point") {
    const x = mercX(anchor.lng);
    const y = mercY(anchor.lat);
    return {
      ...el,
      x,
      y,
      customData: { ...cd, _lastSync: { x, y } },
    };
  }
  if (anchor.kind === "bbox") {
    const x = mercX(anchor.west);
    const y = mercY(anchor.north);
    const w = mercX(anchor.east) - x;
    const h = mercY(anchor.south) - y;
    // RT-2. Canonical space is north-up, so the camera contributes no
    // rotation here and the canonical angle is the user's own — `a0`. Without
    // this, a document saved while the map was turned would reopen with the
    // camera's rotation baked into every bbox element.
    //
    // When `a0` is absent, `angle` is deliberately left untouched rather than
    // zeroed. Every element written since RT-2 records `a0`, so an element
    // without one predates it and its `angle` is already the user's own. The
    // one case this exports crooked is an element rotated during the window
    // when the map could turn and nothing recorded a baseline — which RT-0
    // closed. Zeroing would silently discard a real user rotation from every
    // pre-RT-2 document to fix that; leaving it is the smaller lie.
    const a0 = (cd._lastSync as Record<string, unknown> | undefined)?.a0 as
      | number
      | undefined;
    return {
      ...el,
      x,
      y,
      width: w,
      height: h,
      ...(a0 !== undefined ? { angle: a0 } : {}),
      customData: {
        ...cd,
        _lastSync: {
          x,
          y,
          w,
          h,
          ...(a0 !== undefined ? { a0, a: a0 } : {}),
        },
      },
    };
  }
  // polyline: first coord is origin; rest are relative offsets
  const [[lng0, lat0], ...rest] = anchor.coordinates;
  const ox = mercX(lng0);
  const oy = mercY(lat0);
  const pts = [
    [0, 0],
    ...rest.map(([lng, lat]) => [mercX(lng) - ox, mercY(lat) - oy]),
  ];
  return {
    ...el,
    x: ox,
    y: oy,
    points: pts,
    customData: { ...cd, _lastSync: { x: ox, y: oy, pts } },
  };
}

/**
 * Remap geo-anchored elements to canonical Web Mercator coords (zoom 0) so
 * saved .excalidraw files are viewport-independent. Non-geo elements pass
 * through unchanged.
 */
export function normalizeElementsForExport(
  elements: readonly unknown[],
): readonly unknown[] {
  return elements.map((el) => {
    if (typeof el !== "object" || el === null) {
      return el;
    }
    const e = el as Record<string, unknown>;
    const data = e.customData;
    if (!isGeoCustomData(data)) {
      return el;
    }
    return applyAnchor(e, data.geo);
  });
}
