// SPDX-License-Identifier: AGPL-3.0-only
// Phase 4 Wave 0 prereq (atlasdraw-3601) — persistence hydration.
//
// Inverse of `selectDocument`: take a freshly-loaded `AtlasdrawDocument`
// and apply it to the live runtime sources (Excalidraw scene, LayerRegistry,
// DataLayerFCStore). Called from both load-on-mount and the MainMenu Open
// handler in MapEditor.tsx.
//
// Idempotency contract: hydrate() is responsible for clearing prior state
// before applying the loaded doc. Callers can invoke it on a fresh mount
// (registry empty — no-op clear) or after the user has imported layers
// (registry non-empty — full clear). Either way the post-state matches the
// loaded document exactly.
//
// The post-hydrate `isDirty=false` reset is deferred to a microtask so it
// survives the synchronous markDirty() that fires from Excalidraw's onChange
// in response to updateScene. Without the deferral the indicator would
// re-flip to "dirty" the moment we hand the scene over.

import type { AtlasdrawDocument } from "@atlasdraw/data";
import type { ExcalidrawImperativeAPI } from "@excalidraw/excalidraw";

import { useLayerRegistryStore } from "./layerRegistry";
import { useDataLayerFCStore } from "./useDataLayerFCStore";
import { usePersistenceStore } from "./usePersistenceStore";

/**
 * Apply a loaded `AtlasdrawDocument` to the live editor state.
 *
 * Order:
 *   1. Reset registry + FC store so duplicates from a prior session vanish.
 *   2. Replay the manifest's layer entries through the registry actions
 *      (data layers also seed the FC store). Visibility is patched after the
 *      register call since `registerAnnotation` / `registerDataLayer` always
 *      stamp `visible: true`.
 *   3. Hand the scene to Excalidraw via `updateScene`.
 *   4. Microtask-defer `isDirty = false` so it lands AFTER Excalidraw's
 *      onChange-driven `markDirty()` from step 3.
 */
export function hydrate(
  loaded: AtlasdrawDocument,
  excalidrawAPI: ExcalidrawImperativeAPI,
): void {
  // Step 1 — clear prior runtime state (idempotent on a fresh mount).
  const registry = useLayerRegistryStore.getState();
  const priorIds = registry.entries.map((e) => e.id);
  for (const id of priorIds) {
    // remove() also drops the FC mirror per layerRegistry.ts:206 — kind-agnostic.
    registry.remove(id);
  }
  // Belt-and-braces: nuke any orphan FCs the registry didn't know about.
  useDataLayerFCStore.getState().clear();

  // Step 2 — replay manifest layer entries.
  for (const entry of loaded.manifest.layers) {
    if (entry.kind === "annotation") {
      registry.registerAnnotation(entry.id, entry.label);
    } else {
      const fc = loaded.layers.get(entry.id);
      if (!fc) {
        // Manifest claims a data layer but the FC blob isn't in the doc.
        // Skip rather than register a stub: the LayerPanel would show an
        // empty layer with no rendering recourse. Phase 5 may add a
        // placeholder UI for partial loads.
        // eslint-disable-next-line no-console
        console.warn(
          "[atlasdraw] hydrate: data layer missing FC, skipping",
          entry.id,
        );
        continue;
      }
      registry.registerDataLayer({
        id: entry.id,
        fc,
        label: entry.label,
        // entry.style is the persisted record; re-use as-is. The runtime
        // LayerStyle shape is kept liberal for forward-compat (mx-91343d).
        style: entry.style as unknown as Parameters<
          typeof registry.registerDataLayer
        >[0]["style"],
      });
    }
    if (!entry.visible) {
      // Both register actions stamp `visible: true`; correct in a follow-up.
      registry.setVisibility(entry.id, false);
    }
  }

  // Step 3 — hand scene to Excalidraw. The cast widens our structural
  // SceneElement[] to the canonical OrderedExcalidrawElement[] updateScene
  // expects; the persisted shape is whatever a prior session's
  // getSceneElements() returned, so the round-trip identity holds.
  excalidrawAPI.updateScene({
    elements: loaded.scene as unknown as Parameters<
      typeof excalidrawAPI.updateScene
    >[0]["elements"],
  });

  // Step 4 — clear the dirty flag AFTER the synchronous onChange that
  // updateScene fires (which would otherwise re-mark dirty). queueMicrotask
  // runs after the Excalidraw onChange callback resolves but before the next
  // frame, so the MainMenu indicator never blinks on.
  queueMicrotask(() => {
    usePersistenceStore.setState({ isDirty: false });
  });
}
