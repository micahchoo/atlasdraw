// SPDX-License-Identifier: AGPL-3.0-only
//
// W-C — Convert annotation → data layer, surfaced via the element
// right-click context menu.
//
// Rule-0 retrofit: original surface (Wave 3b T14) was a custom <div role="menu">
// hung off the root container's onContextMenu. v0.18 ships no public way to
// splice items into Excalidraw's element context menu (App.tsx:12488
// getContextMenuItems is hardcoded; Action interface has no contextItemLabel).
// So Convert surfaces via the atlasdraw fork's `excalidrawAPI.registerContextMenuItem`
// (packages/excalidraw/components/App.tsx) instead — registered internally
// by this hook, predicate-driven enabled state (single geo selection, not
// text/arrow). NB: an older W-B plan additionally described a MainMenu.Item
// surface reading the same predicate/handler pair; no such MainMenu item
// exists in MapEditor's JSX (confirmed by grep before this extraction) — the
// context menu is the only live surface today. `currentConvertibleSelection`/
// `handleConvert` are returned for a future MainMenu surface to reuse, should
// one get built; today nothing outside this hook consumes them.
//
// Why we don't call registry.convertAnnotationToDataLayer here: that method
// mints its own dl:<uuid> internally and uses DEFAULT_CONVERTED_STYLE, but
// returns nothing — we'd have no id to coordinate with map.addSource/
// addLayer. Instead we mirror T13's drop pattern: generate the id at the
// call site, registerDataLayer with the fc/style we built, then remove the
// annotation entry. Same end state, with id ownership at the call site.
//
// Extracted from MapEditor.tsx (DEADWOOD.md god-module split, Cut 2) — the
// best-covered inline concern: MapEditor.contextmenu.test.tsx exercises
// registration, predicate, the full perform pipeline, and unregister-on-
// unmount.

import { useCallback, useEffect } from "react";

import {
  annotationToFeatureCollection,
  UnsupportedConvertElementError,
  type ConvertibleElement,
} from "@atlasdraw/tools";
import { compileLayer, defaultLayerStyle } from "@atlasdraw/basemap";
import { isGeoCustomData } from "@atlasdraw/geo";

import type { ExcalidrawImperativeAPI } from "@atlasdraw/excalidraw";

import { inferGeometryType } from "../lib/geometryType";

import type { LayerRegistryState } from "../state/layerRegistry";
import type maplibregl from "maplibre-gl";

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
  map: maplibregl.Map | null,
  excalidrawAPI: ExcalidrawImperativeAPI | null,
  registry: Pick<LayerRegistryState, "registerDataLayer" | "remove">,
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
      if (!el || !isGeoCustomData(el.customData)) {
        return null;
      }
      // text elements carry geo but aren't convertible. Filter at the gate
      // so the menu item shows enabled only when the conversion will succeed.
      if (el.type === "text") {
        return null;
      }
      return {
        id: el.id,
        type: el.type,
        customData: el.customData as ConvertibleElement["customData"],
      };
    }, [excalidrawAPI]);

  const handleConvert = useCallback(
    (el: ConvertibleElement) => {
      if (!map || !excalidrawAPI) {
        return;
      }
      try {
        // Step 1 — pure computation, no side effects.
        const fc = annotationToFeatureCollection(el);
        const id = `dl:${crypto.randomUUID()}`;
        const style = defaultLayerStyle(fc);
        const geometryType = inferGeometryType(fc);
        // Step 2 — map mutations first; rollback the orphan source if addLayer throws.
        map.addSource(id, { type: "geojson", data: fc });
        try {
          map.addLayer(compileLayer(id, style, geometryType));
        } catch (layerErr) {
          try {
            map.removeSource(id);
          } catch {
            /* swallow secondary failure */
          }
          throw layerErr;
        }
        // Step 3 — registry mutations (won't throw).
        registry.registerDataLayer({ id, fc, label: el.id, style });
        registry.remove(el.id); // drop the old annotation entry (if any)
        // Step 4 — destructive scene mutation last.
        const remaining = excalidrawAPI
          .getSceneElements()
          .filter((x) => x.id !== el.id);
        excalidrawAPI.updateScene({ elements: remaining });
      } catch (err) {
        if (err instanceof UnsupportedConvertElementError) {
          notify.error(err.message);
          return;
        }
        // `handleConvert` runs synchronously inside the vendored context
        // menu's onClick — an unguarded rethrow here would surface as an
        // uncaught exception with nothing shown to the user (same class of
        // bug as useDataFileImport.ts's addLayer-failure path).
        // eslint-disable-next-line no-console
        console.error("[useConvertToDataLayer] convert failed:", err);
        notify.error(
          `Couldn't convert to a data layer${
            err instanceof Error ? ` — ${err.message}` : ""
          }`,
        );
      }
    },
    [map, registry, excalidrawAPI, notify],
  );

  // W-C — Surface Convert as a right-click context-menu item via the
  // atlasdraw fork's `excalidrawAPI.registerContextMenuItem`. Item appears
  // at the tail of the element menu, gated the same way
  // currentConvertibleSelection is (single geo selection, not text/arrow).
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
        if (!el || !isGeoCustomData(el.customData)) {
          return false;
        }
        if (el.type === "text") {
          return false;
        }
        return true;
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
