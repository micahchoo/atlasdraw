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
//      position against map.project(anchor) and calling syncNow() if delta>10px.
//      The self-terminating property: after sync, el.x == map.project(anchor)
//      so delta==0 on the follow-up onChange.
//
// Extracted from MapEditor.tsx (DEADWOOD.md god-module split, Cut 5 — the
// hardest, done last: this callback fuses five previously-inline concerns
// (background intercept, scroll-lock/space-pan bridge, coordinate-sync
// consumer, autosave markDirty, aria-live selection announce) and owned six
// refs. `spaceHeldRef` stays owned by MapEditor and threaded in — it's also
// written by useMapEditorKeyboard (Cut 4). This callback was entirely
// uncovered before extraction; new useExcalidrawChangeHandler.test.ts adds
// characterization coverage per numbered sub-concern.

import { useCallback, useRef } from "react";

import { isGeoCustomData } from "@atlasdraw/geo";

import type {
  Excalidraw,
  ExcalidrawImperativeAPI,
} from "@atlasdraw/excalidraw";

import { usePersistenceStore } from "../state/usePersistenceStore";

import type { Dispatch, RefObject, SetStateAction } from "react";
import type maplibregl from "maplibre-gl";

export interface ExcalidrawChangeHandlerParams {
  excalidrawAPI: ExcalidrawImperativeAPI | null;
  map: maplibregl.Map | null;
  syncNow: (() => void) | undefined;
  announceMapEditor: (msg: string) => void;
  setMapBg: Dispatch<SetStateAction<string>>;
  spaceHeldRef: RefObject<boolean>;
}

export function useExcalidrawChangeHandler({
  excalidrawAPI,
  map,
  syncNow,
  announceMapEditor,
  setMapBg,
  spaceHeldRef,
}: ExcalidrawChangeHandlerParams): NonNullable<
  React.ComponentProps<typeof Excalidraw>["onChange"]
> {
  // Tracks the prior elements array reference so this handler can skip
  // markDirty when Excalidraw fires onChange without an actual element
  // mutation (initial mount, viewport-only updates, scroll-lock self-fires).
  // Closes atlasdraw-12f0 — the "● Unsaved" indicator no longer trips on
  // first load before the user has done anything.
  const prevElementsRef = useRef<readonly unknown[] | null>(null);
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
          appState: { scrollX: 0, scrollY: 0, zoom: { value: 1 } },
        });
        return;
      }

      // --- 3. Post-load geo sync (scroll is identity here) ---
      if (map && syncNow) {
        for (const el of elements) {
          const cd = (el as { customData?: unknown }).customData;
          if (!isGeoCustomData(cd)) {
            continue;
          }
          const anchor = cd.geo;
          const ref =
            anchor.kind === "point"
              ? map.project([anchor.lng, anchor.lat] as [number, number])
              : anchor.kind === "bbox"
              ? map.project([anchor.west, anchor.north] as [number, number])
              : map.project(anchor.coordinates[0] as [number, number]);
          if (
            Math.abs((el as { x: number }).x - ref.x) > 10 ||
            Math.abs((el as { y: number }).y - ref.y) > 10
          ) {
            syncNow();
          }
          break; // O(1): only inspect the first geo element
        }
      }

      // --- 4. T9 — mark persistence dirty (gated on real element mutation).
      // Excalidraw fires onChange on initial mount, viewport changes, scroll-
      // lock self-fires, and selection updates — none of which are user
      // edits. Mark dirty only when the elements reference actually changes
      // from the prior call, AND skip the first call (which establishes the
      // baseline). The underlying PersistenceStore debounces (5s) + ceilings
      // (30s) so the actual IDB write rate stays bounded.
      const prev = prevElementsRef.current;
      prevElementsRef.current = elements;
      if (prev !== null && elements !== prev) {
        usePersistenceStore.getState().markDirty();
      }

      // --- 5. Phase 6 A14b — selection-change aria-live announcement.
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
    },
    // eslint-disable-next-line react-hooks/exhaustive-deps
    [excalidrawAPI, map, syncNow, announceMapEditor, setMapBg, spaceHeldRef],
  );
}
