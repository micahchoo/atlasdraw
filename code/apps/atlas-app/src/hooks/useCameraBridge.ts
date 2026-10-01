// SPDX-License-Identifier: AGPL-3.0-only
//
// The map owns the camera
// (docs/architecture/adr/0015-world-coordinates-gate.md). This hook connects it
// to Excalidraw:
//
//   - a CameraBridge writes Excalidraw's scrollX / scrollY / zoom from every
//     map `move`, and sends Excalidraw's own viewport changes (space-drag,
//     scroll to content) back to the map. No camera move writes an element.
//   - the bearing turns the drawing layer's canvases with CSS about the map's
//     centre. Display only: drawing is blocked while the camera is turned, so
//     no pointer input has to be turned back.
//   - Excalidraw's zoom actions (keys, zoom-to-fit) go to the map, because
//     Excalidraw's zoom steps and clamp do not fit a map zoom.
//
// The bridge reads the open document's world frame on every exchange, so a
// document opened while the map is mounted uses its own frame at once.

import { useCallback, useEffect, useState } from "react";

import { CameraBridge } from "@atlasdraw/basemap";

import type { ExcalidrawImperativeAPI } from "@atlasdraw/excalidraw";
import type {
  NormalizedZoomValue,
  ZoomAction,
} from "@atlasdraw/excalidraw/types";

import { currentDocument, useDocumentStore } from "../state/document";
import { fitMapToContent } from "../lib/fitMapToContent";

import type maplibregl from "maplibre-gl";

const frame = () => currentDocument().snapshot().world;

type FitElements = Extract<ZoomAction, { type: "zoomToFit" }>["elements"];

/**
 * Do an Excalidraw zoom action on the map. Returns true: the map owns the
 * camera, so the editor's own zoom never runs.
 *
 * "Reset zoom" (Ctrl+0) is Excalidraw's 100%, the reference zoom 22, which is
 * not a useful map view. A map has no 100%, so it frames everything drawn
 * (`drawn`), as zoom-to-fit does; with nothing drawn the camera stays.
 */
export function zoomActionOnMap(
  map: Pick<maplibregl.Map, "zoomIn" | "zoomOut" | "fitBounds">,
  action: ZoomAction,
  drawn: () => FitElements = () => [],
): boolean {
  switch (action.type) {
    case "zoomIn":
      map.zoomIn();
      break;
    case "zoomOut":
      map.zoomOut();
      break;
    case "zoomToFit":
      fitMapToContent(map, action.elements, frame());
      break;
    case "resetZoom":
      fitMapToContent(map, drawn(), frame());
      break;
  }
  return true;
}

export interface CameraWiring {
  bridge: CameraBridge | null;
  /** For Excalidraw's `onZoomAction` prop. */
  onZoomAction: (action: ZoomAction) => boolean;
}

/**
 * @param layer - the element holding Excalidraw; its canvases are turned.
 */
export function useCameraBridge(
  map: maplibregl.Map | null,
  excalidrawAPI: ExcalidrawImperativeAPI | null,
  layer: HTMLElement | null,
): CameraWiring {
  const [bridge, setBridge] = useState<CameraBridge | null>(null);

  useEffect(() => {
    if (!map || !excalidrawAPI) {
      return;
    }
    const container = map.getContainer();
    // Read once and on `resize`: clientWidth in a `move` handler forces a
    // synchronous layout every frame.
    let size = { width: container.clientWidth, height: container.clientHeight };
    const b = new CameraBridge({
      map,
      scene: {
        // The bridge's zoom is exact and unclamped on purpose: `updateScene`
        // stores it as given, so the brand is only a type.
        updateScene: ({ appState }) =>
          excalidrawAPI.updateScene({
            appState: {
              ...appState,
              zoom: { value: appState.zoom.value as NormalizedZoomValue },
            },
          }),
      },
      frame,
      viewportSize: () => size,
    });
    // Attach only once Excalidraw has applied its initial data: that write
    // sets zoom 1 and scroll 0, and the bridge would read it as the user's
    // own viewport change and send the map to zoom 22. The event replays,
    // so an editor already initialized attaches at once.
    let offInit: (() => void) | undefined;
    if (typeof excalidrawAPI.onEvent === "function") {
      offInit = excalidrawAPI.onEvent("editor:initialize", () => b.attach());
    } else {
      b.attach();
    }
    // MapLibre's resize() fires `move` before `resize`, so the `move` pushes
    // the old size and this pushes the new one.
    const onResize = () => {
      size = { width: container.clientWidth, height: container.clientHeight };
      b.push();
    };
    map.on("resize", onResize);
    // Another document may open with the camera where it is: no `move`
    // follows, but the frame changed.
    const unsubscribe = useDocumentStore.subscribe((s, prev) => {
      if (s.doc !== prev.doc) {
        b.push();
      }
    });
    setBridge(b);
    return () => {
      offInit?.();
      unsubscribe();
      map.off("resize", onResize);
      b.detach();
      setBridge(null);
    };
  }, [map, excalidrawAPI]);

  // Bearing → CSS rotation of the canvases about the map centre. Imperative,
  // on the map's own `rotate`, so the drawing turns in the frame the map does.
  useEffect(() => {
    if (!map || !layer) {
      return;
    }
    const container = map.getContainer();
    let last = "";
    const turn = () => {
      const rotate = `${-map.getBearing()}deg`;
      const origin = `${container.clientWidth / 2}px ${
        container.clientHeight / 2
      }px`;
      if (`${rotate} ${origin}` === last) {
        return;
      }
      last = `${rotate} ${origin}`;
      layer.style.setProperty("--world-rotate", rotate);
      layer.style.setProperty("--world-origin", origin);
    };
    turn();
    map.on("rotate", turn);
    map.on("resize", turn);
    return () => {
      map.off("rotate", turn);
      map.off("resize", turn);
    };
  }, [map, layer]);

  const onZoomAction = useCallback(
    (action: ZoomAction) =>
      map
        ? zoomActionOnMap(
            map,
            action,
            () => excalidrawAPI?.getSceneElements() ?? [],
          )
        : false,
    [map, excalidrawAPI],
  );

  return { bridge, onZoomAction };
}
