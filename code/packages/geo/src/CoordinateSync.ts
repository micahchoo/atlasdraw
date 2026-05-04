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
    captureUpdate: "never" | "immediately" | "eventually";
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
      captureUpdate: "never",
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
   * NOTE — `customData.scaleMode` is **currently unread** by `_projectElement`.
   * Per spec §3.4 the natural projection produces: point → `screen` (width/height
   * untouched), bbox/polyline → `geographic` (span scales with zoom via the
   * projection itself). Those happen to be the §3.4 defaults for Phase 1 demo
   * elements (Pin = point+screen ✓, Rectangle/Polygon = bbox+geographic ✓).
   * Non-default combinations — point+geographic, bbox+screen, polyline+screen,
   * and `hybrid` for any kind (the §3.4 default for arrow/freehand) — require
   * Task 8 (`computeScaleFactor` + per-kind override logic) before shipping.
   *
   * Invariant: input element's `customData` is never mutated; the returned
   * element is a shallow clone with overwritten `x/y/width/height/points`.
   */
  private _projectElement(el: ExcalidrawElementLike): ExcalidrawElementLike {
    const customData = el.customData as GeoCustomData;
    const anchor = customData.geo;
    switch (anchor.kind) {
      case "point": {
        const { x, y } = projectPoint(this._map, anchor.lng, anchor.lat);
        return { ...el, x, y };
      }
      case "bbox": {
        const nw = projectPoint(this._map, anchor.west, anchor.north);
        const se = projectPoint(this._map, anchor.east, anchor.south);
        const width = Math.max(1, se.x - nw.x);
        const height = Math.max(1, se.y - nw.y);
        return { ...el, x: nw.x, y: nw.y, width, height };
      }
      case "polyline": {
        const projected = anchor.coordinates.map(([lng, lat]) =>
          projectPoint(this._map, lng, lat),
        );
        const origin = projected[0];
        if (!origin) return { ...el };
        const points = projected.map(
          (p) => [p.x - origin.x, p.y - origin.y] as [number, number],
        );
        return { ...el, x: origin.x, y: origin.y, points };
      }
    }
  }
}
