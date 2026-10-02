// SPDX-License-Identifier: AGPL-3.0-only
//
// Excalidraw's onChange, for the editor:
//
//   1. Keep Excalidraw transparent so the map shows through, and store a
//      chosen canvas color in mapBg for CSS and export.
//   2. Announce selection changes, and mirror the canvas selection into the
//      layer panel's selection.
//
// Whether the drawing changed is not decided here: an edit is a step in the
// editor's history (session/history.ts), which is what makes a map dirty.

import { useCallback, useRef } from "react";

import type {
  Excalidraw,
  ExcalidrawImperativeAPI,
} from "@atlasdraw/excalidraw";

import { isOverlayId } from "../state/selectedLayer";

import type { ViewStore } from "../session/view";

export interface ExcalidrawChangeHandlerParams {
  excalidrawAPI: ExcalidrawImperativeAPI | null;
  announceMapEditor: (msg: string) => void;
  /** Receives the canvas colour the user chose in the drawing's menu. */
  setMapBg: (color: string) => void;
  /** The session view whose layer selection follows the canvas. */
  view: ViewStore;
}

export function useExcalidrawChangeHandler({
  excalidrawAPI,
  announceMapEditor,
  setMapBg,
  view,
}: ExcalidrawChangeHandlerParams): NonNullable<
  React.ComponentProps<typeof Excalidraw>["onChange"]
> {
  // Guards against re-entrant updateScene calls. onChange can fire many times
  // (a camera move is one per frame) before React processes our
  // viewBackgroundColor reset; without this flag each one queues another
  // updateScene, exhausting React's 50-update nesting limit.
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
        // Only queue one reset at a time (see bgResetQueuedRef).
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

      // --- 2. Selection-change aria-live announcement.
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

      // --- 3. Mirror annotation selection to layer store ---
      // Keep the panel's selection in step with what is selected on the
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
      const viewState = view.getState();
      const existing = { ...viewState.selection };
      for (const key of Object.keys(existing)) {
        if (!isOverlayId(key) && !annotationIds[key]) {
          delete existing[key];
        }
      }
      const merged = { ...existing, ...annotationIds };
      // Guard: only write if changed
      const currentKeys = Object.keys(viewState.selection).sort().join(",");
      const mergedKeys = Object.keys(merged).sort().join(",");
      if (currentKeys !== mergedKeys) {
        viewState.setSelection(merged);
      }
    },
    [excalidrawAPI, announceMapEditor, setMapBg, view],
  );
}
