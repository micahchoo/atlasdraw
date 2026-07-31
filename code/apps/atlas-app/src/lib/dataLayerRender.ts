// SPDX-License-Identifier: AGPL-3.0-only
//
// dataLayerRender — every write the app makes to the `dl:` data layers inside a
// MapLibre style: add, remove, visibility, stacking order, and the whole-style
// reconcile that rebuilds them from the LayerRegistry.
//
// Call sites:
//   - useDataFileImport    — a freshly imported/dropped file;
//   - useBasemapStyle      — re-adding every layer after `setStyle()` dropped
//     the custom sources/layers along with the old style document;
//   - useLayerRegistrySync — registry mutations (add / remove / reorder /
//     visibility) pushed at the map so the LayerPanel can't lie about it;
//   - (still duplicated) useConvertToDataLayer + useCollabDataLayer.
//
// It lives in `lib/` rather than on useLayerRegistrySync because it is not a
// hook and because component tests routinely
// `vi.mock("../../hooks/useLayerRegistrySync")` down to its hook export —
// anything shared that lives there becomes `undefined` in six MapEditor tests.
// `lib/` is where the repo keeps non-hook modules (see lib/geometryType.ts).
//
// No React here: pure functions over narrowed map surfaces, so tests drive them
// with a stub object (same convention as useLayerRegistrySync's factories,
// mx-8e3209). Each surface is narrowed to exactly the methods its own function
// calls, so a stub never has to implement more than the behaviour under test.

import { compileLayer } from "@atlasdraw/basemap";

import { inferGeometryType } from "./geometryType";

import type maplibregl from "maplibre-gl";
import type { FeatureCollection } from "geojson";
import type {
  LayerRegistryEntry,
  LayerStyle,
  RasterCorners,
} from "../state/layerRegistry";

/**
 * Every source spec this module hands to MapLibre.
 *
 * A union on one method rather than a method per kind. The first attempt gave
 * rasters their own surface with their own `addSource`, which reads tidier
 * right up until a caller needs both: `DataLayerMapSurface &
 * RasterLayerMapSurface` intersects into an `addSource` that accepts geojson
 * AND image specs at once, and no single-signature stub — or real map — can
 * satisfy it. MapLibre itself takes a union here, and so does this.
 */
export type LayerSourceSpec =
  | { type: "geojson"; data: FeatureCollection }
  | { type: "image"; url: string; coordinates: RasterCorners };

/**
 * Minimal MapLibre surface for putting a layer on the map. Narrowed so tests
 * can pass a stub instead of constructing a full Map.
 */
export interface DataLayerMapSurface {
  addSource(id: string, spec: LayerSourceSpec): void;
  addLayer(spec: maplibregl.LayerSpecification): void;
  removeSource(id: string): void;
  getLayer(id: string): unknown;
  setLayoutProperty(layerId: string, name: string, value: unknown): void;
}

/**
 * Add one data layer's GeoJSON source and its compiled layer to the map.
 *
 * Throws on failure, after rolling the source back — a rejected `addLayer`
 * would otherwise leave an orphan source under the same id, which makes the
 * next attempt fail with "there is already a source with ID".
 */
export function addDataLayerToMap(
  map: DataLayerMapSurface,
  id: string,
  fc: FeatureCollection,
  style: LayerStyle,
): void {
  map.addSource(id, { type: "geojson", data: fc });
  try {
    map.addLayer(compileLayer(id, style, inferGeometryType(fc)));
  } catch (layerErr) {
    try {
      map.removeSource(id);
    } catch {
      /* swallow secondary failure — rollback is best-effort */
    }
    throw layerErr;
  }
}

/**
 * What `addRasterLayerToMap` needs. A structural subset of
 * `DataLayerMapSurface` — no `setLayoutProperty`, since visibility is
 * `applyVisibilityToMap`'s job — so a stub for either satisfies this.
 */
export type RasterLayerMapSurface = Omit<
  DataLayerMapSurface,
  "setLayoutProperty"
>;

/**
 * Add one raster's image source and layer.
 *
 * Deliberately not routed through `compileLayer`: that function compiles a
 * `LayerStyle` — fill colour, stroke width, data-driven expressions — into a
 * vector paint, and a raster has none of those. Widening it to sometimes return
 * a raster spec would put a branch in the middle of the vector styling path for
 * a layer kind that shares nothing with it.
 *
 * Same rollback as `addDataLayerToMap`, for the same reason: a rejected
 * `addLayer` leaves an orphan source under the id, and the next attempt then
 * fails with "there is already a source with ID".
 */
export function addRasterLayerToMap(
  map: RasterLayerMapSurface,
  id: string,
  url: string,
  corners: RasterCorners,
  opacity: number,
): void {
  map.addSource(id, { type: "image", url, coordinates: corners });
  try {
    map.addLayer({
      id,
      type: "raster",
      source: id,
      paint: { "raster-opacity": opacity },
    });
  } catch (layerErr) {
    try {
      map.removeSource(id);
    } catch {
      /* swallow secondary failure — rollback is best-effort */
    }
    throw layerErr;
  }
}

/**
 * Minimal MapLibre surface we touch for visibility — just `setLayoutProperty`.
 */
export interface MapLayoutSurface {
  setLayoutProperty(layerId: string, name: string, value: unknown): void;
}

/**
 * Apply a registry data-layer entry's visibility to the MapLibre style.
 * Wrapped in try/catch because the registry id MAY be out of sync with the
 * style (user removed the layer via devtools, style swap dropped it, etc.).
 * Logging keeps the failure observable without crashing the app.
 *
 * Exported for unit testing.
 */
export function applyVisibilityToMap(
  map: MapLayoutSurface,
  layerId: string,
  visible: boolean,
): void {
  try {
    map.setLayoutProperty(layerId, "visibility", visible ? "visible" : "none");
  } catch (err) {
    // eslint-disable-next-line no-console
    console.warn(
      `[dataLayerRender] setLayoutProperty failed for "${layerId}":`,
      err,
    );
  }
}

/**
 * Minimal MapLibre surface for tearing a data layer back out of the style.
 * Layer before source: MapLibre refuses to remove a source that a layer still
 * references.
 */
export interface DataLayerRemovalSurface {
  getLayer(id: string): unknown;
  removeLayer(id: string): void;
  getSource(id: string): unknown;
  removeSource(id: string): void;
}

/**
 * Drop the given data-layer ids out of the MapLibre style, source and all.
 *
 * The reconcile direction is add-only, so without this a `hydrate()` that
 * swaps in a different document left the previous document's layers rendered
 * underneath the new one — the registry no longer listed them, so nothing
 * would ever toggle, restyle or remove them again.
 *
 * Per-id try/catch, same reasoning as applyVisibilityToMap: a registry id can
 * legitimately be absent from the style, and one failure must not strand the
 * rest of the removals.
 *
 * Exported for unit testing.
 */
export function removeDataLayersFromMap(
  map: DataLayerRemovalSurface,
  ids: readonly string[],
): void {
  for (const id of ids) {
    try {
      if (map.getLayer(id)) {
        map.removeLayer(id);
      }
      if (map.getSource(id)) {
        map.removeSource(id);
      }
    } catch (err) {
      // eslint-disable-next-line no-console
      console.warn(
        `[dataLayerRender] removing data layer "${id}" failed:`,
        err,
      );
    }
  }
}

/**
 * Minimal MapLibre surface for restacking layers.
 *
 * `getLayersOrder()` is the style's live layer order (maplibre-gl 4.x); we read
 * it rather than tracking a shadow copy so the diff is against what the map
 * actually renders, not what we last told it.
 */
export interface MapOrderSurface {
  getLayersOrder(): string[];
  moveLayer(layerId: string, beforeId?: string): void;
}

/** True when two id sequences are the same list in the same order. */
function sameSequence(a: readonly string[], b: readonly string[]): boolean {
  return a.length === b.length && a.every((id, i) => id === b[i]);
}

/**
 * Restack the map's data layers to match registry array order.
 *
 * Registry array order is the intended z-order: index 0 is the bottom of the
 * data-layer stack, which is also the order reconcileDataLayers adds them in
 * (MapLibre draws in style order, so the last one added sits on top). `reorder`
 * permutes the array and nothing else — before this function existed, dragging
 * a data layer changed the panel and left the map exactly as it was.
 *
 * Only `dl:` data entries are considered. Annotation entries are Excalidraw
 * canvas elements, not MapLibre layers, so passing their ids to `moveLayer`
 * would throw for every one of them.
 *
 * Diffs first: when the style already agrees with the registry this issues no
 * `moveLayer` at all, which matters because the store notifies on every label
 * keystroke and visibility toggle too.
 *
 * Exported for unit testing.
 */
export function applyOrderToMap(
  map: MapOrderSurface,
  entries: readonly LayerRegistryEntry[],
): void {
  // Rasters first, then data layers. Both are MapLibre layers in one style, so
  // one sequence covers the whole stack — and putting every raster below every
  // vector is the rule, not a coincidence of insertion order: a scanned sheet
  // is a backdrop you trace on top of, and a raster that can cover your own
  // annotations is a way to lose them without deleting anything.
  //
  // Within each band, registry array order still decides, so dragging one
  // raster above another works and dragging one above a data layer does not.
  const wanted = [
    ...entries.filter((e) => e.kind === "raster").map((e) => e.id),
    ...entries.filter((e) => e.kind === "data").map((e) => e.id),
  ];
  if (wanted.length < 2) {
    return; // a single layer (or none) can't be out of order
  }

  let styleOrder: string[];
  try {
    styleOrder = map.getLayersOrder();
  } catch (err) {
    // eslint-disable-next-line no-console
    console.warn("[dataLayerRender] getLayersOrder failed:", err);
    return;
  }

  // A registry id can legitimately be missing from the style (reconcile skipped
  // it for a missing FC mirror, the user removed it by hand). Restacking the
  // ones that *are* present still gives them the right relative order.
  const onMap = new Set(styleOrder);
  const desired = wanted.filter((id) => onMap.has(id));
  const desiredSet = new Set(desired);
  const current = styleOrder.filter((id) => desiredSet.has(id));
  if (sameSequence(current, desired)) {
    return;
  }

  // `moveLayer(id, beforeId)` puts `id` immediately *below* `beforeId`. Walking
  // top-down, each layer lands under the one already fixed above it, so one
  // pass realises any permutation and the topmost data layer never moves —
  // whatever non-registry layers sit above the stack stay above it.
  for (let i = desired.length - 2; i >= 0; i--) {
    try {
      map.moveLayer(desired[i], desired[i + 1]);
    } catch (err) {
      // eslint-disable-next-line no-console
      console.warn(
        `[dataLayerRender] moveLayer failed for "${desired[i]}":`,
        err,
      );
    }
  }
}

/**
 * Reconcile the map back to the registry: add a source + layer for every data
 * entry that the current MapLibre style is missing, then re-apply its
 * visibility.
 *
 * Three callers, one behaviour:
 *   - a basemap switch (useBasemapStyle), because setStyle() drops every
 *     custom source and layer;
 *   - a document load / registry replay (state/hydrate.ts writes entries but
 *     never touches the map);
 *   - a registry gaining a data-layer id from anywhere else (convert).
 *
 * FU-1: rasters go back too, and they go back FIRST so a rebuilt style has them
 * under the vector band. Without this a basemap switch would drop every scanned
 * sheet off the map while leaving its row in the panel — which is precisely the
 * failure FU-3 fixed for the collaboration layer, arriving by a different door.
 *
 * Idempotent by design — entries already present in the style are skipped via
 * `getLayer`, which is also what keeps this off the import path's toes
 * (useDataFileImport adds to the map *before* registering, so by the time the
 * store notifies us the layer already exists).
 *
 * Hidden layers are added and then hidden rather than skipped, so a later
 * visibility toggle has something to toggle.
 *
 * Exported for unit testing.
 */
export function reconcileDataLayers(
  map: DataLayerMapSurface,
  entries: readonly LayerRegistryEntry[],
  fcs: Record<string, FeatureCollection>,
  /**
   * FU-1: raster id → object URL. Optional so the three existing callers that
   * have no rasters in scope keep compiling, and so a caller that genuinely
   * has none is not made to pass `{}` to say so.
   */
  rasterUrls: Record<string, string> = {},
): void {
  // Rasters first, so a from-scratch rebuild lands them under the vector band
  // without needing applyOrderToMap to fix it afterwards. Within each pass,
  // array order stacks bottom-up, matching the z-order applyOrderToMap
  // enforces. Neither pass fixes an EXISTING style's order — a layer already
  // present is skipped — so the two functions stay complementary.
  for (const entry of entries) {
    if (entry.kind !== "raster") {
      continue;
    }
    if (map.getLayer(entry.id)) {
      continue;
    }
    const url = rasterUrls[entry.id];
    if (!url) {
      // Same shape as the missing-FC case below: an entry with no image cannot
      // render, and a raster in the panel that draws nothing is worse than one
      // that is honestly absent. hydrate() already skips these at load.
      // eslint-disable-next-line no-console
      console.warn(
        "[dataLayerRender] no decoded image for raster layer, skipping",
        entry.id,
      );
      continue;
    }
    try {
      addRasterLayerToMap(map, entry.id, url, entry.corners, entry.opacity);
    } catch (err) {
      // eslint-disable-next-line no-console
      console.warn(
        `[dataLayerRender] re-adding raster layer "${entry.id}" failed:`,
        err,
      );
      continue;
    }
    if (!entry.visible) {
      applyVisibilityToMap(map, entry.id, false);
    }
  }

  for (const entry of entries) {
    if (entry.kind !== "data") {
      continue;
    }
    if (map.getLayer(entry.id)) {
      continue;
    }
    const fc = fcs[entry.id];
    if (!fc) {
      // A registry entry with no FC mirror can't be rendered. hydrate() already
      // skips manifest layers whose blob is missing, so this is the drift case
      // (e.g. an entry written without going through registerDataLayer).
      // eslint-disable-next-line no-console
      console.warn(
        "[dataLayerRender] no FeatureCollection for data layer, skipping",
        entry.id,
      );
      continue;
    }
    try {
      addDataLayerToMap(map, entry.id, fc, entry.style);
    } catch (err) {
      // eslint-disable-next-line no-console
      console.warn(
        `[dataLayerRender] re-adding data layer "${entry.id}" failed:`,
        err,
      );
      continue;
    }
    if (!entry.visible) {
      applyVisibilityToMap(map, entry.id, false);
    }
  }
}
