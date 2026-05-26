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
 *   | rectangle, ellipse, diamond, image| bbox     | geographic   |
 *   | frame, magicframe                 | bbox     | geographic   |
 *   | line, arrow, freedraw             | polyline | geographic   |
 *   | text                              | point    | screen       |
 *
 * Rationale (per Wave 4 plan addendum):
 *   - bbox / geographic: shape size is meaningful in world units; resize with zoom.
 *   - polyline / geographic: vertex coordinates scale fully with projection, matching
 *     bbox behavior — lines cover consistent real-world distance at any zoom.
 *   - point / screen: text size is set explicitly by the user; only its anchor
 *     position should track the map.
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
import { unprojectPoint, projectPoint, isGeoCustomData } from "@atlasdraw/geo";

import type { ExcalidrawImperativeAPI } from "@excalidraw/excalidraw";

import type { GeoCustomData, GeoAnchor } from "@atlasdraw/geo";
import type maplibregl from "maplibre-gl";

/** Bbox-shaped tools — anchored as `kind:"bbox"` with `scaleMode:"geographic"`. */
const BBOX_TOOL_TYPES = new Set([
  "rectangle",
  "ellipse",
  "diamond",
  "image",
  "frame",
  "magicframe",
]);
/** Polyline-shaped tools — anchored as `kind:"polyline"` with `scaleMode:"geographic"`. */
const POLYLINE_TOOL_TYPES = new Set(["line", "arrow", "freedraw"]);
/** Point-anchored tools — anchored as `kind:"point"` with `scaleMode:"screen"`. */
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
  pts?: ReadonlyArray<readonly [number, number]>;
}

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
      scaleMode: "screen",
      projection: PROJECTION,
      schemaVersion: 1,
    };
  }

  return null;
}

/**
 * If the element's current screen position diverges from what its geo anchor
 * projects to (i.e. the user moved or resized it), return a new element with
 * `customData.geo` updated to the reverse-projected position. Returns null when
 * the position is within float tolerance — indicating `syncMapToScene` just
 * wrote those values and no user-initiated change occurred.
 *
 * `zRef` is intentionally preserved from the existing anchor so scale-factor
 * computation (`2^(currentZoom - zRef)`) stays anchored to creation zoom.
 *
 * NOTE: for `bbox` kind, `Math.max(1, span)` clamping in `_projectElement`
 * means elements smaller than 1 screen-pixel produce a slightly inexact
 * reverse-projection. This is an accepted edge case — the geo error is
 * sub-pixel and the element renders identically.
 *
 * @internal
 */
function reanchorIfMoved(
  el: ElementGeoFields & { customData: GeoCustomData; [k: string]: unknown },
  map: maplibregl.Map,
):
  | (ElementGeoFields & { customData: GeoCustomData; [k: string]: unknown })
  | null {
  const existingGeo = el.customData.geo;
  const lastSync = (el.customData as { _lastSync?: LastSync })._lastSync;

  switch (existingGeo.kind) {
    case "point": {
      let moved: boolean;
      if (lastSync !== undefined) {
        // Primary path: compare against the exact values _projectElement wrote.
        // Timing-immune — no map projection call needed for detection.
        moved =
          Math.abs(el.x - lastSync.x) > GEO_TOLERANCE ||
          Math.abs(el.y - lastSync.y) > GEO_TOLERANCE;
      } else {
        // Fallback: element predates _lastSync — use geo-space comparison.
        const cur = unprojectPoint(map, el.x, el.y);
        moved =
          Math.abs(cur.lng - existingGeo.lng) > GEO_TOLERANCE ||
          Math.abs(cur.lat - existingGeo.lat) > GEO_TOLERANCE;
      }
      if (!moved) {
        return null;
      }
      // Re-anchor: unproject current screen position → new geo anchor.
      const cur = unprojectPoint(map, el.x, el.y);
      const newAnchor: GeoAnchor = {
        ...existingGeo,
        lng: cur.lng,
        lat: cur.lat,
      };
      // Clear _lastSync so CoordinateSync writes a fresh one on next sync.
      return {
        ...el,
        customData: { ...el.customData, geo: newAnchor, _lastSync: undefined },
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
      const SCREEN_TOL = 0.01; // float drift only; user drags are multi-pixel
      let moved: boolean;
      if (lastSync?.w !== undefined && lastSync?.h !== undefined) {
        // Primary path: compare against the exact values _projectElement wrote.
        // Timing-immune — no map projection call needed for detection.
        moved =
          Math.abs(el.x - lastSync.x) > SCREEN_TOL ||
          Math.abs(el.y - lastSync.y) > SCREEN_TOL ||
          Math.abs(el.width - lastSync.w) > SCREEN_TOL ||
          Math.abs(el.height - lastSync.h) > SCREEN_TOL;
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
      const nw = unprojectPoint(map, el.x, el.y);
      const se = unprojectPoint(map, el.x + el.width, el.y + el.height);
      const west = Math.min(nw.lng, se.lng);
      const east = Math.max(nw.lng, se.lng);
      const north = Math.max(nw.lat, se.lat);
      const south = Math.min(nw.lat, se.lat);
      const newAnchor: GeoAnchor = { ...existingGeo, west, east, north, south };
      // Clear _lastSync so CoordinateSync writes a fresh one on next sync.
      return {
        ...el,
        customData: { ...el.customData, geo: newAnchor, _lastSync: undefined },
      };
    }
    case "polyline": {
      const pts = el.points;
      if (!pts || pts.length === 0) {
        return null;
      }
      if (lastSync?.pts && lastSync.pts.length === pts.length) {
        // Primary path: compare screen-space points against _lastSync snapshot.
        // Timing-immune — no map projection call needed for detection.
        const unchanged = pts.every(
          ([dx, dy], i) =>
            Math.abs(dx - lastSync.pts![i][0]) <= GEO_TOLERANCE &&
            Math.abs(dy - lastSync.pts![i][1]) <= GEO_TOLERANCE,
        );
        if (unchanged) {
          return null;
        }
        // Points moved — compute new geo coords and re-anchor.
        const newCoords: Array<[number, number]> = pts.map(([dx, dy]) => {
          const ll = unprojectPoint(map, el.x + dx, el.y + dy);
          return [ll.lng, ll.lat];
        });
        const newAnchor: GeoAnchor = { ...existingGeo, coordinates: newCoords };
        // Clear _lastSync so CoordinateSync writes a fresh one on next sync.
        return {
          ...el,
          customData: {
            ...el.customData,
            geo: newAnchor,
            _lastSync: undefined,
          },
        };
      }
      // Fallback: element predates _lastSync (or screen mode) — use geo-space
      // comparison against existingGeo.coordinates (existing behaviour).
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
      return {
        ...el,
        customData: { ...el.customData, geo: newAnchor, _lastSync: undefined },
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
      excalidrawAPI.updateScene({ elements: next as never });
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
