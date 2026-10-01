// SPDX-License-Identifier: AGPL-3.0-only
//
// The two directions of the layer selection, between the session view and
// the drawing.
//
// View → drawing: the annotation ids of the selection become the drawing's
// selected elements. A data, raster or tile layer id has no element.
// Drawing → view is useExcalidrawChangeHandler. Both compare key sets before
// they write, which ends the loop: a change that came from the drawing finds
// the drawing as it wants it.
//
// A selection never moves the camera; only "Zoom to layer" does.

import { useEffect } from "react";

import type { ExcalidrawImperativeAPI } from "@atlasdraw/excalidraw";

import { isOverlayId } from "../state/selectedLayer";

import type { ViewStore } from "../session/view";

const keySet = (ids: Readonly<Record<string, unknown>>) =>
  Object.keys(ids).sort().join(",");

export function useSelectionSync(
  view: ViewStore,
  api: ExcalidrawImperativeAPI | null,
): void {
  useEffect(() => {
    if (!api) {
      return;
    }
    return view.subscribe((state, prev) => {
      if (state.selection === prev.selection) {
        return;
      }
      const annotationIds: Record<string, true> = {};
      for (const id of Object.keys(state.selection)) {
        if (!isOverlayId(id)) {
          annotationIds[id] = true;
        }
      }
      const current = api.getAppState()?.selectedElementIds ?? {};
      if (keySet(current) !== keySet(annotationIds)) {
        api.updateScene({ appState: { selectedElementIds: annotationIds } });
      }
    });
  }, [view, api]);
}
