// SPDX-License-Identifier: AGPL-3.0-only
//
// Intercept ChangeCanvasBackground: keep Excalidraw transparent so the map
// shows through, and store the chosen color in mapBg for CSS + export.
//
// Also enforces identity scroll/zoom (scroll lock) and handles post-file-load
// sync. Two invariants that Atlas relies on:
//
//   1. Scroll lock — Excalidraw must keep scrollX=0, scrollY=0, zoom=1 so
//      that scene coordinates equal screen pixels. After file load, Excalidraw
//      calls scrollToContent which breaks this. We detect and immediately reset.
//      The geo sync runs on the following onChange once scroll is at identity.
//
//   2. Post-load sync — loading a .excalidraw file emits no camera events, so
//      geo-anchored elements stay at their canonical zoom-0 coordinates until
//      the user pans. We detect this by comparing the first geo element's scene
//      position against CoordinateSync.expectedOrigin() and calling syncNow()
//      if delta>10px. Termination rests on the check and the sync agreeing on
//      where an element belongs, which is why the reference comes from the
//      projector itself and not from a second projection here — that pair
//      diverged under a rotated camera and the "corrective" sync recursed
//      until React tore the scene down. driftSyncQueuedRef bounds it anyway.

import { useCallback, useRef } from "react";

import { isGeoCustomData } from "@atlasdraw/geo";

import type { ExcalidrawElementLike } from "@atlasdraw/geo";

import type {
  Excalidraw,
  ExcalidrawImperativeAPI,
} from "@atlasdraw/excalidraw";
import type { NormalizedZoomValue } from "@atlasdraw/excalidraw/types";

import { usePersistenceStore } from "../state/usePersistenceStore";
import { sceneSignature } from "../state/sceneSignature";
import { isOverlayId, useSelectedLayerStore } from "../state/selectedLayer";

import type { Dispatch, RefObject, SetStateAction } from "react";
import type maplibregl from "maplibre-gl";

export interface ExcalidrawChangeHandlerParams {
  excalidrawAPI: ExcalidrawImperativeAPI | null;
  map: maplibregl.Map | null;
  syncNow: (() => void) | undefined;
  expectedOrigin:
    | ((
        el: ExcalidrawElementLike,
      ) => { readonly x: number; readonly y: number } | null)
    | undefined;
  announceMapEditor: (msg: string) => void;
  setMapBg: Dispatch<SetStateAction<string>>;
  spaceHeldRef: RefObject<boolean>;
}

export function useExcalidrawChangeHandler({
  excalidrawAPI,
  map,
  syncNow,
  expectedOrigin,
  announceMapEditor,
  setMapBg,
  spaceHeldRef,
}: ExcalidrawChangeHandlerParams): NonNullable<
  React.ComponentProps<typeof Excalidraw>["onChange"]
> {
  // The scene signature at the previous onChange. Null until the first call,
  // which only sets the baseline.
  const prevSignatureRef = useRef<number | null>(null);
  // Guards against re-entrant updateScene calls. CoordinateSync fires many
  // onChange events before React can process our viewBackgroundColor reset;
  // without this flag each one queues another updateScene, exhausting
  // React's 50-update nesting limit.
  const bgResetQueuedRef = useRef(false);
  // True once Excalidraw has emitted at least one onChange with vbg ==
  // "transparent" (i.e. our initialData/reset has actually been applied).
  // Excalidraw v0.18 emits a default-vbg ("#ffffff") onChange on mount
  // BEFORE initialData lands — without this guard, setMapBg(default-white)
  // ran on every load, painting an opaque rectangle over the map.
  const transparentAppliedRef = useRef(false);
  // Same shape as bgResetQueuedRef, guarding the other self-retriggering
  // updateScene in this file — see sub-concern 3.
  const driftSyncQueuedRef = useRef(false);
  const prevSelectionIdsRef = useRef<string>("");
  const lastSelectionAnnounceAtRef = useRef<number>(0);

  return useCallback<
    NonNullable<React.ComponentProps<typeof Excalidraw>["onChange"]>
  >(
    (elements, appState) => {
      // --- 1. Background color intercept ---
      if (appState.viewBackgroundColor !== "transparent") {
        // Gate: only treat as a user color-pick after we've seen a transparent
        // state at least once (= our initialData/reset has been applied).
        // Otherwise the mount-time default `#ffffff` emit gets captured into
        // mapBg and paints an opaque rectangle over the map.
        if (transparentAppliedRef.current) {
          setMapBg(appState.viewBackgroundColor);
        }
        // Only queue one reset at a time. CoordinateSync fires many onChange
        // events (one per camera event) before React processes our setState;
        // without this guard each fires another updateScene, exhausting
        // React's 50-nested-update limit ("Maximum update depth exceeded").
        if (!bgResetQueuedRef.current) {
          bgResetQueuedRef.current = true;
          excalidrawAPI?.updateScene({
            appState: { viewBackgroundColor: "transparent" },
          });
        }
      } else {
        transparentAppliedRef.current = true;
        bgResetQueuedRef.current = false;
      }

      // --- 2. Scroll lock ---
      // After file load, Excalidraw calls scrollToContent setting non-zero
      // scrollX/Y. With non-zero scroll, `el.x + scrollX` ≠ `map.project(anchor).x`
      // so elements appear shifted from their geo positions and reanchorIfMoved
      // picks up false user-drag deltas. Reset to identity; geo sync runs next tick.
      //
      // Space+drag bridge: when space is held, Excalidraw pans by mutating
      // scrollX/Y. We forward the delta to map.panBy before resetting so the
      // map moves. scrollToContent delivers large single jumps (>200px) when
      // elements are loaded — those are NOT user pans, so we skip bridging
      // when the delta exceeds a sane per-frame ceiling.
      if (
        appState.scrollX !== 0 ||
        appState.scrollY !== 0 ||
        appState.zoom.value !== 1
      ) {
        if (
          spaceHeldRef.current &&
          (appState.scrollX !== 0 || appState.scrollY !== 0)
        ) {
          // Guard: scrollToContent jumps are typically >>100px in a single
          // onChange; a user drag within one frame stays well under 100px.
          const absDx = Math.abs(appState.scrollX);
          const absDy = Math.abs(appState.scrollY);
          if (absDx <= 100 && absDy <= 100) {
            map?.panBy([-appState.scrollX, -appState.scrollY], {
              animate: false,
            });
          }
        }
        excalidrawAPI?.updateScene({
          appState: {
            scrollX: 0,
            scrollY: 0,
            zoom: { value: 1 as NormalizedZoomValue },
          },
        });
        return;
      }

      // --- 3. Post-load geo sync (scroll is identity here) ---
      if (map && syncNow && expectedOrigin) {
        for (const el of elements) {
          if (!isGeoCustomData((el as { customData?: unknown }).customData)) {
            continue;
          }
          // Ask the projector, do not re-derive. A second formula for "where
          // this element belongs" is what broke this check: it projected a
          // bbox's NW corner, and RT-2 made a turned bbox the centred rotated
          // rect instead. See CoordinateSync.expectedOrigin.
          const ref = expectedOrigin(el as ExcalidrawElementLike);
          const drifted =
            ref !== null &&
            (Math.abs((el as { x: number }).x - ref.x) > 10 ||
              Math.abs((el as { y: number }).y - ref.y) > 10);
          // Containment, not correctness — the sister of bgResetQueuedRef
          // above, and here for the same reason. syncNow() fires the onChange
          // that runs this check again, so a reference the sync cannot satisfy
          // recurses without bound and takes out the scene. One corrective
          // sync per drift episode; re-armed once the drift clears.
          if (!drifted) {
            driftSyncQueuedRef.current = false;
          } else if (!driftSyncQueuedRef.current) {
            driftSyncQueuedRef.current = true;
            syncNow();
          }
          break; // O(1): only inspect the first geo element
        }
      }

      // --- 4. Mark the document dirty when the drawing changed ---
      // Excalidraw fires onChange for a mount, a camera move, a scroll-lock
      // reset and a selection. None of these change an element's version, so
      // compare version signatures, not array identity: a pan gives a new
      // array with the same versions. The first call sets the baseline.
      const signature = sceneSignature(elements);
      const prevSignature = prevSignatureRef.current;
      prevSignatureRef.current = signature;
      if (prevSignature !== null && signature !== prevSignature) {
        usePersistenceStore.getState().markDirty();
      }

      // --- 5. Selection-change aria-live announcement.
      // Compare the sorted selected-id set against the prior call. Throttled
      // to ≤1 announcement per 500ms so a rubber-band drag-select doesn't
      // spam the screen-reader queue.
      const selectedIds = Object.keys(appState.selectedElementIds ?? {})
        .sort()
        .join(",");
      if (selectedIds !== prevSelectionIdsRef.current) {
        prevSelectionIdsRef.current = selectedIds;
        const now = Date.now();
        if (
          selectedIds !== "" &&
          now - lastSelectionAnnounceAtRef.current >= 500
        ) {
          lastSelectionAnnounceAtRef.current = now;
          const ids = selectedIds.split(",");
          if (ids.length === 1) {
            const el = elements.find((e: { id: string }) => e.id === ids[0]) as
              | { type?: string }
              | undefined;
            announceMapEditor(`Selected: ${el?.type ?? "element"}`);
          } else {
            announceMapEditor(`Selected: ${ids.length} elements`);
          }
        }
      }

      // --- 6. Mirror annotation selection to layer store ---
      // Keep the panel's selectedLayerIds in step with what is selected on the
      // canvas. Only annotation ids (Excalidraw element ids) flow this way;
      // data/raster selections made from the panel are preserved. The
      // key-set comparison before writing breaks the feedback loop with
      // MapEditor's store→scene subscriber (a no-op write still notifies).
      // Every selected canvas id is an annotation: annotations are the
      // scene's elements. Data and raster ids carry a dl:/rl: prefix and are
      // selected only from the panel, so they are kept.
      const annotationIds: Record<string, true> = {};
      for (const id of Object.keys(appState.selectedElementIds ?? {})) {
        annotationIds[id] = true;
      }
      const storeState = useSelectedLayerStore.getState();
      const existing = { ...storeState.selectedLayerIds };
      for (const key of Object.keys(existing)) {
        if (!isOverlayId(key) && !annotationIds[key]) {
          delete existing[key];
        }
      }
      const merged = { ...existing, ...annotationIds };
      // Guard: only write if changed
      const currentKeys = Object.keys(storeState.selectedLayerIds)
        .sort()
        .join(",");
      const mergedKeys = Object.keys(merged).sort().join(",");
      if (currentKeys !== mergedKeys) {
        storeState.setSelectedLayerIds(merged);
      }
    },
    // eslint-disable-next-line react-hooks/exhaustive-deps
    [
      excalidrawAPI,
      map,
      syncNow,
      expectedOrigin,
      announceMapEditor,
      setMapBg,
      spaceHeldRef,
    ],
  );
}
