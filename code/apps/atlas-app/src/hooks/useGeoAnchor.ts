/**
 * useGeoAnchor — auto-stamps `customData.geo` on Excalidraw elements created by
 * the native (stock) toolbar.
 *
 * Phase 2 Wave 4 Task T18 expanded the scope from bbox-only (rectangle/ellipse/
 * diamond) to ALL native tools, dispatching to the appropriate `GeoAnchor.kind`
 * + `scaleMode` per the matrix below:
 *
 *   | type                              | kind     | scaleMode    |
 *   |-----------------------------------|----------|--------------|
 *   | rectangle, ellipse, diamond       | bbox     | geographic   |
 *   | image, iframe, embeddable         | bbox     | geographic   |
 *   | frame, magicframe                 | bbox     | geographic   |
 *   | line, arrow, freedraw             | polyline | geographic   |
 *   | text                              | point    | geographic   |
 *
 * Rationale (per Wave 4 plan addendum):
 *   - bbox / geographic: shape size is meaningful in world units; resize with zoom.
 *   - polyline / geographic: vertex coordinates scale fully with projection, matching
 *     bbox behavior — lines cover consistent real-world distance at any zoom.
 *   - point / geographic: text labels scale with the map projection alongside
 *     other geo-anchored shapes (fontSize, width, height all scale by factor).
 *
 * Lifecycle: subscribes via `excalidrawAPI.onChange`. While `appState.newElement`
 * is non-null, the element is mid-drag — we skip stamping so the final geometry
 * is captured (not the first-frame click point). After pointerUp, `newElement`
 * clears and the element appears in the elements array; we then stamp once.
 *
 * Idempotency: an element with `customData.geo` already set is skipped. The
 * stamp itself triggers another onChange, but that pass finds geo set → no loop.
 *
 * Arrow bindings: arrow/line elements with `startBinding` / `endBinding` are
 * still anchored by their `points[]`. Excalidraw routes the visible endpoints
 * to the bound targets at render time; if both targets are geo-anchored, the
 * visual stays correct under zoom regardless of our anchor. If endpoints become
 * unbound, our polyline anchor takes over — no special-casing needed.
 *
 * @see atlasdraw-9152 — original scope decision (Phase 1: bbox tools only)
 * @see Wave 4 addendum, Task T18 — native auto-anchor extension
 * @see scaleMode.ts — element scaling per scaleMode under zoom
 * @see useCoordinateSync — sister hook (camera → element projection)
 */

import { useEffect } from "react";
import {
  unprojectPoint,
  projectPoint,
  isGeoCustomData,
  computeScaleFactor,
  clampHybridFactor,
} from "@atlasdraw/geo";

import type { ExcalidrawImperativeAPI } from "@atlasdraw/excalidraw";

import type { GeoCustomData, GeoAnchor } from "@atlasdraw/geo";

import type maplibregl from "maplibre-gl";

/** Bbox-shaped tools — anchored as `kind:"bbox"` with `scaleMode:"geographic"`. */
const BBOX_TOOL_TYPES = new Set([
  "rectangle",
  "ellipse",
  "diamond",
  "image",
  "iframe",
  "embeddable",
  "frame",
  "magicframe",
]);
/** Polyline-shaped tools — anchored as `kind:"polyline"` with `scaleMode:"geographic"`. */
const POLYLINE_TOOL_TYPES = new Set(["line", "arrow", "freedraw"]);
/** Point-anchored tools — anchored as `kind:"point"` with `scaleMode:"geographic"`. */
const POINT_TOOL_TYPES = new Set(["text"]);

/**
 * Float tolerance for geo-coordinate comparison (~1cm on Earth's surface).
 * `unprojectPoint(projectPoint(lng, lat))` is identity up to this threshold;
 * any larger delta means the user moved or resized the element.
 */
const GEO_TOLERANCE = 1e-7;

/** Mercator projection identifier used in all GeoCustomData stamps. */
const PROJECTION = "mercator" as const;

/**
 * Spatial snapshot written by `CoordinateSync._projectElement` onto each element's
 * `customData._lastSync`. Comparing against it instead of recomputing from the
 * current map state makes `reanchorIfMoved` immune to the async gap between
 * `updateScene` and `onChange`.
 */
interface LastSync {
  x: number;
  y: number;
  w?: number;
  h?: number;
  w0?: number;
  h0?: number;
  fontSize0?: number;
  strokeWidth0?: number;
  /** Projected fontSize as written by the last sync — style-edit detector. */
  fs?: number;
  /** Projected strokeWidth as written by the last sync — style-edit detector. */
  sw?: number;
  /** scaleMode at the last sync — mode-toggle detector. */
  mode?: string;
  pts?: ReadonlyArray<readonly [number, number]>;
}

/** `customData` of an anchored element, including the sync-protocol state. */
type AnchoredCustomData = GeoCustomData & { _lastSync?: LastSync };

/** An element whose `customData` carries a geo anchor (+ protocol state). */
type AnchoredElement = ElementGeoFields & {
  customData: AnchoredCustomData;
  [k: string]: unknown;
};

/**
 * Element shape we care about across the discriminated union. The public
 * Excalidraw element types are intricate (per-type structs); at runtime the
 * shared spatial fields are consistent. We narrow with a structural type and
 * cast at the call boundary in `buildGeoCustomData`.
 */
interface ElementGeoFields {
  type: string;
  x: number;
  y: number;
  width: number;
  height: number;
  fontSize?: number;
  strokeWidth?: number;
  /** Present on linear / freedraw elements (LocalPoint = [dx, dy] relative to x,y). */
  points?: ReadonlyArray<readonly [number, number]>;
}

/**
 * Build the GeoCustomData for an element based on its `type`. Returns null when
 * the element type is not in any auto-anchor bucket, or when required fields
 * (e.g. `points` for a polyline) are missing.
 */
function buildGeoCustomData(
  el: ElementGeoFields,
  map: maplibregl.Map,
  zRef: number,
): GeoCustomData | null {
  if (BBOX_TOOL_TYPES.has(el.type)) {
    const nw = unprojectPoint(map, el.x, el.y);
    const se = unprojectPoint(map, el.x + el.width, el.y + el.height);
    return {
      geo: {
        kind: "bbox",
        west: Math.min(nw.lng, se.lng),
        east: Math.max(nw.lng, se.lng),
        // Y axis: screen-y grows downward; nw.lat > se.lat (north > south).
        north: Math.max(nw.lat, se.lat),
        south: Math.min(nw.lat, se.lat),
        zRef,
      },
      scaleMode: "geographic",
      projection: PROJECTION,
      schemaVersion: 1,
    };
  }

  if (POLYLINE_TOOL_TYPES.has(el.type)) {
    const pts = el.points;
    if (!pts || pts.length === 0) {
      return null;
    }
    const coordinates: Array<[number, number]> = pts.map(([dx, dy]) => {
      const ll = unprojectPoint(map, el.x + dx, el.y + dy);
      return [ll.lng, ll.lat];
    });
    return {
      geo: {
        kind: "polyline",
        coordinates,
        zRef,
      },
      scaleMode: "geographic",
      projection: PROJECTION,
      schemaVersion: 1,
    };
  }

  if (POINT_TOOL_TYPES.has(el.type)) {
    const ll = unprojectPoint(map, el.x, el.y);
    return {
      geo: {
        kind: "point",
        lng: ll.lng,
        lat: ll.lat,
        zRef,
      },
      scaleMode: "geographic",
      projection: PROJECTION,
      schemaVersion: 1,
    };
  }

  return null;
}

/** Screen-space tolerance for move/resize detection (px). Float drift only —
 * user drags are multi-pixel. */
const SCREEN_TOL = 0.01;
/** Tolerance for style-field (strokeWidth/fontSize) change detection. */
const STYLE_TOL = 1e-6;

/** The scale factor the sync layer applies to sizes for a given mode. */
function effectiveFactor(
  scaleMode: string,
  zoom: number,
  zRef: number,
): number {
  if (scaleMode === "screen") {
    return 1;
  }
  const factor = computeScaleFactor(zoom, zRef);
  return scaleMode === "hybrid" ? clampHybridFactor(factor) : factor;
}

/**
 * In hybrid mode `_projectElement` scales projected spans/points by
 * `clamped/raw`; reverse-projection must divide displayed geometry by the
 * same ratio or the clamp gets baked into the anchor on every re-anchor.
 */
function hybridAdj(scaleMode: string, zoom: number, zRef: number): number {
  if (scaleMode !== "hybrid") {
    return 1;
  }
  const factor = computeScaleFactor(zoom, zRef);
  return clampHybridFactor(factor) / factor;
}

/**
 * A coherent `_lastSync` snapshot for the element's CURRENT state: positions
 * as-is, size/style baselines re-based so `baseline * factor == displayed`.
 * Written on every re-anchor — never clear `_lastSync` to undefined, or the
 * next sync adopts already-scaled sizes as new baselines and compounds them.
 */
function buildReanchorSnapshot(
  el: ElementGeoFields,
  customData: AnchoredCustomData,
  map: maplibregl.Map,
): LastSync {
  const f = effectiveFactor(
    customData.scaleMode,
    map.getZoom(),
    customData.geo.zRef,
  );
  const snap: LastSync = {
    x: el.x,
    y: el.y,
    w: el.width,
    h: el.height,
    w0: el.width / f,
    h0: el.height / f,
    mode: customData.scaleMode,
  };
  if (el.fontSize !== undefined) {
    snap.fontSize0 = el.fontSize / f;
    snap.fs = el.fontSize;
  }
  if (el.strokeWidth !== undefined) {
    snap.strokeWidth0 = el.strokeWidth / f;
    snap.sw = el.strokeWidth;
  }
  if (el.points) {
    snap.pts = el.points.map(([dx, dy]) => [dx, dy] as [number, number]);
  }
  return snap;
}

/** User edited strokeWidth/fontSize since the last sync wrote them. */
function styleChanged(el: ElementGeoFields, lastSync: LastSync): boolean {
  return (
    (lastSync.sw !== undefined &&
      el.strokeWidth !== undefined &&
      Math.abs(el.strokeWidth - lastSync.sw) > STYLE_TOL) ||
    (lastSync.fs !== undefined &&
      el.fontSize !== undefined &&
      Math.abs(el.fontSize - lastSync.fs) > STYLE_TOL)
  );
}

/**
 * Style-only change: keep the anchor, re-base the style baselines so the
 * next sync preserves the user's value instead of reverting it.
 */
function rebaseStyle(
  el: AnchoredElement,
  customData: AnchoredCustomData,
  lastSync: LastSync,
  map: maplibregl.Map,
): AnchoredElement {
  const f = effectiveFactor(
    customData.scaleMode,
    map.getZoom(),
    customData.geo.zRef,
  );
  const nextSync: LastSync = { ...lastSync, mode: customData.scaleMode };
  if (el.strokeWidth !== undefined && lastSync.sw !== undefined) {
    nextSync.strokeWidth0 = el.strokeWidth / f;
    nextSync.sw = el.strokeWidth;
  }
  if (el.fontSize !== undefined && lastSync.fs !== undefined) {
    nextSync.fontSize0 = el.fontSize / f;
    nextSync.fs = el.fontSize;
  }
  return { ...el, customData: { ...customData, _lastSync: nextSync } };
}

/**
 * If the element's current screen state diverges from what the last sync
 * wrote (i.e. the user moved, resized, or restyled it), return a new element
 * with `customData.geo` and/or the `_lastSync` baselines updated. Returns
 * null when everything matches within float tolerance — indicating
 * `syncMapToScene` just wrote those values and no user change occurred.
 *
 * `zRef` is preserved from the existing anchor so scale-factor computation
 * (`2^(currentZoom - zRef)`) stays anchored to creation zoom — EXCEPT on a
 * scale-mode toggle, where zRef and all baselines are re-based to the
 * current camera so the toggle preserves the current visual.
 *
 * NOTE: for `bbox` kind, `Math.max(1, span)` clamping in `_projectElement`
 * means elements smaller than 1 screen-pixel produce a slightly inexact
 * reverse-projection. This is an accepted edge case — the geo error is
 * sub-pixel and the element renders identically.
 *
 * @internal
 */
function reanchorIfMoved(
  el: AnchoredElement,
  map: maplibregl.Map,
): AnchoredElement | null {
  const customData = el.customData;
  const existingGeo = customData.geo;
  const lastSync = customData._lastSync;
  const scaleMode = customData.scaleMode;

  // Scale-mode toggle since the last sync: re-base zRef + baselines to the
  // current camera so the next sync keeps the size the user is looking at
  // (otherwise clamped/unclamped factor swaps pop the geometry).
  if (lastSync?.mode !== undefined && lastSync.mode !== scaleMode) {
    const rebasedGeo = { ...existingGeo, zRef: map.getZoom() } as GeoAnchor;
    const rebasedData: AnchoredCustomData = { ...customData, geo: rebasedGeo };
    return {
      ...el,
      customData: {
        ...rebasedData,
        _lastSync: buildReanchorSnapshot(el, rebasedData, map),
      },
    };
  }

  switch (existingGeo.kind) {
    case "point": {
      if (lastSync !== undefined) {
        // Primary path: compare against the exact values _projectElement wrote.
        // Timing-immune — no map projection call needed for detection.
        const moved =
          Math.abs(el.x - lastSync.x) > GEO_TOLERANCE ||
          Math.abs(el.y - lastSync.y) > GEO_TOLERANCE;
        // Width/height changes matter too: point-geographic sizes derive
        // from w0/h0 baselines — an undetected resize gets reverted by the
        // next sync.
        const resized =
          (lastSync.w !== undefined &&
            Math.abs(el.width - lastSync.w) > SCREEN_TOL) ||
          (lastSync.h !== undefined &&
            Math.abs(el.height - lastSync.h) > SCREEN_TOL);
        if (!moved && !resized) {
          if (styleChanged(el, lastSync)) {
            return rebaseStyle(el, customData, lastSync, map);
          }
          return null;
        }
        const cur = unprojectPoint(map, el.x, el.y);
        const newAnchor: GeoAnchor = {
          ...existingGeo,
          lng: cur.lng,
          lat: cur.lat,
        };
        const newData: AnchoredCustomData = { ...customData, geo: newAnchor };
        return {
          ...el,
          customData: {
            ...newData,
            _lastSync: buildReanchorSnapshot(el, newData, map),
          },
        };
      }
      // Fallback: element predates _lastSync — use geo-space comparison.
      const cur = unprojectPoint(map, el.x, el.y);
      const moved =
        Math.abs(cur.lng - existingGeo.lng) > GEO_TOLERANCE ||
        Math.abs(cur.lat - existingGeo.lat) > GEO_TOLERANCE;
      if (!moved) {
        return null;
      }
      const newAnchor: GeoAnchor = {
        ...existingGeo,
        lng: cur.lng,
        lat: cur.lat,
      };
      const newData: AnchoredCustomData = { ...customData, geo: newAnchor };
      return {
        ...el,
        customData: {
          ...newData,
          _lastSync: buildReanchorSnapshot(el, newData, map),
        },
      };
    }
    case "bbox": {
      // Compare in screen space, not geo space, to handle the Math.max(1, ...)
      // clamping that _projectElement applies at extreme zoom-out. When the
      // projected span is < 1px, _projectElement writes width=1; reverse-
      // projecting el.x + 1 produces a longitude far from anchor.east,
      // causing geo-space comparison to falsely detect a user resize and
      // corrupt the anchor. Screen-space comparison with the same clamping
      // logic is immune: it returns null whenever the element matches what
      // _projectElement would have written — including the clamped 1px case.
      let moved: boolean;
      if (lastSync?.w !== undefined && lastSync?.h !== undefined) {
        // Primary path: compare against the exact values _projectElement wrote.
        // Timing-immune — no map projection call needed for detection.
        moved =
          Math.abs(el.x - lastSync.x) > SCREEN_TOL ||
          Math.abs(el.y - lastSync.y) > SCREEN_TOL ||
          Math.abs(el.width - lastSync.w) > SCREEN_TOL ||
          Math.abs(el.height - lastSync.h) > SCREEN_TOL;
        if (!moved && styleChanged(el, lastSync)) {
          return rebaseStyle(el, customData, lastSync, map);
        }
      } else {
        // Fallback: element predates _lastSync — use screen-space comparison
        // reconstructed from the geo anchor (existing behaviour).
        const nwProj = projectPoint(map, existingGeo.west, existingGeo.north);
        const seProj = projectPoint(map, existingGeo.east, existingGeo.south);
        const expectedW = Math.max(1, seProj.x - nwProj.x);
        const expectedH = Math.max(1, seProj.y - nwProj.y);
        moved = !(
          Math.abs(el.x - nwProj.x) <= SCREEN_TOL &&
          Math.abs(el.y - nwProj.y) <= SCREEN_TOL &&
          Math.abs(el.width - expectedW) <= SCREEN_TOL &&
          Math.abs(el.height - expectedH) <= SCREEN_TOL
        );
      }
      if (!moved) {
        return null;
      }
      // User moved or resized — re-anchor from current screen position.
      // Hybrid mode: displayed spans carry the clamp adjustment; divide it
      // out or the clamp gets baked into the anchor.
      const adj = hybridAdj(scaleMode, map.getZoom(), existingGeo.zRef);
      const nw = unprojectPoint(map, el.x, el.y);
      const se = unprojectPoint(
        map,
        el.x + el.width / adj,
        el.y + el.height / adj,
      );
      const west = Math.min(nw.lng, se.lng);
      const east = Math.max(nw.lng, se.lng);
      const north = Math.max(nw.lat, se.lat);
      const south = Math.min(nw.lat, se.lat);
      const newAnchor: GeoAnchor = { ...existingGeo, west, east, north, south };
      const newData: AnchoredCustomData = { ...customData, geo: newAnchor };
      return {
        ...el,
        customData: {
          ...newData,
          _lastSync: buildReanchorSnapshot(el, newData, map),
        },
      };
    }
    case "polyline": {
      const pts = el.points;
      if (!pts || pts.length === 0) {
        return null;
      }
      if (lastSync?.pts && lastSync.pts.length === pts.length) {
        // Primary path: compare screen-space position AND points against the
        // _lastSync snapshot. Timing-immune. x/y matter: a whole-polyline
        // drag changes only x/y — relative points stay identical — and an
        // undetected move gets snapped back by the next sync.
        const movedXY =
          Math.abs(el.x - lastSync.x) > SCREEN_TOL ||
          Math.abs(el.y - lastSync.y) > SCREEN_TOL;
        const ptsUnchanged = pts.every(
          ([dx, dy], i) =>
            Math.abs(dx - lastSync.pts![i][0]) <= GEO_TOLERANCE &&
            Math.abs(dy - lastSync.pts![i][1]) <= GEO_TOLERANCE,
        );
        if (!movedXY && ptsUnchanged) {
          if (styleChanged(el, lastSync)) {
            return rebaseStyle(el, customData, lastSync, map);
          }
          return null;
        }
        // Moved or reshaped — compute new geo coords and re-anchor. Hybrid
        // mode: displayed points carry the clamp adjustment; divide it out.
        const adj = hybridAdj(scaleMode, map.getZoom(), existingGeo.zRef);
        const newCoords: Array<[number, number]> = pts.map(([dx, dy]) => {
          const ll = unprojectPoint(map, el.x + dx / adj, el.y + dy / adj);
          return [ll.lng, ll.lat];
        });
        const newAnchor: GeoAnchor = { ...existingGeo, coordinates: newCoords };
        const newData: AnchoredCustomData = { ...customData, geo: newAnchor };
        return {
          ...el,
          customData: {
            ...newData,
            _lastSync: buildReanchorSnapshot(el, newData, map),
          },
        };
      }
      // Fallback: element predates _lastSync — use geo-space comparison
      // against existingGeo.coordinates (existing behaviour).
      const newCoords: Array<[number, number]> = pts.map(([dx, dy]) => {
        const ll = unprojectPoint(map, el.x + dx, el.y + dy);
        return [ll.lng, ll.lat];
      });
      const existing = existingGeo.coordinates;
      const unchanged =
        newCoords.length === existing.length &&
        newCoords.every(
          ([lng, lat], i) =>
            Math.abs(lng - existing[i][0]) <= GEO_TOLERANCE &&
            Math.abs(lat - existing[i][1]) <= GEO_TOLERANCE,
        );
      if (unchanged) {
        return null;
      }
      const newAnchor: GeoAnchor = { ...existingGeo, coordinates: newCoords };
      const newData: AnchoredCustomData = { ...customData, geo: newAnchor };
      return {
        ...el,
        customData: {
          ...newData,
          _lastSync: buildReanchorSnapshot(el, newData, map),
        },
      };
    }
  }
}

/**
 * Build the onChange handler that stamps geo on new native-tool elements.
 * Exported for unit testing — the React hook below wraps it in a useEffect.
 *
 * @internal
 */
export function buildGeoAnchorHandler(
  map: maplibregl.Map,
  excalidrawAPI: ExcalidrawImperativeAPI,
): (
  elements: readonly {
    isDeleted?: boolean;
    customData?: unknown;
    type: string;
  }[],
  appState: { newElement: unknown | null },
) => void {
  return (elements, appState) => {
    // Skip while user is actively drawing — wait for pointerUp to finalize geometry.
    if (appState.newElement) {
      return;
    }

    const zRef = map.getZoom();
    let dirty = false;

    const next = elements.map((el) => {
      if (el.isDeleted) {
        return el;
      }

      if (isGeoCustomData(el.customData)) {
        // Already anchored — re-anchor if the user moved or resized the element.
        // `reanchorIfMoved` returns null when screen position matches the anchor
        // within float tolerance, which covers both "no change" and the case where
        // `syncMapToScene` just wrote the projected values.
        const reanchored = reanchorIfMoved(
          el as unknown as ElementGeoFields & {
            customData: GeoCustomData;
            [k: string]: unknown;
          },
          map,
        );
        if (reanchored) {
          dirty = true;
          return reanchored;
        }
        return el;
      }

      // New element — stamp geo for the first time.
      const geoCustomData = buildGeoCustomData(
        el as unknown as ElementGeoFields,
        map,
        zRef,
      );
      if (!geoCustomData) {
        return el;
      }

      dirty = true;
      return {
        ...el,
        customData: {
          ...(el.customData as object | undefined),
          ...geoCustomData,
        },
      };
    });

    if (dirty) {
      // NEVER: stamps and re-anchors are derived protocol state, not user
      // intent. Recording them as history entries splits a user gesture into
      // two undo steps — undo then lands between the gesture and its
      // re-anchor, and this handler re-anchors again, defeating the undo.
      excalidrawAPI.updateScene({
        elements: next as never,
        captureUpdate: "NEVER",
      });
    }
  };
}

/**
 * Subscribe to Excalidraw scene changes and stamp `customData.geo` on newly
 * created native-tool elements. See header for the type → kind/scaleMode matrix.
 *
 * @param map            - MapLibre Map instance (null until map mounts)
 * @param excalidrawAPI  - Excalidraw imperative API (null until Excalidraw mounts)
 */
export function useGeoAnchor(
  map: maplibregl.Map | null,
  excalidrawAPI: ExcalidrawImperativeAPI | null,
): void {
  useEffect(() => {
    if (!map || !excalidrawAPI) {
      return;
    }
    const handler = buildGeoAnchorHandler(map, excalidrawAPI);
    const unsub = excalidrawAPI.onChange(
      handler as Parameters<ExcalidrawImperativeAPI["onChange"]>[0],
    );
    return unsub;
  }, [map, excalidrawAPI]);
}
