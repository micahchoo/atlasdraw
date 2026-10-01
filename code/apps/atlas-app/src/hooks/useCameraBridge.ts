// SPDX-License-Identifier: AGPL-3.0-only
//
// ADR-0015 spike — wires the CameraBridge into the editor behind the
// world-coordinates flag. Replaces, when the flag is on: the scroll lock
// (useExcalidrawChangeHandler step 2), the post-load drift check (step 3),
// useCoordinateSync and useGeoAnchor.
//
// Bearing is display only: the drawing layer's canvases are turned with CSS
// about the map's centre. Drawing stays blocked while the camera is turned
// (RT-9), so no pointer input has to be un-rotated.

import { useEffect, useState } from "react";

import { CameraBridge } from "@atlasdraw/basemap";
import { frameAt } from "@atlasdraw/geo";

import type { ExcalidrawImperativeAPI } from "@atlasdraw/excalidraw";
import type { NormalizedZoomValue } from "@atlasdraw/excalidraw/types";
import type { WorldFrame } from "@atlasdraw/geo";

import type maplibregl from "maplibre-gl";

/** The flag: `VITE_WORLD_COORDS=1` at build time, or `?world=1` at run time. */
export function isWorldCoordsEnabled(): boolean {
  if (import.meta.env.VITE_WORLD_COORDS === "1") {
    return true;
  }
  try {
    return new URLSearchParams(window.location.search).get("world") === "1";
  } catch {
    return false;
  }
}

/**
 * The document's frame. A spike stand-in: production stores z0 and origin in
 * the manifest. Here the first camera the editor sees decides it.
 */
function frameForCamera(map: maplibregl.Map): WorldFrame {
  const c = map.getCenter();
  // `?z0=N` pins the reference zoom (criterion 5 measures 4, 12 and 22).
  const pinned = Number(
    new URLSearchParams(window.location.search).get("z0") ?? NaN,
  );
  return frameAt(
    c.lng,
    c.lat,
    Number.isFinite(pinned) ? pinned : map.getZoom(),
  );
}

/**
 * @param layer - the element holding Excalidraw; its canvases are turned.
 */
export function useCameraBridge(
  enabled: boolean,
  map: maplibregl.Map | null,
  excalidrawAPI: ExcalidrawImperativeAPI | null,
  layer: HTMLElement | null,
): CameraBridge | null {
  const [bridge, setBridge] = useState<CameraBridge | null>(null);

  useEffect(() => {
    if (!enabled || !map || !excalidrawAPI) {
      return;
    }
    const container = map.getContainer();
    // Read once and on `resize`: clientWidth in a `move` handler forces a
    // synchronous layout every frame (measured: 37 ms per 150 frames).
    let size = { width: container.clientWidth, height: container.clientHeight };
    const b = new CameraBridge({
      map,
      scene: {
        // The bridge's zoom is exact and unclamped on purpose (criterion 5):
        // `updateScene` stores it as given, so the brand is only a type.
        updateScene: ({ appState }) =>
          excalidrawAPI.updateScene({
            appState: {
              ...appState,
              zoom: { value: appState.zoom.value as NormalizedZoomValue },
            },
          }),
      },
      frame: frameForCamera(map),
      viewportSize: () => size,
    });
    b.attach();
    // MapLibre's resize() fires `move` before `resize`, so the `move` pushes
    // the old size and this pushes the new one.
    const onResize = () => {
      size = { width: container.clientWidth, height: container.clientHeight };
      b.push();
    };
    map.on("resize", onResize);
    setBridge(b);
    return () => {
      map.off("resize", onResize);
      b.detach();
      setBridge(null);
    };
  }, [enabled, map, excalidrawAPI]);

  // Bearing → CSS rotation of the canvases about the map centre. Imperative,
  // on the map's own `rotate`, so the drawing turns in the frame the map does.
  useEffect(() => {
    if (!enabled || !map || !layer) {
      return;
    }
    const container = map.getContainer();
    let last = "";
    const turn = () => {
      const bearing = map.getBearing();
      const next = `${-bearing}`;
      if (next === last) {
        return;
      }
      last = next;
      layer.style.setProperty("--world-rotate", `${-bearing}deg`);
      layer.style.setProperty(
        "--world-origin",
        `${container.clientWidth / 2}px ${container.clientHeight / 2}px`,
      );
    };
    turn();
    map.on("rotate", turn);
    map.on("resize", turn);
    return () => {
      map.off("rotate", turn);
      map.off("resize", turn);
    };
  }, [enabled, map, layer]);

  return bridge;
}
