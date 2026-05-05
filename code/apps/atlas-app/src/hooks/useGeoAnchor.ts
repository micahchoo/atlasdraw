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
 *   | line, arrow, freedraw             | polyline | hybrid       |
 *   | text                              | point    | screen       |
 *
 * Rationale (per Wave 4 plan addendum):
 *   - bbox / geographic: shape size is meaningful in world units; resize with zoom.
 *   - polyline / hybrid: vertex coordinates are geographic, but stroke thickness
 *     etc. stays screen-relative — handled by scaleMode.ts helpers + CoordinateSync.
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
import { unprojectPoint } from "@atlasdraw/geo";
import type { GeoCustomData } from "@atlasdraw/geo";
import type maplibregl from "maplibre-gl";
import type { ExcalidrawImperativeAPI } from "@excalidraw/excalidraw";

/** Bbox-shaped tools — anchored as `kind:"bbox"` with `scaleMode:"geographic"`. */
const BBOX_TOOL_TYPES = new Set(["rectangle", "ellipse", "diamond", "image"]);
/** Polyline-shaped tools — anchored as `kind:"polyline"` with `scaleMode:"hybrid"`. */
const POLYLINE_TOOL_TYPES = new Set(["line", "arrow", "freedraw"]);
/** Point-anchored tools — anchored as `kind:"point"` with `scaleMode:"screen"`. */
const POINT_TOOL_TYPES = new Set(["text"]);

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
      projection: "mercator",
      schemaVersion: 1,
    };
  }

  if (POLYLINE_TOOL_TYPES.has(el.type)) {
    const pts = el.points;
    if (!pts || pts.length === 0) return null;
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
      scaleMode: "hybrid",
      projection: "mercator",
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
      projection: "mercator",
      schemaVersion: 1,
    };
  }

  return null;
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
  elements: readonly { isDeleted?: boolean; customData?: unknown; type: string }[],
  appState: { newElement: unknown | null },
) => void {
  return (elements, appState) => {
    // Skip while user is actively drawing — wait for pointerUp to finalize geometry.
    if (appState.newElement) return;

    const zRef = map.getZoom();
    let dirty = false;

    const next = elements.map((el) => {
      if (el.isDeleted) return el;
      // Already anchored — idempotent skip.
      const existing = (el.customData as { geo?: unknown } | undefined)?.geo;
      if (existing) return el;

      const geoCustomData = buildGeoCustomData(
        el as unknown as ElementGeoFields,
        map,
        zRef,
      );
      if (!geoCustomData) return el;

      dirty = true;
      return {
        ...el,
        customData: { ...(el.customData as object | undefined), ...geoCustomData },
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
    if (!map || !excalidrawAPI) return;
    const handler = buildGeoAnchorHandler(map, excalidrawAPI);
    const unsub = excalidrawAPI.onChange(
      handler as Parameters<ExcalidrawImperativeAPI["onChange"]>[0],
    );
    return unsub;
  }, [map, excalidrawAPI]);
}
