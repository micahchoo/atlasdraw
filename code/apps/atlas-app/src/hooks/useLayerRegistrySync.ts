// SPDX-License-Identifier: AGPL-3.0-only
//
// useLayerRegistrySync — the bridge from the layer registry to MapLibre.
//
// MapLibre sources cannot be read back, so the registry is the truth for the
// data and raster layers and this hook pushes its changes onto the map:
//
//   1. Visibility — a flipped `visible` sets the layer's layout visibility.
//   2. Style — `updateStyle` changes `entry.style`; the compiled paint of the
//      old and new style is diffed and only changed properties are pushed
//      (applyStyleToMap / diffStyles).
//   3. Membership — a MapLibre `setStyle()` drops every custom source and
//      layer, and a document load fills the registry without touching the
//      map. So map membership is diffed against the registry's set of data
//      layer ids: added ids are reconciled onto the map, removed ids leave it.
//      Geometry is read from the DataLayerFCStore.
//   4. Order — a changed data-layer id sequence restacks the style
//      (applyOrderToMap).
//
// Annotations are not in the registry; they are scene elements.
//
// The diffs are plain exported functions so tests can drive them without a
// React renderer. Everything that writes the MapLibre style lives in
// ../lib/dataLayerRender, shared with the import and basemap-swap paths.

import { useEffect } from "react";

import { compilePaint } from "@atlasdraw/basemap";

import type { LayerGeometryType } from "@atlasdraw/basemap";

import {
  useLayerRegistryStore,
  type LayerRegistryEntry,
  type LayerStyle,
} from "../state/layerRegistry";
import { useDataLayerFCStore } from "../state/useDataLayerFCStore";
import { useRasterImageStore } from "../state/useRasterImageStore";

import { inferGeometryType } from "../lib/geometryType";

import {
  applyOrderToMap,
  applyVisibilityToMap,
  reconcileDataLayers,
  removeDataLayersFromMap,
} from "../lib/dataLayerRender";

import type maplibregl from "maplibre-gl";

/**
 * FU-1: raster id → object URL, in the shape reconcileDataLayers wants.
 *
 * The store holds `{ blob, url }` because the blob is what gets written into a
 * saved document; the map only ever needs the url. Projecting here keeps
 * dataLayerRender ignorant of the store, which is the whole reason it takes a
 * plain record rather than reading one.
 */
function rasterUrlSnapshot(): Record<string, string> {
  const images = useRasterImageStore.getState().getAll();
  return Object.fromEntries(
    Object.entries(images).map(([id, image]) => [id, image.url]),
  );
}

// ---------------------------------------------------------------------------
// P1 — data-layer style (MapLibre setPaintProperty) factory.
// ---------------------------------------------------------------------------

/**
 * Minimal MapLibre surface for paint updates. Same stub-friendly narrowing as
 * lib/dataLayerRender's surfaces.
 */
export interface MapPaintSurface {
  setPaintProperty(layerId: string, name: string, value: unknown): void;
}

/**
 * True when two compiled paint values are the same as far as MapLibre cares.
 * Scalars compare by value; expressions are plain JSON arrays, so a structural
 * compare is both correct and cheap — a re-render that rebuilds an identical
 * expression object must not push it again.
 */
function samePaintValue(a: unknown, b: unknown): boolean {
  if (a === b) {
    return true;
  }
  if (
    typeof a !== "object" ||
    typeof b !== "object" ||
    a === null ||
    b === null
  ) {
    return false;
  }
  return JSON.stringify(a) === JSON.stringify(b);
}

/**
 * Apply a registry data-layer style change to the MapLibre style by pushing
 * `setPaintProperty` for each paint property whose compiled value changed.
 *
 * Only the *differences* are pushed — mirroring how diffVisibility filters to
 * real flips. A style patch that touches `fillColor` must not also re-push
 * opacity and outline colour on every keystroke of a colour picker.
 *
 * `geometryType` is the caller's (the layer was added with that same kind, so
 * the paint property names are fixed for its lifetime).
 *
 * Per-property try/catch, same reasoning as applyVisibilityToMap: the registry
 * id may have drifted from the style, and one rejected value shouldn't drop
 * the rest of the patch.
 *
 * Exported for unit testing.
 */
export function applyStyleToMap(
  map: MapPaintSurface,
  layerId: string,
  prevStyle: LayerStyle,
  nextStyle: LayerStyle,
  geometryType: LayerGeometryType,
): void {
  const prevPaint = compilePaint(prevStyle, geometryType);
  const nextPaint = compilePaint(nextStyle, geometryType);

  for (const [name, value] of Object.entries(nextPaint)) {
    if (samePaintValue(prevPaint[name], value)) {
      continue;
    }
    try {
      map.setPaintProperty(layerId, name, value);
    } catch (err) {
      // eslint-disable-next-line no-console
      console.warn(
        `[useLayerRegistrySync] setPaintProperty "${name}" failed for "${layerId}":`,
        err,
      );
    }
  }
}

/**
 * Compute per-entry style changes between two snapshots of the registry's
 * entries array. Only data layers carry a style.
 *
 * The store runs on immer, so an entry whose style was not touched keeps the
 * same `style` object identity across snapshots — a referential check is
 * therefore an exact "did updateStyle run on this entry" test, and the
 * property-level filtering happens in applyStyleToMap.
 *
 * New entries are skipped: their style is already baked into the addLayer spec.
 *
 * Exported for unit testing.
 */
export function diffStyles(
  prev: readonly LayerRegistryEntry[],
  next: readonly LayerRegistryEntry[],
): Array<{ id: string; prevStyle: LayerStyle; nextStyle: LayerStyle }> {
  const prevStyles = new Map<string, LayerStyle>();
  for (const entry of prev) {
    if (entry.kind === "data") {
      prevStyles.set(entry.id, entry.style);
    }
  }
  const out: Array<{
    id: string;
    prevStyle: LayerStyle;
    nextStyle: LayerStyle;
  }> = [];
  for (const entry of next) {
    if (entry.kind !== "data") {
      continue;
    }
    const prevStyle = prevStyles.get(entry.id);
    if (prevStyle === undefined || prevStyle === entry.style) {
      continue;
    }
    out.push({ id: entry.id, prevStyle, nextStyle: entry.style });
  }
  return out;
}

// ---------------------------------------------------------------------------
// P2/P3 — data-layer membership + stacking diff.
// ---------------------------------------------------------------------------

/** The registry's data-layer ids, in array order (= intended z-order). */
function dataLayerIds(entries: readonly LayerRegistryEntry[]): string[] {
  const out: string[] = [];
  for (const entry of entries) {
    if (entry.kind === "data") {
      out.push(entry.id);
    }
  }
  return out;
}

/**
 * Compare two registry snapshots by their data-layer id *sequence* — which ids
 * appeared, which vanished, and whether the survivors changed places.
 *
 * A length comparison is not enough, and that was a real bug on both sides:
 *   - `convertAnnotationToDataLayer` removes one entry and pushes one in a
 *     single draft, so the array length never changes and the new data layer
 *     never reached the map;
 *   - a `hydrate()` of a different document swaps one set of ids for another,
 *     which needs removals, not just adds.
 *
 * `orderChanged` compares only the ids present in *both* snapshots, so a pure
 * add or remove doesn't masquerade as a reorder.
 *
 * Exported for unit testing.
 */
export function diffDataLayerIds(
  prev: readonly LayerRegistryEntry[],
  next: readonly LayerRegistryEntry[],
): { added: string[]; removed: string[]; orderChanged: boolean } {
  const prevIds = dataLayerIds(prev);
  const nextIds = dataLayerIds(next);
  const prevSet = new Set(prevIds);
  const nextSet = new Set(nextIds);
  const keptBefore = prevIds.filter((id) => nextSet.has(id));
  const keptAfter = nextIds.filter((id) => prevSet.has(id));
  return {
    added: nextIds.filter((id) => !prevSet.has(id)),
    removed: prevIds.filter((id) => !nextSet.has(id)),
    orderChanged: keptBefore.some((id, i) => id !== keptAfter[i]),
  };
}

// ---------------------------------------------------------------------------
// React hook — wires the factories above to live deps.
// ---------------------------------------------------------------------------

/**
 * Compute per-entry visibility transitions between two snapshots of the
 * registry's entries array. Returns the entries whose `visible` flipped.
 *
 * Exported for unit testing.
 */
export function diffVisibility(
  prev: readonly LayerRegistryEntry[],
  next: readonly LayerRegistryEntry[],
): LayerRegistryEntry[] {
  const prevMap = new Map(prev.map((e) => [e.id, e.visible]));
  const out: LayerRegistryEntry[] = [];
  for (const entry of next) {
    const prevVisible = prevMap.get(entry.id);
    if (prevVisible === undefined) {
      continue;
    } // new entry — initial visibility, no flip
    if (prevVisible !== entry.visible) {
      out.push(entry);
    }
  }
  return out;
}

/**
 * Push the layer registry's data and raster layers onto the map.
 *
 * @param map - MapLibre Map instance (null until the map mounts)
 */
export function useLayerRegistrySync(map: maplibregl.Map | null): void {
  // ---- P2: registry → map, on a fresh map instance -------------------------
  // A document can be loaded before the map is ready — hydrate() populates the
  // registry with data-layer entries without ever touching MapLibre. Reconcile
  // once per map instance to close that gap (a no-op when the registry has no
  // data layers, which is the common case).
  useEffect(() => {
    if (!map) {
      return;
    }
    reconcileDataLayers(
      map,
      useLayerRegistryStore.getState().entries,
      useDataLayerFCStore.getState().getAll(),
      rasterUrlSnapshot(),
    );
  }, [map]);

  // ---- registry → map ------------------------------------------------------
  // Zustand subscribe with a manual diff against the previous entries snapshot.
  // We don't use a selector-form subscriber because we need both the kind and
  // the visibility — selecting just `entries` and diffing in a useEffect would
  // re-fire on any unrelated mutation (label/order/style), wasting work.
  // Subscribe-style still re-fires on those, but we filter via diffVisibility /
  // diffStyles, which only report actual changes.
  useEffect(() => {
    if (!map) {
      return;
    }

    let prevEntries = useLayerRegistryStore.getState().entries;
    const unsub = useLayerRegistryStore.subscribe((state) => {
      const flips = diffVisibility(prevEntries, state.entries);
      const styleChanges = map ? diffStyles(prevEntries, state.entries) : [];
      const idChanges = map
        ? diffDataLayerIds(prevEntries, state.entries)
        : { added: [], removed: [], orderChanged: false };
      prevEntries = state.entries;

      // P1 — push style patches as setPaintProperty calls. Geometry kind comes
      // from the FC mirror, the same source addDataLayerToMap infers from, so
      // the paint property names always match the layer that's on the map.
      if (map && styleChanges.length > 0) {
        const fcs = useDataLayerFCStore.getState().getAll();
        for (const change of styleChanges) {
          const fc = fcs[change.id];
          if (!fc) {
            // eslint-disable-next-line no-console
            console.warn(
              "[useLayerRegistrySync] no FeatureCollection for data layer, cannot restyle",
              change.id,
            );
            continue;
          }
          applyStyleToMap(
            map,
            change.id,
            change.prevStyle,
            change.nextStyle,
            inferGeometryType(fc),
          );
        }
      }

      // P2 — map membership follows the registry's set of data-layer ids.
      // Removals first: a hydrate() that swaps documents both drops old ids and
      // adds new ones, and MapLibre won't drop a source a layer still uses.
      if (map && idChanges.removed.length > 0) {
        removeDataLayersFromMap(map, idChanges.removed);
      }
      // Adds go through reconcile, which skips ids already on the map — the
      // import and convert paths add to the map *before* registering.
      if (map && idChanges.added.length > 0) {
        reconcileDataLayers(
          map,
          state.entries,
          useDataLayerFCStore.getState().getAll(),
          rasterUrlSnapshot(),
        );
      }
      // P3 — restack. Needed after a reorder, and also after add/remove:
      // reconcile appends to the top of the style regardless of where the entry
      // sits in the registry array. applyOrderToMap diffs against the live
      // style, so a call that has nothing to fix issues no moveLayer.
      if (
        map &&
        (idChanges.orderChanged ||
          idChanges.added.length > 0 ||
          idChanges.removed.length > 0)
      ) {
        applyOrderToMap(map, state.entries);
      }

      for (const entry of flips) {
        if (entry.kind === "data") {
          if (!map) {
            continue;
          }
          applyVisibilityToMap(map, entry.id, entry.visible);
        }
      }
    });
    return unsub;
  }, [map]);
}
