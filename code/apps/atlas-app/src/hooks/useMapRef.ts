/**
 * useMapRef — stable access + reactive availability for a maplibregl.Map.
 *
 * Returns three values:
 *   mapRef      — MutableRefObject: stable identity across renders; use in
 *                 event handlers / imperative code that must not stale-close
 *                 over an old instance.
 *   map         — state copy: triggers a re-render (and therefore re-runs
 *                 dependent hooks like useCoordinateSync) when the Map
 *                 instance first becomes available after mount.
 *   onMapReady  — pass to <MapCanvas onMapReady={onMapReady}>; called once
 *                 after the map's "load" event fires.
 *
 * Consumed by:
 *   MapEditor   (Task 11) — passes onMapReady to <MapCanvas>
 *   useCoordinateSync (Task 12) — reads `map` as a reactive dep
 */

import { useRef, useState, useCallback } from "react";

import type maplibregl from "maplibre-gl";

export interface UseMapRefReturn {
  mapRef: React.MutableRefObject<maplibregl.Map | null>;
  map: maplibregl.Map | null;
  onMapReady: (m: maplibregl.Map) => void;
}

export function useMapRef(): UseMapRefReturn {
  const mapRef = useRef<maplibregl.Map | null>(null);
  const [map, setMap] = useState<maplibregl.Map | null>(null);

  const onMapReady = useCallback((m: maplibregl.Map) => {
    mapRef.current = m;
    setMap(m);
  }, []);

  return { mapRef, map, onMapReady };
}
