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

import { syncInvalidIndices } from "@atlasdraw/element";

import type { ExcalidrawImperativeAPI } from "@atlasdraw/excalidraw";
import type { BinaryFileData, FileId, DataURL } from "@atlasdraw/excalidraw";

import type { AtlasdrawDocument } from "@atlasdraw/data";

import { useLayerRegistryStore } from "./layerRegistry";
import { useDataLayerFCStore } from "./useDataLayerFCStore";
import { useRasterImageStore } from "./useRasterImageStore";
import { useDocumentTitleStore } from "./documentTitle";
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
async function blobToDataURL(blob: Blob): Promise<string> {
  return new Promise((resolve, reject) => {
    const reader = new FileReader();
    reader.onload = () => resolve(reader.result as string);
    reader.onerror = () =>
      reject(reader.error ?? new Error("FileReader failed"));
    reader.readAsDataURL(blob);
  });
}

export async function hydrate(
  loaded: AtlasdrawDocument,
  excalidrawAPI: ExcalidrawImperativeAPI,
): Promise<void> {
  // Step 1 — clear prior runtime state (idempotent on a fresh mount).
  const registry = useLayerRegistryStore.getState();
  const priorIds = registry.entries.map((e) => e.id);
  for (const id of priorIds) {
    // remove() also drops the FC mirror per layerRegistry.ts:206 — kind-agnostic.
    registry.remove(id);
  }
  // Belt-and-braces: nuke any orphan FCs the registry didn't know about.
  useDataLayerFCStore.getState().clear();
  // FU-1: and the previous document's raster images. `clear` revokes every
  // object URL, which is the part that matters — opening five documents in a
  // session would otherwise hold every image any of them contained.
  useRasterImageStore.getState().clear();

  // Step 1b — adopt the loaded document's name. Without this the collar head
  // bar would keep showing the previous document's title and the next
  // auto-save would write it back over the one we just opened.
  useDocumentTitleStore.getState().setTitle(loaded.manifest.title);

  // Step 2 — replay manifest layer entries.
  for (const entry of loaded.manifest.layers) {
    if (entry.kind === "annotation") {
      registry.registerAnnotation(entry.id, entry.label);
      if (entry.renamedByUser) {
        // Same label, second call: registerAnnotation has no slot for the
        // flag, and renameLayer is the action that owns setting it. Follows
        // the setVisibility follow-up below rather than widening register's
        // signature with a positional boolean.
        registry.renameLayer(entry.id, entry.label);
      }
    } else if (entry.kind === "raster") {
      // FU-1. This branch exists before anything can write a raster into a
      // manifest, on purpose. What used to be here was a bare `else` that
      // treated EVERY non-annotation entry as a data layer — so the day the
      // schema grew a third kind, opening a document containing one would have
      // called registerDataLayer with no FeatureCollection, warned about a
      // missing FC blob, and skipped the layer. A silent wrong answer on the
      // load path, discovered by a user whose scanned sheet had vanished.
      //
      // The image itself rides in `loaded.files` alongside pasted canvas
      // images, keyed by the entry's imageKey. A manifest entry whose image is
      // missing is skipped for the same reason a data layer with no FC is: a
      // row in the panel that can never render is worse than an absent one.
      if (!loaded.files.has(entry.imageKey)) {
        // eslint-disable-next-line no-console
        console.warn(
          "[atlasdraw] hydrate: raster layer missing image, skipping",
          entry.id,
        );
        continue;
      }
      // Image into its store BEFORE the registry write, for the same reason
      // registerDataLayer mirrors its FC first: the registry subscriber
      // reconciles the new entry onto the map inside `set`, and it reads the
      // URL from this store. Written second, the reconcile finds a raster with
      // no image and skips it — a row in the panel and nothing on the map.
      useRasterImageStore
        .getState()
        .set(entry.id, loaded.files.get(entry.imageKey)!);
      registry.registerRasterLayer({
        id: entry.id,
        label: entry.label,
        corners: entry.corners,
        imageKey: entry.imageKey,
        opacity: entry.opacity,
        provenance: entry.provenance,
      });
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
        // Absent on documents written before provenance existed — the panel
        // shows "unknown source" rather than guessing from the label.
        provenance: entry.provenance,
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
  // Pass through syncInvalidIndices to repair any missing fractional
  // indices (e.g. from older docs persisted before T-3601 enforced them);
  // a no-op when indices are already valid (mirrors restore.ts:704 + closes
  // future recurrence of atlasdraw-27d8 on doc load).
  excalidrawAPI.updateScene({
    elements: syncInvalidIndices(
      loaded.scene as unknown as Parameters<typeof syncInvalidIndices>[0],
    ) as unknown as Parameters<typeof excalidrawAPI.updateScene>[0]["elements"],
  });

  // Step 4 — binary scene assets (images pasted into canvas).
  // `loaded.files` is Map<string, Blob>; Excalidraw's addFiles() wants
  // BinaryFileData[] with dataURL. Convert each Blob back to a dataURL.
  // Deferred from atlasdraw-3601; closes the "paste image → save → refresh
  // → image gone" gap.
  if (loaded.files.size > 0 && excalidrawAPI.addFiles) {
    const binaryFiles: BinaryFileData[] = await Promise.all(
      Array.from(loaded.files.entries()).map(async ([id, blob]) => {
        const dataURL = (await blobToDataURL(blob)) as DataURL;
        return {
          id: id as FileId,
          mimeType: (blob.type ||
            "application/octet-stream") as BinaryFileData["mimeType"],
          dataURL,
          created: Date.now(),
          lastRetrieved: Date.now(),
        };
      }),
    );
    excalidrawAPI.addFiles(binaryFiles);
  }

  // Step 5 — clear the dirty flag AFTER the synchronous onChange that
  // updateScene fires (which would otherwise re-mark dirty). queueMicrotask
  // runs after the Excalidraw onChange callback resolves but before the next
  // frame, so the MainMenu indicator never blinks on.
  queueMicrotask(() => {
    usePersistenceStore.setState({ isDirty: false });
  });
}
