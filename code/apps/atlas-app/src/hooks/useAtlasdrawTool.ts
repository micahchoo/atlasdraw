// apps/atlas-app/src/hooks/useAtlasdrawTool.ts
// SPDX-License-Identifier: AGPL-3.0-only
// The atlas-side dispatcher for AtlasdrawTool instances.
//
// PinTool (and future tools) live in @atlasdraw/tools as plain objects. They
// don't register with Excalidraw's tool system (v0.18 has no `customTools`
// prop). This hook owns the active-tool state and the ToolContext factory
// that gives each tool access to map / scene / ui.
//
// Lifecycle:
//   user clicks Pin button   → setActiveAtlasTool(PinTool)
//   user clicks map          → MapEditor's overlay calls dispatchPointerDown
//                              → activeAtlasTool.onPointerDown(e, ctx)
//                              → setActiveAtlasTool(null)        // one-shot
//   activeAtlasTool === null → overlay is unmounted, map gets pointer events
//
// One-shot semantics: each Pin button click places exactly one pin. To place
// multiple pins, click the button between each placement. This matches stock
// Excalidraw's "one shape, then back to selection" behaviour.

import { useCallback, useMemo } from "react";
import { useStore } from "zustand";

import { CaptureUpdateAction, syncInvalidIndices } from "@atlasdraw/element";

import type { ExcalidrawImperativeAPI } from "@atlasdraw/excalidraw";

import type { WorldFrame } from "@atlasdraw/geo";

import type {
  AtlasdrawTool,
  AtlasdrawElementSeed,
  ToolContext,
  ToolPointerEvent,
} from "@atlasdraw/tools";

import { seedToElement } from "../tools/seedToElement";
import { currentDocument } from "../state/document";

import type { ViewStore } from "../session/view";

import type * as maplibregl from "maplibre-gl";

export interface UseAtlasdrawToolResult {
  /** Currently active tool, or null when no atlas-tool is engaged. */
  activeAtlasTool: AtlasdrawTool | null;
  /** Setter — exposed so MapEditor's button can toggle. */
  setActiveAtlasTool: (t: AtlasdrawTool | null) => void;
  /** Forwarded by the interaction overlay on pointerdown. No-op if either dep is null. */
  dispatchPointerDown: (e: ToolPointerEvent) => void;
}

/**
 * Build a `ToolContext` that bridges a tool to the live MapLibre and Excalidraw
 * instances. A plain function, outside the React hook, so it can be
 * unit-tested with mocked deps (no React renderer required).
 *
 * @param map           - MapLibre Map instance.
 * @param excalidrawAPI - Excalidraw imperative API.
 * @param frame         - The open document's world frame, read per element.
 */
export function buildToolContext(
  map: Pick<
    maplibregl.Map,
    "project" | "unproject" | "getContainer" | "getZoom" | "getBounds"
  >,
  excalidrawAPI: ExcalidrawImperativeAPI,
  frame: () => WorldFrame = () => currentDocument().snapshot().world,
): ToolContext {
  return {
    map: {
      project: (lngLat) => {
        const p = map.project(lngLat);
        return { x: p.x, y: p.y };
      },
      unproject: (point) => {
        const container = map.getContainer();
        const rect = container.getBoundingClientRect();
        const ll = map.unproject([point[0] - rect.left, point[1] - rect.top]);
        return { lng: ll.lng, lat: ll.lat };
      },
      getZoom: () => map.getZoom(),
      getBounds: () => {
        const b = map.getBounds();
        return {
          getNorth: () => b.getNorth(),
          getSouth: () => b.getSouth(),
          getEast: () => b.getEast(),
          getWest: () => b.getWest(),
        };
      },
    },
    excalidraw: {
      addElement: (seed: AtlasdrawElementSeed) => {
        const newEl = seedToElement(seed, frame());
        // syncInvalidIndices assigns fractional indices to newly-inserted
        // elements (the seed factory leaves `index` undefined). Excalidraw's
        // Scene.replaceAllElements validates indices and throws
        // InvalidFractionalIndexError if any neighbor is unset. Mirror the
        // pattern used in code/packages/excalidraw/data/restore.ts:704.
        // Deleted elements stay in the scene: undo and collaboration need
        // them. Placing an element is a user action, so undo records it.
        const nextElements = syncInvalidIndices([
          ...excalidrawAPI.getSceneElementsIncludingDeleted(),
          newEl,
        ]);
        excalidrawAPI.updateScene({
          elements: nextElements,
          captureUpdate: CaptureUpdateAction.IMMEDIATELY,
        });
        return newEl.id;
      },
      getActiveTool: () =>
        excalidrawAPI.getAppState()?.activeTool?.type ?? "selection",
    },
    ui: {
      // Stubs: no tool shows a popup or a status message, so these only log.
      showPopup: (lngLat, content) => {
        // eslint-disable-next-line no-console
        console.info("[ui.showPopup]", lngLat, content);
      },
      setStatusBarMessage: (msg) => {
        // eslint-disable-next-line no-console
        console.info("[ui.statusBar]", msg);
      },
    },
  };
}

/**
 * useAtlasdrawTool — the active atlas tool (session view state) and a
 * dispatcher for the interaction overlay.
 *
 * @param view          - The session view that holds the active tool.
 * @param map           - MapLibre Map instance, or null while loading.
 * @param excalidrawAPI - Excalidraw imperative API, or null while loading.
 */
export function useAtlasdrawTool(
  view: ViewStore,
  map: maplibregl.Map | null,
  excalidrawAPI: ExcalidrawImperativeAPI | null,
): UseAtlasdrawToolResult {
  const activeAtlasTool = useStore(view, (s) => s.atlasTool);
  const setActiveAtlasTool = useStore(view, (s) => s.setAtlasTool);

  // ToolContext factory — re-built when (map, api) changes. The context is a
  // thin façade around the live deps; tools call its methods, never the deps
  // directly.
  const ctx = useMemo<ToolContext | null>(() => {
    if (!map || !excalidrawAPI) {
      return null;
    }
    return buildToolContext(map, excalidrawAPI);
  }, [map, excalidrawAPI]);

  const dispatchPointerDown = useCallback(
    (e: ToolPointerEvent) => {
      if (!activeAtlasTool || !ctx) {
        return;
      }
      activeAtlasTool.onPointerDown(e, ctx);
      // One-shot: deactivate after commit. Click the Pin button again to place
      // another. (See lifecycle docstring above.)
      setActiveAtlasTool(null);
    },
    [activeAtlasTool, ctx, setActiveAtlasTool],
  );

  return { activeAtlasTool, setActiveAtlasTool, dispatchPointerDown };
}
