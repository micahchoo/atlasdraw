/**
 * useCoordinateSync — wires MapLibre camera events to CoordinateSync.syncMapToScene.
 *
 * Flow position: Step 2 of Flow A.
 *   map.on("move"|"zoom"|"rotate"|"pitch") → [throttle 16ms] → sync.syncMapToScene()
 *
 * Null safety: both `map` and `excalidrawAPI` are null until their respective
 * layers mount. This hook early-returns until both are available — no sync
 * calls fire before that.
 *
 * Throttle contract: lodash.throttle at 16ms (one 60fps frame budget).
 * `leading: true, trailing: true` ensures the first event fires immediately
 * and a trailing call fires if events arrived during the throttle window.
 * On cleanup (unmount or dep change), `handler.cancel()` is called before
 * removing listeners — no syncMapToScene calls fire after cleanup.
 *
 * CoordinateSync lifecycle: attach() called at effect start; detach() called
 * on cleanup. Instance memoized — re-created only when (map, api) tuple changes.
 *
 * @see CoordinateSync.ts — constructor({ map, excalidrawAPI }), attach/detach/syncMapToScene
 * @see docs/architecture/subsystems/geo/contracts.md
 */

import { useEffect, useMemo } from "react";
import throttle from "lodash.throttle";
import { CoordinateSync } from "@atlasdraw/geo";
import type { ExcalidrawAPI } from "@atlasdraw/geo";
import type maplibregl from "maplibre-gl";
import type { ExcalidrawImperativeAPI } from "@excalidraw/excalidraw";

/** Camera event types that trigger a re-projection of geo-anchored elements. */
const CAMERA_EVENTS = ["move", "zoom", "rotate", "pitch"] as const;

/**
 * Wires MapLibre camera events to CoordinateSync.syncMapToScene with a 16ms throttle.
 *
 * @param map            - MapLibre Map instance (null until map layer mounts)
 * @param excalidrawAPI  - Excalidraw imperative API (null until Excalidraw mounts)
 */
export function useCoordinateSync(
  map: maplibregl.Map | null,
  excalidrawAPI: ExcalidrawImperativeAPI | null,
): void {
  // Memoize CoordinateSync instance. Re-creates only when (map, api) tuple changes.
  // ExcalidrawImperativeAPI is structurally compatible with geo's ExcalidrawAPI
  // interface (getSceneElements + updateScene with captureUpdate).
  const sync = useMemo(() => {
    if (!map || !excalidrawAPI) return null;
    // Structural cast: ExcalidrawImperativeAPI satisfies the geo ExcalidrawAPI
    // interface. The geo package is intentionally decoupled from @excalidraw.
    return new CoordinateSync({ map, excalidrawAPI: excalidrawAPI as ExcalidrawAPI });
  }, [map, excalidrawAPI]);

  useEffect(() => {
    if (!map || !sync) return;

    // Activate the sync seam (flip _attached; documented lifecycle per contracts.md).
    sync.attach();

    // Build a throttled handler with stable function identity for add/remove symmetry.
    const handler = throttle(() => sync.syncMapToScene(), 16, {
      leading: true,
      trailing: true,
    });

    for (const event of CAMERA_EVENTS) {
      map.on(event, handler);
    }

    return () => {
      // Cancel any pending trailing call before removing listeners.
      handler.cancel();
      for (const event of CAMERA_EVENTS) {
        map.off(event, handler);
      }
      sync.detach();
    };
  }, [map, sync]);
}
