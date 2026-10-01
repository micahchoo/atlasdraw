// SPDX-License-Identifier: AGPL-3.0-only
//
// Convert an annotation to a data layer, from the element's right-click menu
// (registered through the fork's `excalidrawAPI.registerContextMenuItem`).
//
// The conversion is two edits: the document gains a data layer with the
// element's geometry, and the element is deleted as an undoable scene step.
// The map overlays draw the new layer; nothing here writes the map.

import { useCallback, useEffect } from "react";

import {
  annotationToFeatureCollection,
  elementGeometry,
  UnsupportedConvertElementError,
  type ConvertibleElement,
} from "@atlasdraw/tools";
import { defaultLayerStyle } from "@atlasdraw/basemap";

import type { ExcalidrawImperativeAPI } from "@atlasdraw/excalidraw";

import { deleteAnnotation, generateLayerLabel } from "../state/annotations";
import { currentDocument } from "../state/document";

import type { DocumentCommand } from "../state/document";

/**
 * True when the element converts: it has a shape on the map, and it is not
 * text (a label is not a feature). Read through the open document's frame.
 */
function isConvertible(el: ConvertibleElement): boolean {
  return (
    el.type !== "text" &&
    elementGeometry(el, currentDocument().snapshot().world) !== null
  );
}

/**
 * Registers the Convert-annotation-to-data-layer action on the element
 * right-click context menu. Also returns the underlying
 * `currentConvertibleSelection`/`handleConvert` pair for a future MainMenu
 * surface to reuse — unconsumed by any caller today.
 */
export interface ConvertToDataLayerNotify {
  error: (msg: string) => void;
}

export function useConvertToDataLayer(
  excalidrawAPI: ExcalidrawImperativeAPI | null,
  addDataLayer: (
    layer: Omit<Extract<DocumentCommand, { type: "add-data-layer" }>, "type">,
  ) => void,
  notify: ConvertToDataLayerNotify,
): {
  currentConvertibleSelection: () => ConvertibleElement | null;
  handleConvert: (el: ConvertibleElement) => void;
} {
  // `currentConvertibleSelection()` is read at click time (not at render
  // time) so we don't re-render the whole tree on every selection change
  // just to recompute the menu's enabled state.
  const currentConvertibleSelection =
    useCallback((): ConvertibleElement | null => {
      if (!excalidrawAPI) {
        return null;
      }
      const appState = excalidrawAPI.getAppState();
      const ids = Object.keys(appState.selectedElementIds ?? {});
      if (ids.length !== 1) {
        return null;
      }
      const el = excalidrawAPI.getSceneElements().find((x) => x.id === ids[0]);
      // Filter at the gate so the menu item shows enabled only when the
      // conversion will succeed.
      return el && isConvertible(el) ? el : null;
    }, [excalidrawAPI]);

  const handleConvert = useCallback(
    (el: ConvertibleElement) => {
      if (!excalidrawAPI) {
        return;
      }
      try {
        const world = currentDocument().snapshot().world;
        const fc = annotationToFeatureCollection(el, world);
        const source = excalidrawAPI
          .getSceneElements()
          .find((x) => x.id === el.id);
        addDataLayer({
          id: `dl:${crypto.randomUUID()}`,
          fc,
          label: source ? generateLayerLabel(source, world) : el.type,
          style: defaultLayerStyle(fc),
        });
        deleteAnnotation(excalidrawAPI, el.id);
      } catch (err) {
        if (err instanceof UnsupportedConvertElementError) {
          notify.error(err.message);
          return;
        }
        // `handleConvert` runs inside the context menu's onClick; a rethrow
        // would be an uncaught exception with nothing shown to the user.
        // eslint-disable-next-line no-console
        console.error("[useConvertToDataLayer] convert failed:", err);
        notify.error(
          `Couldn't convert to a data layer${
            err instanceof Error ? ` — ${err.message}` : ""
          }`,
        );
      }
    },
    [addDataLayer, excalidrawAPI, notify],
  );

  // Convert is a right-click context-menu item, through the
  // atlasdraw fork's `excalidrawAPI.registerContextMenuItem`. Item appears
  // at the tail of the element menu, gated the same way
  // currentConvertibleSelection is (single selection with a shape, not text).
  // Re-runs on handleConvert identity change; the unregister fn returned by the API
  // removes the prior closure so we don't accumulate stale items.
  useEffect(() => {
    if (!excalidrawAPI) {
      return;
    }
    const unregister = excalidrawAPI.registerContextMenuItem({
      name: "atlasConvertToDataLayer",
      label: "Convert selection to data layer",
      // Same gate as currentConvertibleSelection, but evaluated against the
      // (elements, appState) Excalidraw passes us — independent of the API
      // getters so the menu's enabled state tracks the live selection
      // without us subscribing to onChange.
      predicate: (elements, appState) => {
        const ids = Object.keys(appState.selectedElementIds ?? {});
        if (ids.length !== 1) {
          return false;
        }
        const el = elements.find((x) => x.id === ids[0]);
        return !!el && isConvertible(el);
      },
      perform: () => {
        // Defensive: predicate already passed, but recompute the
        // ConvertibleElement view (typed shape) at click time so we
        // reuse currentConvertibleSelection's exact ConvertibleElement
        // contract without duplicating the type narrowing.
        const el = currentConvertibleSelection();
        if (el) {
          handleConvert(el);
        }
        // handleConvert performs the scene mutation directly via
        // excalidrawAPI.updateScene; return false so the
        // ContextMenu/actionManager updater doesn't try to re-apply
        // anything on top.
        return false;
      },
    });
    return unregister;
  }, [excalidrawAPI, handleConvert, currentConvertibleSelection]);

  return { currentConvertibleSelection, handleConvert };
}
