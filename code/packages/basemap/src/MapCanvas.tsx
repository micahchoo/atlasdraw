/**
 * MapCanvas — a React shell around a `maplibregl.Map` instance. Creates the
 * map on mount, tears it down on unmount, and calls `onMapReady` once the
 * map's `load` event fires.
 *
 * It holds no basemap catalog, no PMTiles protocol and no style switching;
 * the caller does those (atlas-app's useBasemapStyle).
 *
 * Default style: an empty in-memory MapLibre style (transparent canvas, no
 * tile fetch). Callers set a real style with setStyle() or the `styleUrl`
 * prop. A default that fetches tiles sends a request before the caller's
 * style replaces it, and fails offline.
 *
 * Constraints set at construction:
 *   maxPitch: 0          — the drawing is a flat world map; at pitch 0 it is a
 *                          2D transform of the map
 *                          (docs/architecture/adr/0015-world-coordinates-gate.md)
 *   pitchWithRotate: false
 *   dragRotate: false    — right-drag belongs to Excalidraw's context
 *                          menu, and stays off even when `allowRotation` is
 *                          set. See cameraRotation.ts for the other two.
 */

import React, { useEffect, useRef } from "react";
import maplibregl from "maplibre-gl";

import { applyRotationPolicy } from "./cameraRotation";

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
   * Defaults to an empty offline style (no tile fetch). Atlas-app supplies
   * the real style with setStyle() after mount (see useBasemapStyle.ts).
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

  /**
   * Hide MapLibre's floating attribution control. Only set this when the
   * hosting view prints attribution itself (e.g. the editor's Collar
   * marginalia) — attribution must stay visible somewhere.
   */
  hideAttribution?: boolean;

  /**
   * Let the user rotate the camera (two-finger twist, shift+arrows). Off by
   * default, and the default is the safe one: a view earns rotation by
   * shipping a compass, so that a user always has a way back to north. The
   * editor does; the embed and every other MapCanvas
   * caller does not. Mount-time only, like `initialView`.
   */
  allowRotation?: boolean;
}

// ---------------------------------------------------------------------------
// Defaults
// ---------------------------------------------------------------------------

// Empty offline style — no network fetch, no opaque background. Atlas-app's
// useBasemapStyle replaces it with the active basemap style after mount. The
// background must be transparent: an opaque placeholder shows through behind
// the real style during map.setStyle's transition.
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
  hideAttribution,
  allowRotation = false,
}) => {
  const containerRef = useRef<HTMLDivElement>(null);
  // Hold the map instance for the unmount cleanup; not exposed via state to
  // avoid triggering re-renders.
  const mapRef = useRef<maplibregl.Map | null>(null);

  useEffect(() => {
    if (!containerRef.current) {
      return;
    }

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
      // A 2D top-down view: the drawing layer follows the map with a scroll,
      // a zoom and a rotation, and has no perspective
      // (docs/architecture/adr/0015-world-coordinates-gate.md).
      maxPitch: 0,
      pitchWithRotate: false,
      // Right-drag rotation stays off. applyRotationPolicy below handles the
      // other two rotation gestures — they have no construction option that
      // spares pinch-zoom and arrow-key panning.
      dragRotate: false,
      // No preserveDrawingBuffer: export renders its own offscreen map
      // (apps/atlas-app/src/lib/export.ts), so the live map need not keep
      // every frame's buffer.
      // Prevent horizontal world tiling at low zoom — a single world copy
      // avoids the disorienting 1.5x repetition at zoom 0.
      renderWorldCopies: false,
      // Collar shell: the editor prints attribution in its marginalia bar;
      // other views keep MapLibre's floating control. Mount-time only (like
      // initialView — changes after mount are ignored).
      ...(hideAttribution ? { attributionControl: false as const } : {}),
    });

    mapRef.current = map;

    applyRotationPolicy(map, allowRotation);

    if (onMapReady) {
      map.once("load", () => {
        onMapReady(map);
      });
    }

    // Keep the WebGL canvas sized to the container. With an
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
    // Intentionally excluding `initialView`, `onMapReady` and `allowRotation`
    // — initialView and allowRotation are consumed once at construction;
    // onMapReady is a stable callback contract.
    // A styleUrl change after mount is ignored; callers use setStyle().
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
