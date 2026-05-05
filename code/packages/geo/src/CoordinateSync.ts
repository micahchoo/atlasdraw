// packages/geo/src/CoordinateSync.ts
// SPDX-License-Identifier: MIT
// Phase 1 Wave 1 Task 4 — CoordinateSync orchestrator.
//
// Per plan/contract:
//   constructor(opts: { map, excalidrawAPI })
//   attach() / detach()         — listener lifecycle (skeleton; subscription
//                                  wiring lives in useCoordinateSync hook, Task 12)
//   syncMapToScene()            — re-project all geo-anchored elements; the
//                                  hot-path called on every camera event
//
// Wave 2 (Tasks 5/6/7) fills in the bbox/polyline arms of `_projectElement`.

import type { Map as MapLibreMap } from "maplibre-gl";
import { isGeoCustomData, type GeoCustomData } from "./types.js";
import { projectPoint } from "./projection.js";
import { computeScaleFactor, clampHybridFactor } from "./scaleMode.js";

// ---------------------------------------------------------------------------
// Excalidraw API surface (structural, decoupled from @excalidraw types)
// ---------------------------------------------------------------------------

/**
 * Minimal element shape syncMapToScene reads/writes. The geo package does NOT
 * depend on @excalidraw — consumers pass a value compatible with this shape.
 *
 * Invariant: `customData.geo` is read but never mutated; `x/y/width/height/points`
 * are the only fields written.
 */
export interface ExcalidrawElementLike {
  id: string;
  x: number;
  y: number;
  width?: number;
  height?: number;
  points?: ReadonlyArray<readonly [number, number]>;
  customData?: unknown;
  // Accept additional fields untouched.
  [k: string]: unknown;
}

/**
 * Minimal Excalidraw API surface required by `syncMapToScene`. Mirrors
 * `getSceneElements` and `updateScene` from `@excalidraw/excalidraw`'s
 * `ExcalidrawImperativeAPI` without coupling to the editor package.
 */
export interface ExcalidrawAPI {
  getSceneElements(): ReadonlyArray<ExcalidrawElementLike>;
  updateScene(opts: {
    elements: ReadonlyArray<ExcalidrawElementLike>;
    captureUpdate: "NEVER" | "IMMEDIATELY" | "EVENTUALLY";
  }): void;
}

// ---------------------------------------------------------------------------
// CoordinateSync
// ---------------------------------------------------------------------------

export interface CoordinateSyncOptions {
  map: MapLibreMap;
  excalidrawAPI: ExcalidrawAPI;
}

/**
 * CoordinateSync bridges a MapLibre `Map` and Excalidraw scene coordinates.
 *
 * ### Lifecycle
 * 1. Construct with `{ map, excalidrawAPI }` once Excalidraw + Map are both ready.
 * 2. Call `attach()` to mark sync as active (Task 12's hook drives `syncMapToScene`).
 * 3. Call `detach()` on unmount.
 *
 * ### Hot path
 * `syncMapToScene()` reads the current scene, re-projects every element with
 * `customData.geo` to current camera-projected pixel coordinates, and pushes
 * the result back via `updateScene({ elements, captureUpdate: "never" })`. The
 * `captureUpdate: "never"` is load-bearing — without it every camera event
 * pollutes the undo stack.
 *
 * The 16ms throttle that gates this method is owned by `useCoordinateSync`
 * (Phase 1 Task 12), keeping CoordinateSync transport-agnostic.
 *
 * @see docs/architecture/subsystems/geo/contracts.md
 * @see docs/architecture/subsystems/geo/behavior.md
 */
export class CoordinateSync {
  private readonly _map: MapLibreMap;
  private readonly _excalidrawAPI: ExcalidrawAPI;
  private _attached = false;

  constructor(opts: CoordinateSyncOptions) {
    this._map = opts.map;
    this._excalidrawAPI = opts.excalidrawAPI;
  }

  /**
   * Mark the sync as active. Per Phase 1 plan Task 12, the camera-event
   * subscription itself lives in `useCoordinateSync` so the throttle composes
   * cleanly with React lifecycle. This method is the documented seam for
   * subscription work to migrate inward in a later phase.
   */
  attach(): void {
    this._attached = true;
  }

  /** Mark the sync as inactive. Idempotent. */
  detach(): void {
    this._attached = false;
  }

  /** Whether `attach()` has been called more recently than `detach()`. */
  get isAttached(): boolean {
    return this._attached;
  }

  /**
   * Re-project all geo-anchored elements in the current scene to the camera's
   * current pixel positions. Elements without `customData.geo` are passed
   * through unchanged. Always emits `captureUpdate: "never"`.
   *
   * Hot-path. Performance budget: <8ms p95 on 5k elements (Phase 1 Task 16
   * benchmark). No allocations in the inner loop where possible.
   */
  syncMapToScene(): void {
    const elements = this._excalidrawAPI.getSceneElements();
    const projected = elements.map((el) =>
      isGeoCustomData(el.customData) ? this._projectElement(el) : el,
    );
    this._excalidrawAPI.updateScene({
      elements: projected,
      captureUpdate: "NEVER",
    });
  }

  // ---------------------------------------------------------------------------
  // Private — projectElement switch
  // ---------------------------------------------------------------------------

  /**
   * Project a single element with `customData.geo` to scene-space.
   *
   * - point: `(x, y) = map.project([lng, lat])`; el.width/height untouched.
   * - bbox: NW + SE corners projected → x/y/width/height; width/height clamped
   *   to >= 1 (guards rotated/pitched cameras that would invert the span).
   * - polyline: all coordinates projected; first projected point is the origin
   *   (x, y) and points are stored relative to it (Excalidraw convention —
   *   later points may have negative offsets).
   *
   * NOTE — `customData.scaleMode` is **wired** as of Phase 2 Wave 4 Task T17
   * (closes seed atlasdraw-375a). Behavior matrix per spec §3.4:
   *
   *   point      + screen      x,y projected; el.width/el.height untouched.
   *   point      + geographic  x,y projected; width/height scaled by `factor`
   *                            where `factor = 2^(currentZoom - zRef)`.
   *   point      + hybrid      same as geographic, factor clamped to [0.25, 4.0].
   *   bbox       + geographic  x,y from NW; width/height = projected span (>=1).
   *   bbox       + screen      x,y from NW; width/height = el.width/el.height
   *                            (stored screen-space override).
   *   bbox       + hybrid      x,y from NW; width/height = projected span scaled
   *                            by `clamp(factor, 0.25, 4.0)`.
   *   polyline   + geographic  all coords projected, points relative to first.
   *   polyline   + screen      x,y from projected first coord; points = el.points.
   *   polyline   + hybrid      all coords projected, points relative to first,
   *                            each offset multiplied by `clamp(factor, 0.25, 4.0)`.
   *
   * `factor = 2^(currentZoom - zRef)` reflects MapLibre's per-zoom-level 2× scale.
   * At currentZoom == zRef, factor == 1 (identity).
   *
   * Invariant: input element's `customData` is never mutated; the returned
   * element is a shallow clone with overwritten `x/y/width/height/points`.
   */
  private _projectElement(el: ExcalidrawElementLike): ExcalidrawElementLike {
    const customData = el.customData as GeoCustomData;
    const anchor = customData.geo;
    const scaleMode = customData.scaleMode;
    // Precompute factor once; cheap and used by 6 of 9 (kind × mode) cells.
    const factor = computeScaleFactor(this._map.getZoom(), anchor.zRef);
    switch (anchor.kind) {
      case "point": {
        const { x, y } = projectPoint(this._map, anchor.lng, anchor.lat);
        if (scaleMode === "screen") {
          // Position-only update; width/height passed through untouched.
          return { ...el, x, y };
        }
        // geographic | hybrid — scale stored screen-size by factor.
        const f = scaleMode === "hybrid" ? clampHybridFactor(factor) : factor;
        const width = el.width !== undefined ? el.width * f : el.width;
        const height = el.height !== undefined ? el.height * f : el.height;
        return { ...el, x, y, width, height };
      }
      case "bbox": {
        const nw = projectPoint(this._map, anchor.west, anchor.north);
        if (scaleMode === "screen") {
          // Stored screen-space size overrides the projected span entirely;
          // only x/y track the geographic anchor.
          return { ...el, x: nw.x, y: nw.y };
        }
        const se = projectPoint(this._map, anchor.east, anchor.south);
        const projectedWidth = Math.max(1, se.x - nw.x);
        const projectedHeight = Math.max(1, se.y - nw.y);
        if (scaleMode === "hybrid") {
          const f = clampHybridFactor(factor);
          // Hybrid intent: projected span IS the geographic size. To bound
          // the apparent screen size at extreme zoom deltas, counter-scale
          // by f/factor (keeps geo behavior in-band, freezes outside it).
          const adj = f / factor;
          return {
            ...el,
            x: nw.x,
            y: nw.y,
            width: Math.max(1, projectedWidth * adj),
            height: Math.max(1, projectedHeight * adj),
          };
        }
        // geographic — current behavior, projected span as-is.
        return {
          ...el,
          x: nw.x,
          y: nw.y,
          width: projectedWidth,
          height: projectedHeight,
        };
      }
      case "polyline": {
        if (scaleMode === "screen") {
          // Project only the first coord; preserve stored screen-space points.
          const [first] = anchor.coordinates;
          if (!first) return { ...el };
          const origin = projectPoint(this._map, first[0], first[1]);
          return { ...el, x: origin.x, y: origin.y };
        }
        const projected = anchor.coordinates.map(([lng, lat]) =>
          projectPoint(this._map, lng, lat),
        );
        const origin = projected[0];
        if (!origin) return { ...el };
        const f = scaleMode === "hybrid" ? clampHybridFactor(factor) / factor : 1;
        const points = projected.map(
          (p) =>
            [(p.x - origin.x) * f, (p.y - origin.y) * f] as [number, number],
        );
        return { ...el, x: origin.x, y: origin.y, points };
      }
    }
  }
}
