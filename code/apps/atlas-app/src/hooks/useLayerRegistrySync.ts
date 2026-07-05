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
// The core logic is exported as plain factory functions
// (buildSceneDiffHandler / applyVisibilityToScene / applyVisibilityToMap) so
// tests can drive them without a React renderer — same convention as
// useGeoAnchor / useAtlasdrawTool (mx-8e3209).

import { useEffect, useRef } from "react";

import { isGeoCustomData, type GeoCustomData } from "@atlasdraw/geo";

import type { ExcalidrawImperativeAPI } from "@atlasdraw/excalidraw";

import {
  useLayerRegistryStore,
  type LayerRegistryEntry,
} from "../state/layerRegistry";

import type maplibregl from "maplibre-gl";

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
// Bug B — data-layer visibility (MapLibre setLayoutProperty) factory.
// ---------------------------------------------------------------------------

/**
 * Minimal MapLibre surface we touch — just `setLayoutProperty`. Lets tests
 * pass a stub without constructing a full Map.
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
      `[useLayerRegistrySync] setLayoutProperty failed for "${layerId}":`,
      err,
    );
  }
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

  // ---- Bug B: registry → render -------------------------------------------
  // Zustand subscribe with a manual diff against the previous entries snapshot.
  // We don't use a selector-form subscriber because we need both the kind and
  // the visibility — selecting just `entries` and diffing in a useEffect would
  // re-fire on any unrelated mutation (label/order/style), wasting work.
  // Subscribe-style still re-fires on those, but we filter via diffVisibility
  // which only reports actual visibility flips.
  useEffect(() => {
    if (!map && !excalidrawAPI) {
      return;
    }

    let prevEntries = useLayerRegistryStore.getState().entries;
    const unsub = useLayerRegistryStore.subscribe((state) => {
      const flips = diffVisibility(prevEntries, state.entries);
      prevEntries = state.entries;
      if (flips.length === 0) {
        return;
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
