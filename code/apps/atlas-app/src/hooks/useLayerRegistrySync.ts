// SPDX-License-Identifier: AGPL-3.0-only
//
// useLayerRegistrySync — wires LayerRegistry state to actual rendering.
//
// Phase 2 W-A. The LayerRegistry shipped state-only in T11; this hook closes
// the loop in two directions:
//
//   1. Excalidraw → registry (Bug A): subscribes to excalidrawAPI.onChange and
//      diffs scene element IDs against the registry's annotation entries.
//      New element → registerAnnotation. Vanished element → remove.
//      Resize/drag/style changes are ignored — only the membership set drives
//      registry mutations (avoids a registry write per pointermove).
//
//   2. Registry → render (Bug B): subscribes to the Zustand store and watches
//      per-entry visibility transitions.
//        Annotation kind: rewrites the matching Excalidraw element's opacity
//          (0 to hide, original to show). Original opacity is stashed on
//          customData.atlasOriginalOpacity so multi-toggle round-trips.
//        Data layer kind: calls map.setLayoutProperty(id, 'visibility', ...).
//          Wrapped in try/catch — registry id may be out of sync with the
//          MapLibre style if the user removed the layer manually.
//
// Why opacity over isDeleted: isDeleted removes the element from the scene
// entirely; we want hidden elements to come back when re-toggled. opacity:0
// keeps the element addressable and round-trips cleanly.
//
// Two further registry→render gaps closed here (the registry was previously
// state-only for both, so the LayerPanel's controls lied about the map):
//
//   3. Style edits → paint (P1): `updateStyle(id, patch)` only mutates
//      `entry.style`. We diff the compiled paint block of the old and new
//      style and push `setPaintProperty` for the properties that actually
//      changed — see applyStyleToMap / diffStyles.
//
//   4. Data layers → map membership (P2): a MapLibre `setStyle()` drops every
//      custom source and layer, and a document reload (state/hydrate.ts)
//      repopulates the registry without ever touching the map. Registry
//      entries outlive the style, so map membership is diffed against the
//      registry's *set* of data-layer ids — added ids get reconciled onto the
//      map, vanished ids get removed from it. Geometry is read from the
//      DataLayerFCStore mirror, which exists precisely because MapLibre's
//      source storage can't be read back as a plain FeatureCollection.
//
//   5. Reorder → map z-order (P3): `reorder` permutes the registry array and
//      nothing else, so dragging a data layer used to change the panel and
//      leave the map untouched. A changed data-layer id sequence now drives
//      applyOrderToMap, which restacks the style with `moveLayer`.
//
// The core logic is exported as plain factory functions
// (buildSceneDiffHandler / applyVisibilityToScene / applyStyleToMap /
// diffVisibility / diffStyles / diffDataLayerIds) so tests can drive them
// without a React renderer — same convention as useGeoAnchor /
// useAtlasdrawTool (mx-8e3209). Everything that *writes* to the MapLibre style
// lives in ../lib/dataLayerRender, shared with the import and basemap-swap
// paths; this module owns the registry-snapshot diffs that decide when to call
// it.

import { useEffect, useRef } from "react";

import { isGeoCustomData, type GeoCustomData } from "@atlasdraw/geo";
import { compilePaint } from "@atlasdraw/basemap";

import type { ExcalidrawImperativeAPI } from "@atlasdraw/excalidraw";
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
// Loose scene-element shape — only the fields we read.
// We deliberately don't import the full ExcalidrawElement type; the hook only
// touches `id`, `isDeleted`, `opacity`, and `customData`. Tests can construct
// minimal fixtures matching this shape.
// ---------------------------------------------------------------------------

export interface SyncSceneElement {
  id: string;
  type?: string;
  isDeleted?: boolean;
  opacity?: number;
  customData?: Record<string, unknown>;
}

// ---------------------------------------------------------------------------
// Bug A — scene-diff handler factory.
// ---------------------------------------------------------------------------

export interface SceneDiffDeps {
  /** Mutable set of annotation IDs the registry currently knows about. */
  knownIds: Set<string>;
  /** Registry actions (a thin slice — we don't need the whole store). */
  registerAnnotation: (elementId: string, label?: string) => void;
  updateAnnotationLabel: (elementId: string, label: string) => void;
  remove: (id: string) => void;
  /**
   * Check whether an id already exists in the registry. Used as a
   * belt-and-suspenders guard against hydrate() races: hydrate adds
   * entries to the registry between knownIds seed and the first
   * onChange, so knownIds alone can't prevent duplicates.
   */
  existsInRegistry: (id: string) => boolean;
}

// ---------------------------------------------------------------------------
// Layer label generation
// ---------------------------------------------------------------------------

/**
 * Human-readable name for each Excalidraw element type used in layer labels.
 */
const TOOL_NAMES: Record<string, string> = {
  rectangle: "Rectangle",
  ellipse: "Ellipse",
  diamond: "Diamond",
  freedraw: "Freehand",
  arrow: "Arrow",
  line: "Line",
  text: "Text",
  image: "Image",
  frame: "Frame",
  embeddable: "Embed",
  iframe: "Embed",
  magicframe: "Frame",
  selection: "Selection",
};

/** Extract the approximate center from a GeoCustomData anchor. */
function geoCenter(customData: unknown): { lat: number; lng: number } | null {
  if (!isGeoCustomData(customData)) {
    return null;
  }
  const geo = (customData as GeoCustomData).geo;
  switch (geo.kind) {
    case "point":
      return { lat: geo.lat, lng: geo.lng };
    case "bbox":
      return {
        lat: (geo.north + geo.south) / 2,
        lng: (geo.east + geo.west) / 2,
      };
    case "polyline": {
      const first = geo.coordinates[0];
      return first ? { lng: first[0], lat: first[1] } : null;
    }
  }
}

/** Format coordinates as "40.7°N, 74.0°W". */
function formatLatLng(lat: number, lng: number): string {
  const latDir = lat >= 0 ? "N" : "S";
  const lngDir = lng >= 0 ? "E" : "W";
  return `${Math.abs(lat).toFixed(1)}°${latDir}, ${Math.abs(lng).toFixed(
    1,
  )}°${lngDir}`;
}

/**
 * Generate a layer label from an element's type and optional geo-anchor data.
 *
 * With geo:  "Rectangle near 40.7°N, 74.0°W"
 * Without:   "Rectangle"
 * Unknown type without geo: element id.
 */
export function generateLayerLabel(el: SyncSceneElement): string {
  const typeName = el.type ? TOOL_NAMES[el.type] ?? el.type : null;
  const center = geoCenter(el.customData);
  if (typeName && center) {
    return `${typeName} near ${formatLatLng(center.lat, center.lng)}`;
  }
  if (typeName) {
    return typeName;
  }
  return el.id;
}

/**
 * True when the label looks like it still needs geo enrichment — it has a
 * tool-name prefix but no " near " segment.
 */
function labelNeedsGeoEnrichment(label: string): boolean {
  return !label.includes(" near ");
}

// ---------------------------------------------------------------------------
// Bug A — scene-diff handler factory.
// ---------------------------------------------------------------------------

/**
 * Build the onChange callback that syncs scene-element membership into the
 * registry's annotation entries.
 *
 * Dedupe: only acts when the *set* of element IDs changes. Resize/drag/style
 * mutations on an existing element are no-ops here — the element id is still
 * in `knownIds`, so we skip.
 *
 * Filter: deleted elements (`isDeleted: true`) are treated as absent. This
 * matches Excalidraw's semantics — deleted elements remain in the scene array
 * for undo/history but are not visible. If the user undoes a deletion, the
 * element re-appears with isDeleted:false and we'll re-register it.
 *
 * Label enrichment: when an already-registered element later gains geo-anchor
 * data (stamped by useGeoAnchor on a subsequent onChange), the label is
 * updated to include the geographic area.
 *
 * Exported for unit testing.
 */
export function buildSceneDiffHandler(
  deps: SceneDiffDeps,
): (elements: readonly SyncSceneElement[]) => void {
  const { knownIds, registerAnnotation, updateAnnotationLabel, remove } = deps;
  return (elements) => {
    const incoming = new Set<string>();
    const elementById = new Map<string, SyncSceneElement>();
    for (const el of elements) {
      if (el.isDeleted) {
        continue;
      }
      incoming.add(el.id);
      elementById.set(el.id, el);
    }

    // Additions — in incoming but not known AND not already in registry.
    for (const id of incoming) {
      if (!knownIds.has(id) && !deps.existsInRegistry(id)) {
        const el = elementById.get(id);
        const label = el ? generateLayerLabel(el) : id;
        registerAnnotation(id, label);
        knownIds.add(id);
      }
    }

    // Label enrichment — update labels for known elements that now have geo
    // data but whose label was generated before the geo-anchor was stamped.
    for (const id of incoming) {
      if (knownIds.has(id)) {
        const el = elementById.get(id);
        if (!el) {
          continue;
        }
        const label = generateLayerLabel(el);
        if (!labelNeedsGeoEnrichment(label)) {
          // Label already includes geo — update it in case the element moved.
          updateAnnotationLabel(id, label);
        }
      }
    }

    // Removals — known but not incoming.
    for (const id of Array.from(knownIds)) {
      if (!incoming.has(id)) {
        remove(id);
        knownIds.delete(id);
      }
    }
  };
}

// ---------------------------------------------------------------------------
// Bug B — annotation visibility (opacity rewrite) factory.
// ---------------------------------------------------------------------------

/**
 * Stash key used on element.customData to remember the pre-hide opacity so
 * re-show can restore it. Namespaced to avoid collision with future custom
 * data fields.
 */
export const ATLAS_ORIGINAL_OPACITY_KEY = "atlasOriginalOpacity";

/**
 * Compute a new elements array where the element matching `entryId` has its
 * opacity adjusted to reflect `visible`.
 *
 *   visible:false → store current opacity in customData, set opacity:0.
 *   visible:true  → restore opacity from customData (default 100), drop the key.
 *
 * Idempotent: hiding an already-hidden element preserves the original stash
 * (won't overwrite with 0). Showing an already-visible element is a no-op.
 *
 * Returns a new array with a new object only for the matched element; all
 * other elements are referentially identical to the input. If no element
 * matches, returns the input array unchanged (referentially identical).
 *
 * Exported for unit testing.
 */
export function applyVisibilityToScene(
  elements: readonly SyncSceneElement[],
  entryId: string,
  visible: boolean,
): readonly SyncSceneElement[] {
  let matched = false;
  const next = elements.map((el) => {
    if (el.id !== entryId) {
      return el;
    }
    matched = true;

    const customData = { ...(el.customData ?? {}) };
    const currentOpacity = el.opacity ?? 100;
    const stashed = customData[ATLAS_ORIGINAL_OPACITY_KEY];

    if (visible) {
      // Show: restore from stash if present.
      if (stashed === undefined) {
        return el; // already visible, no-op
      }
      const restored = typeof stashed === "number" ? stashed : 100;
      delete customData[ATLAS_ORIGINAL_OPACITY_KEY];
      return { ...el, opacity: restored, customData };
    }

    // Hide: stash current opacity (only if not already stashed) and set to 0.
    if (stashed !== undefined) {
      // Already hidden; preserve original stash.
      if (currentOpacity === 0) {
        return el;
      }
      // Edge case: someone bumped opacity but left the stash. Re-apply 0.
      return { ...el, opacity: 0, customData };
    }
    customData[ATLAS_ORIGINAL_OPACITY_KEY] = currentOpacity;
    return { ...el, opacity: 0, customData };
  });
  return matched ? next : elements;
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
 * Wires LayerRegistry state to renderers — Excalidraw scene elements (annotations)
 * and MapLibre layer visibility (data layers).
 *
 * @param map            - MapLibre Map instance (null until map mounts)
 * @param excalidrawAPI  - Excalidraw imperative API (null until Excalidraw mounts)
 */
export function useLayerRegistrySync(
  map: maplibregl.Map | null,
  excalidrawAPI: ExcalidrawImperativeAPI | null,
): void {
  // ---- Bug A: scene-diff → registry ---------------------------------------
  // We hold the knownIds set in a ref so it survives re-renders while staying
  // tied to this hook instance. Resetting when excalidrawAPI changes is fine —
  // the Excalidraw mount is a one-time event in MapEditor.
  const knownIdsRef = useRef<Set<string>>(new Set());

  useEffect(() => {
    if (!excalidrawAPI) {
      return;
    }

    // Seed knownIds from the registry at mount so we don't double-register
    // entries that the registry already knows about (e.g. after a hot reload).
    const seedEntries = useLayerRegistryStore.getState().entries;
    knownIdsRef.current = new Set(
      seedEntries.filter((e) => e.kind === "annotation").map((e) => e.id),
    );

    const handler = buildSceneDiffHandler({
      knownIds: knownIdsRef.current,
      registerAnnotation: (id, label) =>
        useLayerRegistryStore.getState().registerAnnotation(id, label),
      updateAnnotationLabel: (id, label) =>
        useLayerRegistryStore.getState().updateAnnotationLabel(id, label),
      remove: (id) => useLayerRegistryStore.getState().remove(id),
      existsInRegistry: (id) =>
        useLayerRegistryStore.getState().entries.some((e) => e.id === id),
    });

    const unsub = excalidrawAPI.onChange(
      // The signature widens when typed against the canonical
      // ExcalidrawElement readonly array; our handler only reads the fields
      // declared on SyncSceneElement, so a structural cast is safe.
      handler as Parameters<ExcalidrawImperativeAPI["onChange"]>[0],
    );
    return unsub;
  }, [excalidrawAPI]);

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

  // ---- Bug B: registry → render -------------------------------------------
  // Zustand subscribe with a manual diff against the previous entries snapshot.
  // We don't use a selector-form subscriber because we need both the kind and
  // the visibility — selecting just `entries` and diffing in a useEffect would
  // re-fire on any unrelated mutation (label/order/style), wasting work.
  // Subscribe-style still re-fires on those, but we filter via diffVisibility /
  // diffStyles, which only report actual changes.
  useEffect(() => {
    if (!map && !excalidrawAPI) {
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
        if (entry.kind === "annotation") {
          if (!excalidrawAPI) {
            continue;
          }
          const scene = excalidrawAPI.getSceneElements();
          const next = applyVisibilityToScene(
            scene as readonly SyncSceneElement[],
            entry.id,
            entry.visible,
          );
          // Only call updateScene when something actually changed (referentially).
          if (next !== scene) {
            // updateScene's elements param is the canonical readonly
            // ExcalidrawElement[] — our SyncSceneElement is a structural
            // subset (only fields we touch). The element identity is
            // preserved for non-matched entries; the rewritten one keeps all
            // original fields via spread. Cast widens to the canonical type.
            excalidrawAPI.updateScene({
              elements: next as unknown as Parameters<
                typeof excalidrawAPI.updateScene
              >[0]["elements"],
            });
          }
        } else if (entry.kind === "data") {
          if (!map) {
            continue;
          }
          applyVisibilityToMap(map, entry.id, entry.visible);
        }
      }
    });
    return unsub;
  }, [map, excalidrawAPI]);
}
