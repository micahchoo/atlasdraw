// SPDX-License-Identifier: AGPL-3.0-only
//
// useMapOverlays — draw the open document's overlays on a map.
//
// The document is the input; lib/mapOverlays is the only writer. This hook
// builds the spec from the open document, hands it to the map's reconciler, and publishes what landed for the layer
// panel. It applies again:
//   - after every document change and when another document opens;
//   - on every "styledata", so a new basemap style, which drops every custom
//     layer, gets the overlays back. The reconciler is level-triggered, so an
//     apply with nothing to change writes nothing.
//
// Labels need the basemap's glyphs. Each apply reads a label font from the
// map (labelFontOf) and publishes it: null tells the style panel that this
// basemap cannot draw labels.

import { useEffect, useRef } from "react";
import { create } from "zustand";

import { currentDocument, followDocument } from "../state/document";
import {
  createMapOverlays,
  labelFontOf,
  overlaySpec,
  type FontSource,
  type ApplyReport,
  type LayerOutcome,
  type MapOverlays,
  type OverlaySpec,
  type StyleTarget,
} from "../lib/mapOverlays";

import type * as maplibregl from "maplibre-gl";

/** One reconciler per map, so a remount does not lose what is on the map. */
const reconcilers = new WeakMap<object, MapOverlays>();

function overlaysFor(map: maplibregl.Map): MapOverlays {
  let overlays = reconcilers.get(map);
  if (!overlays) {
    overlays = createMapOverlays(map as unknown as StyleTarget);
    reconcilers.set(map, overlays);
  }
  return overlays;
}

/**
 * What the last apply did to each overlay, for the layer panel, and the
 * font labels are drawn in: undefined before a map has a style, null when
 * the basemap has no glyphs.
 */
export const useOverlayReport = create<{
  report: ApplyReport;
  labelFont?: string[] | null;
}>(() => ({
  report: new Map(),
}));

/** The outcome for one overlay, or undefined before it was applied. */
export function useOverlayOutcome(id: string): LayerOutcome | undefined {
  return useOverlayReport((s) => s.report.get(id));
}

export function useMapOverlays(map: maplibregl.Map | null): void {
  const lastSpec = useRef<OverlaySpec | null>(null);

  const apply = (target: maplibregl.Map, spec: OverlaySpec): void => {
    lastSpec.current = spec;
    useOverlayReport.setState({ report: overlaysFor(target).apply(spec) });
  };
  /** Build the spec for the open document on this map's basemap, apply it. */
  const applyDocument = (target: maplibregl.Map): void => {
    const labelFont = labelFontOf(target as unknown as FontSource);
    const before = useOverlayReport.getState().labelFont;
    if (JSON.stringify(before) !== JSON.stringify(labelFont)) {
      useOverlayReport.setState({ labelFont });
    }
    apply(target, overlaySpec(currentDocument().snapshot(), { labelFont }));
  };
  const applyRef = useRef(applyDocument);
  applyRef.current = applyDocument;

  useEffect(() => {
    if (!map) {
      return;
    }
    const unfollow = followDocument(() => applyRef.current(map));
    // A new style can bring or take away glyphs: build the spec again.
    const onStyleData = () => {
      if (lastSpec.current) {
        applyRef.current(map);
      }
    };
    map.on("styledata", onStyleData);
    return () => {
      unfollow();
      map.off("styledata", onStyleData);
    };
  }, [map]);

  useEffect(() => {
    if (!map) {
      return;
    }
    applyRef.current(map);
  }, [map]);
}
