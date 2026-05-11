/**
 * MapCanvas — Phase 1 skeleton.
 *
 * React shell around a `maplibregl.Map` instance. Creates the map on mount,
 * tears it down on unmount, and calls `onMapReady` once the map's `load`
 * event fires.
 *
 * Deliberately minimal: no basemap registry, no PMTiles protocol, no style
 * switching logic. Those land in later waves.
 *
 * Default style: an empty in-memory MapLibre style (transparent canvas, no
 * tile fetch). Callers wire a real style via setStyle() or by passing the
 * `styleUrl` prop. The previous Phase 1 default fetched OpenFreeMap "liberty"
 * on every mount, which (a) caused a spurious network request before the
 * Phase 4 T6/T7 picker effect overrode it, and (b) couldn't run offline.
 * (atlasdraw-7899, 2026-05-10).
 *
 * Phase 1 constraints enforced at construction:
 *   maxPitch: 0          — pitch=0 assumption keeps CoordinateSync projection-agnostic (OQ-2)
 *   pitchWithRotate: false
 */

import React, { useEffect, useRef } from "react";
import maplibregl from "maplibre-gl";

// ---------------------------------------------------------------------------
// Types
// ---------------------------------------------------------------------------

export interface MapCanvasInitialView {
  /** [longitude, latitude] */
  center: [number, number];
  zoom: number;
}

export interface MapCanvasProps {
  /**
   * MapLibre-compatible style URL or inline StyleSpecification.
   * Defaults to an empty offline style (no tile fetch). Phase 4 callers
   * supply the real style via setStyle() after mount (see MapEditor.tsx).
   */
  styleUrl?: string | maplibregl.StyleSpecification;

  /** Initial viewport; changes after mount are ignored (map controls its own state). */
  initialView?: MapCanvasInitialView;

  /**
   * Called once after the map's `load` event fires.
   * The `Map` instance is stable from this point until unmount.
   */
  onMapReady?: (map: maplibregl.Map) => void;

  /** Applied to the container div. Use for sizing (width/height). */
  className?: string;
}

// ---------------------------------------------------------------------------
// Defaults
// ---------------------------------------------------------------------------

// Empty offline style — no network fetch, no opaque background. Atlas-app's
// basemap-effect (Phase 4 T6/T7) replaces this with the active basemap style
// after mount. A `#f0f0f0` placeholder bled through behind the real style on
// the 2026-05-10 smoke test; using `rgba(0,0,0,0)` keeps the WebGL canvas
// clear so map.setStyle's transition has no leftover paint to fight.
const DEFAULT_STYLE: maplibregl.StyleSpecification = {
  version: 8,
  name: "atlasdraw-empty",
  sources: {},
  layers: [
    {
      id: "background",
      type: "background",
      paint: { "background-color": "rgba(0,0,0,0)" },
    },
  ],
};

const DEFAULT_CENTER: [number, number] = [0, 20];
const DEFAULT_ZOOM = 2;

// ---------------------------------------------------------------------------
// Component
// ---------------------------------------------------------------------------

/**
 * MapCanvas renders a full-size MapLibre GL canvas.
 * It fills its container — apply width/height on the container or via `className`.
 */
export const MapCanvas: React.FC<MapCanvasProps> = ({
  styleUrl = DEFAULT_STYLE,
  initialView,
  onMapReady,
  className,
}) => {
  const containerRef = useRef<HTMLDivElement>(null);
  // Hold the map instance for the unmount cleanup; not exposed via state to
  // avoid triggering re-renders.
  const mapRef = useRef<maplibregl.Map | null>(null);

  useEffect(() => {
    if (!containerRef.current) return;

    // Guard against React StrictMode double-mount. If a map was already
    // created (from the first mount in dev), remove it before re-creating.
    if (mapRef.current) {
      mapRef.current.remove();
      mapRef.current = null;
    }

    const map = new maplibregl.Map({
      container: containerRef.current,
      style: styleUrl,
      center: initialView?.center ?? DEFAULT_CENTER,
      zoom: initialView?.zoom ?? DEFAULT_ZOOM,
      // Phase 1 constraint: lock to 2D top-down view so CoordinateSync
      // can use simple Mercator math without perspective correction (OQ-2).
      maxPitch: 0,
      pitchWithRotate: false,
      // T15: required so map canvas can be sampled via drawImage in PNG
      // export. Without this WebGL clears the drawing buffer between frames
      // and the export reads a blank layer.
      preserveDrawingBuffer: true,
    });

    mapRef.current = map;

    if (onMapReady) {
      map.once("load", () => {
        onMapReady(map);
      });
    }

    // 2026-05-10 — keep the WebGL canvas sized to the container. With an
    // inline `style` arg, the map's "load" fires synchronously enough that
    // MapLibre measures the container BEFORE the surrounding flex/grid layout
    // has settled. Without this, the canvas is locked at the initial measured
    // size — producing a small rectangle in the upper-left corner regardless
    // of viewport. ResizeObserver keeps it in sync if the parent resizes too.
    requestAnimationFrame(() => map.resize());
    const ro = new ResizeObserver(() => map.resize());
    ro.observe(containerRef.current);

    return () => {
      ro.disconnect();
      map.remove();
      mapRef.current = null;
    };
    // Intentionally excluding `initialView` and `onMapReady` — initialView is
    // consumed once at construction; onMapReady is a stable callback contract.
    // styleUrl changes are NOT reacted to in Phase 1 (deferred to Wave 2+).
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);

  return (
    <div
      ref={containerRef}
      className={className}
      style={{ width: "100%", height: "100%" }}
    />
  );
};

export default MapCanvas;
