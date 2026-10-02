// SPDX-License-Identifier: AGPL-3.0-only
//
// useFeaturePopup — the attribute popup's state for one map.
//
// The popup is anchored at the lng/lat of the click, not at a screen point:
// the camera can move while it is open, and the popup moves with the place
// it describes. `show` and `close` are stable, so a map "click" handler can
// hold them.
//
// usePopupOnClick — a map click opens the popup for the pin under the
// pointer, else for the topmost data layer, and closes it on empty map. A
// pin is drawn above every layer, so it wins. The editor does not use it:
// its own click handler also selects the layer, and calls show/close, and a
// pin's details are edited there (PinDetailsDialog). The viewer and embed
// use it, and turn it off for a locked embed (?lock=1).

import { useCallback, useEffect, useState } from "react";

import {
  featureAt,
  type FeatureHit,
  type QueryTarget,
} from "../lib/featureHit";
import { currentDocument } from "../state/document";

import type { PinDetails } from "../state/pinDetails";

/** How many rows the popup shows before "Show all". */
export const POPUP_ROWS = 8;

type LngLat = { lng: number; lat: number };

type MapEventListener = (event: never) => void;

/** The part of a MapLibre map the popup reads. */
export interface PopupMap extends QueryTarget {
  project(lngLat: [number, number]): { x: number; y: number };
  on(type: "move" | "click", listener: MapEventListener): unknown;
  off(type: "move" | "click", listener: MapEventListener): unknown;
}

/** A pin a click opened: its details and its photo's data URL. */
export interface PinHit {
  kind: "pin";
  id: string;
  details: PinDetails;
  /** A `data:image/…` URL of the drawing's own file, or null. */
  photoUrl: string | null;
}

/** An open popup: what it shows, and where on screen its anchor is now. */
export interface OpenPopup {
  hit: FeatureHit | PinHit;
  lngLat: LngLat;
  x: number;
  y: number;
}

export interface FeaturePopupControl {
  popup: OpenPopup | null;
  show(hit: FeatureHit | PinHit, lngLat: LngLat): void;
  close(): void;
}

export function useFeaturePopup(map: PopupMap | null): FeaturePopupControl {
  const [popup, setPopup] = useState<OpenPopup | null>(null);

  const show = useCallback(
    (hit: FeatureHit | PinHit, lngLat: LngLat) => {
      if (!map) {
        return;
      }
      const { x, y } = map.project([lngLat.lng, lngLat.lat]);
      setPopup({ hit, lngLat, x, y });
    },
    [map],
  );
  const close = useCallback(() => setPopup(null), []);

  const open = popup !== null;
  useEffect(() => {
    if (!map || !open) {
      return;
    }
    const onMove = () =>
      setPopup((p) => {
        if (!p) {
          return p;
        }
        const { x, y } = map.project([p.lngLat.lng, p.lngLat.lat]);
        return x === p.x && y === p.y ? p : { ...p, x, y };
      });
    map.on("move", onMove);
    return () => {
      map.off("move", onMove);
    };
  }, [map, open]);

  // Another map, or a map that went away: nothing to anchor to.
  useEffect(() => close, [map, close]);

  return { popup, show, close };
}

export function usePopupOnClick(
  map: PopupMap | null,
  enabled: boolean,
  { show, close }: Pick<FeaturePopupControl, "show" | "close">,
  /** The pin at a place, or null. Absent: the map shows no pins. */
  pinAt?: (lngLat: LngLat) => PinHit | null,
): void {
  useEffect(() => {
    if (!map || !enabled) {
      return;
    }
    const onClick = (e: {
      point: { x: number; y: number };
      lngLat: LngLat;
    }) => {
      const pin = pinAt?.(e.lngLat);
      if (pin) {
        show(pin, e.lngLat);
        return;
      }
      const hit = featureAt(
        map,
        currentDocument().snapshot().overlays,
        e.point,
      );
      if (hit) {
        show(hit, e.lngLat);
      } else {
        close();
      }
    };
    map.on("click", onClick as MapEventListener);
    return () => {
      map.off("click", onClick as MapEventListener);
    };
  }, [map, enabled, show, close, pinAt]);
}
