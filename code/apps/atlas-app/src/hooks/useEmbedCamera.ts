// SPDX-License-Identifier: AGPL-3.0-only
//
// useEmbedCamera — how the viewer's camera behaves inside another page.
//
// - Locked (lock=1): every gesture is off. The page scrolls through the map.
// - Unlocked: MapLibre's cooperative gestures. The wheel zooms only with Ctrl
//   (⌘ on a Mac) and one finger does not pan on a touch screen, so a reader
//   who scrolls the article past the map keeps scrolling the article. The map
//   says how to move it when a gesture is held back.
// - view=fit with content: the camera fits the content at once on load, and
//   again each time the frame changes size, until the reader moves the map.
//   A move with an input event is the reader's; the fit's own move has none.
//
// The option meanings and the view decision are in lib/embed.ts.

import { useEffect } from "react";

import { disableCameraRotation } from "@atlasdraw/basemap";

import type { LngLatBox } from "@atlasdraw/geo";

import { fitMapToBox } from "../lib/fitMapToContent";

import type { EmbedOptions } from "../lib/embed";
import type * as maplibregl from "maplibre-gl";

/** The parts of the map this hook uses. */
export type EmbedMap = Pick<
  maplibregl.Map,
  | "dragPan"
  | "scrollZoom"
  | "boxZoom"
  | "dragRotate"
  | "keyboard"
  | "doubleClickZoom"
  | "touchZoomRotate"
  | "cooperativeGestures"
  | "fitBounds"
  | "on"
  | "off"
>;

export function useEmbedCamera(
  map: EmbedMap | null,
  options: EmbedOptions,
  box: LngLatBox | null,
): void {
  const { lock, view } = options;

  // Gestures: all off when locked; cooperative when not.
  useEffect(() => {
    if (!map) {
      return;
    }
    if (!lock) {
      map.cooperativeGestures.enable();
      return () => map.cooperativeGestures.disable();
    }
    const handlers = [
      map.dragPan,
      map.scrollZoom,
      map.boxZoom,
      map.dragRotate,
      map.keyboard,
      map.doubleClickZoom,
      map.touchZoomRotate,
    ];
    for (const h of handlers) {
      h?.disable?.();
    }
    return () => {
      for (const h of handlers) {
        h?.enable?.();
      }
      // The blanket enable above would bring back the rotation gestures
      // MapCanvas turned off at mount (the embed has no compass).
      disableCameraRotation(map as maplibregl.Map);
    };
  }, [map, lock]);

  // The fit, on load and on each resize until the reader moves the map.
  useEffect(() => {
    if (!map || view !== "fit" || !box) {
      return;
    }
    let readerMoved = false;
    const fit = () => {
      if (!readerMoved) {
        fitMapToBox(map, box, { animate: false });
      }
    };
    const onMoveStart = (e: { originalEvent?: unknown }) => {
      if (e.originalEvent) {
        readerMoved = true;
      }
    };
    fit();
    map.on("resize", fit);
    map.on("movestart", onMoveStart);
    return () => {
      map.off("resize", fit);
      map.off("movestart", onMoveStart);
    };
  }, [map, view, box]);
}
