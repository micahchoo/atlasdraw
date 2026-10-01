// SPDX-License-Identifier: AGPL-3.0-only
//
// useCanvasClickThrough — a selection-tool click on empty canvas is a click
// on the map.
//
// Only the hand tool lets the pointer through to MapLibre (classifyTool):
// with the selection tool, Excalidraw takes every press on the plate, so the
// map never sees a "click". This hook listens to Excalidraw's pointer-up
// and, when the press hit no drawing and did not drag, hands the map point
// under the pointer to `onMapClick`. The editor's map-click handler is the
// one receiver, so a click means the same thing with either tool.

import { useEffect, useRef } from "react";

import type {
  AppState,
  ExcalidrawImperativeAPI,
  PointerDownState,
} from "@atlasdraw/excalidraw/types";

import type * as maplibregl from "maplibre-gl";

/** True when a pointer-up ends a plain selection-tool click on no drawing. */
export function isClickOnEmptyCanvas(
  activeTool: Pick<AppState["activeTool"], "type">,
  state: PointerDownState,
): boolean {
  return (
    activeTool.type === "selection" &&
    !state.hit.element &&
    state.hit.allHitElements.length === 0 &&
    !state.hit.hasHitCommonBoundingBoxOfSelectedElements &&
    !state.drag.hasOccurred &&
    !state.boxSelection.hasOccurred
  );
}

export function useCanvasClickThrough(
  api: ExcalidrawImperativeAPI | null,
  map: maplibregl.Map | null,
  onMapClick: (point: maplibregl.Point, lngLat: maplibregl.LngLat) => void,
): void {
  const onMapClickRef = useRef(onMapClick);
  onMapClickRef.current = onMapClick;

  useEffect(() => {
    // The editor tests hand MapEditor a partial API without pointer events;
    // with no pointer-up there is no click to pass through.
    if (!api || !map || typeof api.onPointerUp !== "function") {
      return;
    }
    return api.onPointerUp((activeTool, state, event) => {
      if (!isClickOnEmptyCanvas(activeTool, state)) {
        return;
      }
      const rect = map.getCanvas().getBoundingClientRect();
      const lngLat = map.unproject([
        event.clientX - rect.left,
        event.clientY - rect.top,
      ]);
      onMapClickRef.current(map.project(lngLat), lngLat);
    });
  }, [api, map]);
}
