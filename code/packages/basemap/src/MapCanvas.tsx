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
 * Default styleUrl: OpenFreeMap "liberty" style — public, no API key required.
 * Swap to any MapLibre-compatible style URL via the `styleUrl` prop.
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
   * MapLibre-compatible style URL.
   * Defaults to OpenFreeMap "liberty" — public, no API key needed.
   * Swap for any PMTiles or vector tile style URL as needed.
   */
  styleUrl?: string;

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

const DEFAULT_STYLE_URL =
  // OpenFreeMap liberty — free, public, no API key required.
  // See https://openfreemap.org/
  "https://tiles.openfreemap.org/styles/liberty";

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
  styleUrl = DEFAULT_STYLE_URL,
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
    });

    mapRef.current = map;

    if (onMapReady) {
      map.once("load", () => {
        onMapReady(map);
      });
    }

    return () => {
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
