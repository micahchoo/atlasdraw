// apps/atlas-app/src/hooks/useAtlasdrawTool.ts
// SPDX-License-Identifier: AGPL-3.0-only
// Phase 1 Wave 3b Task 14 — atlas-side dispatcher for AtlasdrawTool instances.
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

import { useCallback, useMemo, useState } from "react";
import type { ExcalidrawImperativeAPI } from "@excalidraw/excalidraw";
import type maplibregl from "maplibre-gl";
import type {
  AtlasdrawTool,
  AtlasdrawElementSeed,
  ToolContext,
  ToolPointerEvent,
} from "@atlasdraw/tools";
import { seedToElement } from "../tools/seedToElement";

export interface UseAtlasdrawToolResult {
  /** Currently active tool, or null when no atlas-tool is engaged. */
  activeAtlasTool: AtlasdrawTool | null;
  /** Setter — exposed so MapEditor's button can toggle. */
  setActiveAtlasTool: (t: AtlasdrawTool | null) => void;
  /** Forwarded by the interaction overlay on pointerdown. No-op if either dep is null. */
  dispatchPointerDown: (e: ToolPointerEvent) => void;
}

/**
 * useAtlasdrawTool — owns the active atlas-tool and exposes a dispatcher.
 *
 * @param map           - MapLibre Map instance, or null while loading.
 * @param excalidrawAPI - Excalidraw imperative API, or null while loading.
 */
export function useAtlasdrawTool(
  map: maplibregl.Map | null,
  excalidrawAPI: ExcalidrawImperativeAPI | null,
): UseAtlasdrawToolResult {
  const [activeAtlasTool, setActiveAtlasTool] =
    useState<AtlasdrawTool | null>(null);

  // ToolContext factory — re-built when (map, api) changes. The context is a
  // thin façade around the live deps; tools call its methods, never the deps
  // directly. This keeps tools postMessage-safe (Q11) for Phase 7 worker plugins.
  const ctx = useMemo<ToolContext | null>(() => {
    if (!map || !excalidrawAPI) return null;

    return {
      map: {
        project: (lngLat) => {
          const p = map.project(lngLat);
          return { x: p.x, y: p.y };
        },
        unproject: (point) => {
          const ll = map.unproject(point);
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
          const newEl = seedToElement(seed, map);
          excalidrawAPI.updateScene({
            elements: [...excalidrawAPI.getSceneElements(), newEl],
          });
          return newEl.id;
        },
        // Phase 1: PinTool doesn't use updateElement. Keep as a noisy stub so
        // future tools that try will surface a clear error during dev.
        updateElement: () => {
          throw new Error(
            "ctx.excalidraw.updateElement: not implemented in Phase 1",
          );
        },
        getActiveTool: () =>
          excalidrawAPI.getAppState()?.activeTool?.type ?? "selection",
      },
      ui: {
        // Phase 1 stubs — real popup UI lands Phase 2.
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
  }, [map, excalidrawAPI]);

  const dispatchPointerDown = useCallback(
    (e: ToolPointerEvent) => {
      if (!activeAtlasTool || !ctx) return;
      activeAtlasTool.onPointerDown(e, ctx);
      // One-shot: deactivate after commit. Click the Pin button again to place
      // another. (See lifecycle docstring above.)
      setActiveAtlasTool(null);
    },
    [activeAtlasTool, ctx],
  );

  return { activeAtlasTool, setActiveAtlasTool, dispatchPointerDown };
}
