/**
 * useGeoAnchor — auto-stamps `customData.geo` on bbox-shaped Excalidraw elements
 * created by stock tools (rectangle, ellipse, diamond).
 *
 * Resolves atlasdraw-9152 option (a): only bbox-shaped tools auto-anchor with
 * scaleMode:"geographic". Arrow / freedraw / line / text deferred to post-Task-8
 * (atlasdraw-375a) when scaleMode:"hybrid" projection lands.
 *
 * Lifecycle: subscribes via `excalidrawAPI.onChange`. While `appState.newElement`
 * is non-null, the element is mid-drag — we skip stamping so the final bbox is
 * captured (not the first-frame click point). After pointerUp, `newElement`
 * clears and the element appears in the elements array; we then stamp once.
 *
 * Idempotency: an element with `customData.geo` already set is skipped. The
 * stamp itself triggers another onChange, but that pass finds geo set → no loop.
 *
 * @see atlasdraw-9152 — scope decision (bbox tools only, geographic scaleMode)
 * @see useCoordinateSync — sister hook (camera → element projection)
 */

import { useEffect } from "react";
import { unprojectPoint } from "@atlasdraw/geo";
import type { GeoCustomData } from "@atlasdraw/geo";
import type maplibregl from "maplibre-gl";
import type { ExcalidrawImperativeAPI } from "@excalidraw/excalidraw";

/** Tools whose elements are auto-anchored on creation (Phase 1 scope). */
const BBOX_TOOL_TYPES = new Set(["rectangle", "ellipse", "diamond"]);

/**
 * Subscribe to Excalidraw scene changes and stamp `customData.geo` on new bbox
 * elements using map.unproject against their bbox corners.
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

    const unsub = excalidrawAPI.onChange((elements, appState) => {
      // Skip while user is actively drawing — wait for pointerUp to finalize bbox.
      if (appState.newElement) return;

      const zRef = map.getZoom();
      let dirty = false;

      const next = elements.map((el) => {
        if (el.isDeleted) return el;
        if (!BBOX_TOOL_TYPES.has(el.type)) return el;
        // Already anchored — idempotent skip.
        const existing = (el.customData as { geo?: unknown } | undefined)?.geo;
        if (existing) return el;

        const nw = unprojectPoint(map, el.x, el.y);
        const se = unprojectPoint(map, el.x + el.width, el.y + el.height);

        const geoCustomData: GeoCustomData = {
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

        dirty = true;
        return {
          ...el,
          customData: { ...el.customData, ...geoCustomData },
        };
      });

      if (dirty) {
        excalidrawAPI.updateScene({ elements: next });
      }
    });

    return unsub;
  }, [map, excalidrawAPI]);
}
