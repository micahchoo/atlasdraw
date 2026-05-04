/**
 * useMapWheelRouter — route wheel events to the map regardless of which layer
 * is on top.
 *
 * Background (atlasdraw-5afc): in drawing mode (selection/rectangle/etc.) the
 * Excalidraw layer is `pointer-events: auto` to capture pointer drags. That
 * also captures wheel events — MapLibre's scrollZoom listener never sees them
 * and the user's scroll-to-zoom appears to do nothing, leaving annotations
 * apparently detached from their geographic anchor on zoom attempts.
 *
 * In atlasdraw, wheel = map zoom is the universal semantic (Excalidraw's
 * internal canvas zoom is irrelevant since the canvas is locked to the map
 * via CoordinateSync). This hook installs a capture-phase wheel listener on
 * the supplied container that intercepts wheel events and forwards them to
 * `map.easeTo` with the canonical scrollZoom delta math.
 *
 * Why `map.easeTo` and not synthetic `WheelEvent` dispatch on `map.getCanvas()`:
 *   - cross-browser variance (Safari is finicky with WheelEvent constructor)
 *   - MapLibre internals can check `event.isTrusted` (synthetic = false)
 *   - listener-order races with our own preventDefault
 * Calling the map API directly is what scrollZoom does internally anyway.
 *
 * Modifier semantics:
 *   - ctrl/meta+wheel: pass through (browser pinch-zoom; standard expectation).
 *   - shift+wheel: intercepted as map zoom (Excalidraw uses it for horizontal
 *     pan internally, but in atlasdraw the page doesn't scroll horizontally
 *     and shift-wheel-zoom is harmless if surprising — revisit in Phase 4 if
 *     a stylus/keyboard combo proves disruptive).
 *
 * Touch pinch-zoom on tablet hits the same Excalidraw-captures-pointer issue
 * but goes through pointer events, not wheel — out of scope for this hook.
 * Tracked separately when Phase 4 mobile/touch matrix lands.
 *
 * @see useCoordinateSync.ts — the camera-event listener whose "zoom" handler
 *   completes the loop after this hook routes the wheel.
 */

import { useEffect } from "react";
import type maplibregl from "maplibre-gl";

/** Canonical scrollZoom math: matches MapLibre's internal wheel-handler at
 *  default speed (`scrollZoom` enabled with default options). */
const ZOOM_SCALE = 0.0035;
const LINE_HEIGHT_PX = 25; // when deltaMode === DOM_DELTA_LINE

export function useMapWheelRouter(
  container: HTMLElement | null,
  map: maplibregl.Map | null,
): void {
  useEffect(() => {
    if (!container || !map) return;

    const handleWheel = (e: WheelEvent) => {
      // Browser pinch-zoom (ctrl on Windows/Linux, meta on macOS) — let it through.
      if (e.ctrlKey || e.metaKey) return;

      e.preventDefault();
      e.stopPropagation();
      e.stopImmediatePropagation();

      const deltaY = e.deltaY * (e.deltaMode === 1 ? LINE_HEIGHT_PX : 1);
      const zoomDelta = -deltaY * ZOOM_SCALE;
      const rect = map.getCanvas().getBoundingClientRect();
      const around = map.unproject([e.clientX - rect.left, e.clientY - rect.top]);
      map.easeTo({
        zoom: map.getZoom() + zoomDelta,
        around,
        duration: 0,
      });
    };

    container.addEventListener("wheel", handleWheel, {
      capture: true,
      passive: false,
    });
    return () => {
      container.removeEventListener("wheel", handleWheel, { capture: true });
    };
  }, [container, map]);
}
