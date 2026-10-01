// SPDX-License-Identifier: AGPL-3.0-only
//
// A click on the map selects the layer under it: the topmost visible data
// layer (and its feature's attributes open in a popup), else the topmost
// visible raster, else nothing. The hand tool lets a click through to
// MapLibre; with the selection tool the drawing takes the press, and a click
// on empty canvas reaches the same handler (useCanvasClickThrough). A
// drawing tool's click draws and selects nothing.

import { useCallback, useEffect } from "react";

import type { ExcalidrawImperativeAPI } from "@atlasdraw/excalidraw";

import { featureAt } from "../lib/featureHit";

import { useCanvasClickThrough } from "./useCanvasClickThrough";
import { useFeaturePopup, type PopupMap } from "./useFeaturePopup";

import type { EditorSession } from "../session/EditorSession";
import type { RasterLayerEntry } from "../state/document";
import type maplibregl from "maplibre-gl";

/** Ray casting, on projected (screen) points. */
export function pointInPolygon(
  point: { x: number; y: number },
  polygon: { x: number; y: number }[],
): boolean {
  let inside = false;
  for (let i = 0, j = polygon.length - 1; i < polygon.length; j = i++) {
    const { x: xi, y: yi } = polygon[i];
    const { x: xj, y: yj } = polygon[j];
    const iAbove = yi > point.y;
    const jAbove = yj > point.y;
    if (
      iAbove !== jAbove &&
      point.x < ((xj - xi) * (point.y - yi)) / (yj - yi) + xi
    ) {
      inside = !inside;
    }
  }
  return inside;
}

export function useMapSelect(
  session: EditorSession,
  map: maplibregl.Map | null,
  api: ExcalidrawImperativeAPI | null,
) {
  const popup = useFeaturePopup(map as unknown as PopupMap | null);
  const { show, close } = popup;

  const onMapClick = useCallback(
    (point: maplibregl.Point, lngLat: maplibregl.LngLat) => {
      if (!map) {
        return;
      }
      const view = session.view.getState();
      const overlays = session.store.getState().doc.snapshot().overlays;
      const hit = featureAt(map, overlays, point);
      if (hit) {
        view.select(hit.overlayId);
        show(hit, lngLat);
        return;
      }
      close();
      const rasters = overlays
        .filter((e): e is RasterLayerEntry => e.kind === "raster" && e.visible)
        .sort((a, b) => b.order - a.order);
      for (const r of rasters) {
        if (
          pointInPolygon(
            point,
            r.corners.map((c) => map.project(c)),
          )
        ) {
          view.select(r.id);
          return;
        }
      }
      view.clearSelection();
    },
    [session, map, show, close],
  );

  useEffect(() => {
    if (!map) {
      return;
    }
    const handler = (e: maplibregl.MapMouseEvent) => {
      const tool = api?.getAppState()?.activeTool?.type;
      if (tool && tool !== "selection" && tool !== "hand") {
        return;
      }
      onMapClick(e.point, e.lngLat);
    };
    map.on("click", handler);
    return () => {
      map.off("click", handler);
    };
  }, [map, api, onMapClick]);
  useCanvasClickThrough(api, map, onMapClick);

  return popup;
}
