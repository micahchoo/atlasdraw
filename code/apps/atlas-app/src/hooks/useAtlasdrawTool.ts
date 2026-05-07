// apps/atlas-app/src/hooks/useAtlasdrawTool.ts
// SPDX-License-Identifier: AGPL-3.0-only
// Phase 1 Wave 3b Task 14 — atlas-side dispatcher for AtlasdrawTool instances.
// Phase 2 Wave 1a (T-W1a-UPDATEEL) — real `updateElement` impl wired to
// `excalidrawAPI.updateScene` with at-this-moment geo→scene projection.
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
import { syncInvalidIndices } from "@excalidraw/element";
import type maplibregl from "maplibre-gl";
import { projectPoint } from "@atlasdraw/geo";
import type { GeoCustomData } from "@atlasdraw/geo";
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
 * Build a `ToolContext` that bridges a tool to the live MapLibre and Excalidraw
 * instances. Extracted from the React hook so it can be unit-tested with
 * mocked deps (no React renderer required) — mirrors the PinTool test pattern.
 *
 * @param map           - MapLibre Map instance.
 * @param excalidrawAPI - Excalidraw imperative API.
 */
export function buildToolContext(
  map: maplibregl.Map,
  excalidrawAPI: ExcalidrawImperativeAPI,
): ToolContext {
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
        // syncInvalidIndices assigns fractional indices to newly-inserted
        // elements (the seed factory leaves `index` undefined). Excalidraw's
        // Scene.replaceAllElements validates indices and throws
        // InvalidFractionalIndexError if any neighbor is unset. Mirror the
        // pattern used in code/packages/excalidraw/data/restore.ts:704.
        const nextElements = syncInvalidIndices([
          ...excalidrawAPI.getSceneElements(),
          newEl,
        ]);
        excalidrawAPI.updateScene({ elements: nextElements });
        return newEl.id;
      },
      updateElement: (id: string, patch: Partial<AtlasdrawElementSeed>) => {
        applyElementPatch(map, excalidrawAPI, id, patch);
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
    return buildToolContext(map, excalidrawAPI);
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

// ---------------------------------------------------------------------------
// updateElement implementation
// ---------------------------------------------------------------------------
//
// Why this lives here (not in seedToElement):
//   - seedToElement constructs a *new* ExcalidrawElement from a bare seed; it
//     owns Phase 1 type-shape constraints (currently pin-only).
//   - updateElement patches an *existing* element in place. The element type
//     was already chosen at addElement-time; we only touch the fields the
//     patch actually names.
//
// Coordination with useCoordinateSync:
//   useCoordinateSync wires MapLibre camera events (move/zoom/rotate/pitch) to
//   CoordinateSync.syncMapToScene which iterates every element with a
//   GeoCustomData wrapper and re-projects from `customData.geo` → x/y/points.
//   Therefore this function only needs to project at THIS MOMENT (the patch
//   site). The next camera tick will re-project everything anyway from the
//   updated `customData.geo`. Result: one source of truth (customData.geo),
//   no double-projection, no stale-frame race.
//
// Drag-preview pattern (T07/T08/T09 Wave 1b):
//   onPointerDown → id = ctx.excalidraw.addElement(seed)
//   onPointerMove → ctx.excalidraw.updateElement(id, { geo: newGeo, ... })
//   onPointerUp   → ctx.excalidraw.updateElement(id, { geo: finalGeo, ... })

function applyElementPatch(
  map: maplibregl.Map,
  excalidrawAPI: ExcalidrawImperativeAPI,
  id: string,
  patch: Partial<AtlasdrawElementSeed>,
): void {
  const elements = excalidrawAPI.getSceneElements();
  const idx = elements.findIndex((el: { id: string }) => el.id === id);
  if (idx === -1) {
    // Drag previews can race lifecycle (e.g. element removed mid-gesture).
    // Don't throw — just warn so devs notice during dev.
    // eslint-disable-next-line no-console
    console.warn(
      `ctx.excalidraw.updateElement: element id="${id}" not in scene; no-op.`,
    );
    return;
  }

  const target = elements[idx];
  const patched = patchElement(map, target, patch);

  const next = elements.slice();
  next[idx] = patched as (typeof elements)[number];
  excalidrawAPI.updateScene({ elements: syncInvalidIndices(next) });
}

/**
 * Pure patch builder — takes the live element and a `Partial<AtlasdrawElementSeed>`,
 * returns a new element with the patch applied. Geo is projected at this
 * moment (camera position read from `map`). Style and data are merged
 * field-by-field into the existing element. Does NOT mutate `target`.
 */
function patchElement(
  map: maplibregl.Map,
  target: Readonly<Record<string, unknown>>,
  patch: Partial<AtlasdrawElementSeed>,
): Record<string, unknown> {
  const next: Record<string, unknown> = { ...target };

  // --- geo: project & update spatial fields + customData.geo ----------------
  if (patch.geo !== undefined) {
    const geo = patch.geo;
    if (geo.kind === "point") {
      // Re-anchor the element so the projected point sits at its visual
      // center (matches seedToElement's pin convention: x/y = top-left,
      // width/height bounds the marker). For zero-size elements (e.g. text)
      // this collapses to {x: projected.x, y: projected.y}.
      const projected = projectPoint(map, geo.lng, geo.lat);
      const w = (target.width as number | undefined) ?? 0;
      const h = (target.height as number | undefined) ?? 0;
      next.x = projected.x - w / 2;
      next.y = projected.y - h / 2;
    } else if (geo.kind === "bbox") {
      const nw = projectPoint(map, geo.west, geo.north);
      const se = projectPoint(map, geo.east, geo.south);
      const x = Math.min(nw.x, se.x);
      const y = Math.min(nw.y, se.y);
      const width = Math.abs(se.x - nw.x);
      const height = Math.abs(se.y - nw.y);
      next.x = x;
      next.y = y;
      next.width = width;
      next.height = height;
    } else {
      // polyline — project each vertex, then express as element.x + LocalPoint[]
      const projected = geo.coordinates.map(([lng, lat]) =>
        projectPoint(map, lng, lat),
      );
      if (projected.length > 0) {
        const originX = projected[0].x;
        const originY = projected[0].y;
        next.x = originX;
        next.y = originY;
        // LocalPoint = [x, y] relative to element's (x, y); first is [0, 0].
        next.points = projected.map((p) => [
          p.x - originX,
          p.y - originY,
        ]);
      }
    }

    const existingCustomData = (target.customData ?? {}) as Partial<
      GeoCustomData & { _data?: Record<string, unknown> }
    >;
    const nextCustomData: GeoCustomData & { _data?: Record<string, unknown> } =
      {
        // Preserve projection + schemaVersion (do not let patches override).
        projection: "mercator",
        schemaVersion: 1,
        // scaleMode: prefer patch.scaleMode if present (handled below), else
        // existing, else "geographic" as the defensive fallback.
        scaleMode:
          patch.scaleMode ?? existingCustomData.scaleMode ?? "geographic",
        geo,
      };
    if (existingCustomData._data !== undefined) {
      nextCustomData._data = existingCustomData._data;
    }
    next.customData = nextCustomData;
  }

  // --- scaleMode (without a geo patch) --------------------------------------
  if (patch.scaleMode !== undefined && patch.geo === undefined) {
    const existingCustomData = (target.customData ?? {}) as Partial<
      GeoCustomData & { _data?: Record<string, unknown> }
    >;
    next.customData = {
      ...existingCustomData,
      projection: "mercator",
      schemaVersion: 1,
      scaleMode: patch.scaleMode,
    };
  }

  // --- style ----------------------------------------------------------------
  if (patch.style !== undefined) {
    if (patch.style.strokeColor !== undefined) {
      next.strokeColor = patch.style.strokeColor;
    }
    if (patch.style.fillColor !== undefined) {
      // AtlasdrawElementSeed names this `fillColor`; Excalidraw's element
      // field is `backgroundColor`. Map across the boundary here.
      next.backgroundColor = patch.style.fillColor;
    }
    if (patch.style.strokeWidth !== undefined) {
      next.strokeWidth = patch.style.strokeWidth;
    }
    if (patch.style.opacity !== undefined) {
      // Excalidraw stores opacity as 0-100; the seed contract is 0-1.
      next.opacity = Math.round(patch.style.opacity * 100);
    }
  }

  // --- data (free-form metadata, escaped under `_data`) ---------------------
  if (patch.data !== undefined) {
    const existingCustomData = (next.customData ?? target.customData ?? {}) as
      Record<string, unknown>;
    next.customData = {
      ...existingCustomData,
      _data: patch.data,
    };
  }

  // Excalidraw bumps `version` / `versionNonce` itself when it sees a new
  // element reference in updateScene's elements array. We don't touch them.
  return next;
}
