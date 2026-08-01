// packages/basemap/src/CoordinateSync.ts
// SPDX-License-Identifier: MIT
// Phase 1 Wave 1 Task 4 — CoordinateSync orchestrator.
// Moved from @atlasdraw/geo (2026-05-25): basemap is the natural home
// for a stateful class holding a MapLibre Map reference.
//
// Per plan/contract:
//   constructor(opts: { map, excalidrawAPI })
//   attach() / detach()         — listener lifecycle
//   syncMapToScene()            — re-project all geo-anchored elements
//
// Wave 2 (Tasks 5/6/7) fills in the bbox/polyline arms of `_projectElement`.

import {
  isGeoCustomData,
  projectPoint,
  computeScaleFactor,
  clampHybridFactor,
  cameraRotation,
} from "@atlasdraw/geo";

import type {
  GeoCustomData,
  ExcalidrawElementLike,
  ExcalidrawAPI,
} from "@atlasdraw/geo";

import type { Map as MapLibreMap } from "maplibre-gl";

// Re-export types for consumers who previously imported them from @atlasdraw/geo.
export type { ExcalidrawElementLike, ExcalidrawAPI };

// ---------------------------------------------------------------------------
// CoordinateSync
// ---------------------------------------------------------------------------

export interface CoordinateSyncOptions {
  map: MapLibreMap;
  excalidrawAPI: ExcalidrawAPI;
}

/** Axis-aligned screen rectangle, before any `angle` is applied. */
interface ScreenRect {
  x: number;
  y: number;
  width: number;
  height: number;
}

/**
 * The unrotated screen rectangle of a geographic bbox under a rotated camera.
 *
 * Mercator is conformal, so at pitch 0 the four corners of a geographic box
 * project to the four corners of a genuine rectangle, merely turned. Its side
 * lengths are the north and west edges; its centre is the midpoint of either
 * diagonal. Excalidraw renders that exactly, given `angle`.
 *
 * Costs two extra `project` calls per element, which is why callers take the
 * `nw`/`se`-only path whenever the camera is north-up.
 */
function rotatedBboxRect(
  map: MapLibreMap,
  anchor: { west: number; east: number; north: number; south: number },
  nw: { x: number; y: number },
  se: { x: number; y: number },
): ScreenRect {
  const ne = projectPoint(map, anchor.east, anchor.north);
  const sw = projectPoint(map, anchor.west, anchor.south);
  const width = Math.max(1, Math.hypot(ne.x - nw.x, ne.y - nw.y));
  const height = Math.max(1, Math.hypot(sw.x - nw.x, sw.y - nw.y));
  const cx = (nw.x + se.x) / 2;
  const cy = (nw.y + se.y) / 2;
  return { x: cx - width / 2, y: cy - height / 2, width, height };
}

export class CoordinateSync {
  private readonly _map: MapLibreMap;
  private readonly _excalidrawAPI: ExcalidrawAPI;
  private _attached = false;

  constructor(opts: CoordinateSyncOptions) {
    this._map = opts.map;
    this._excalidrawAPI = opts.excalidrawAPI;
  }

  attach(): void {
    this._attached = true;
  }

  detach(): void {
    this._attached = false;
  }

  get isAttached(): boolean {
    return this._attached;
  }

  syncMapToScene(): void {
    const elements = this._excalidrawAPI.getSceneElements();
    // One camera probe for the whole pass — rotation and zoom are properties
    // of the camera, not of any element (true at pitch 0, the only pitch we
    // allow).
    const cameraAngle = cameraRotation(this._map);
    const zoom = this._map.getZoom();
    const projected = elements.map((el) =>
      isGeoCustomData(el.customData)
        ? this._projectElement(el, cameraAngle, zoom)
        : el,
    );
    this._excalidrawAPI.updateScene({
      elements: projected,
      captureUpdate: "NEVER",
    });
  }

  /**
   * Where `syncMapToScene` would put this element under the current camera.
   *
   * Exists so drift detectors can ask the projector instead of re-deriving a
   * position from the anchor. Those two formulas diverged once and it cost the
   * user their drawing: the post-load check in `useExcalidrawChangeHandler`
   * projected a bbox's NW corner, which was exactly `x`/`y` until RT-2 made a
   * turned bbox the *centred* rotated rect (`cx - width/2`). Both are right;
   * they are not the same point. The 14px gap that opened at bearing 15° made
   * the check's corrective `syncNow()` unable to ever satisfy itself, and the
   * resulting cascade hit React's nested-update ceiling.
   *
   * Returns null for elements this sync does not own, so callers do not have
   * to repeat the `isGeoCustomData` test.
   *
   * Runs the writer rather than a copy of it — the answer cannot drift from
   * what `syncMapToScene` writes, because it *is* what `syncMapToScene` writes.
   */
  expectedOrigin(
    el: ExcalidrawElementLike,
  ): { readonly x: number; readonly y: number } | null {
    if (!isGeoCustomData(el.customData)) {
      return null;
    }
    const { x, y } = this._projectElement(
      el,
      cameraRotation(this._map),
      this._map.getZoom(),
    );
    return { x, y };
  }

  private _projectElement(
    el: ExcalidrawElementLike,
    cameraAngle: number,
    zoom: number,
  ): ExcalidrawElementLike {
    const customData = el.customData as GeoCustomData;
    const anchor = customData.geo;
    const scaleMode = customData.scaleMode;
    switch (anchor.kind) {
      case "point": {
        const { x, y } = projectPoint(this._map, anchor.lng, anchor.lat);
        if (scaleMode === "screen") {
          // Full snapshot (w/h/mode included) so reanchorIfMoved can use the
          // timing-immune primary path — a partial {x,y} forces the geo-space
          // fallback, which mis-detects camera moves as user moves.
          return {
            ...el,
            x,
            y,
            customData: {
              ...(el.customData as Record<string, unknown>),
              _lastSync: {
                x,
                y,
                w: el.width,
                h: el.height,
                mode: "screen",
              },
            },
          };
        }
        // Deferred below the screen arm: screen mode never reads the factor.
        const factor = computeScaleFactor(zoom, anchor.zRef);
        const f = scaleMode === "hybrid" ? clampHybridFactor(factor) : factor;
        const prevSync = (el.customData as Record<string, unknown>)
          ._lastSync as Record<string, unknown> | undefined;
        const w0 = (prevSync?.w0 as number | undefined) ?? el.width;
        const h0 = (prevSync?.h0 as number | undefined) ?? el.height;
        const fontSize0 =
          (prevSync?.fontSize0 as number | undefined) ?? el.fontSize;
        const strokeWidth0 =
          (prevSync?.strokeWidth0 as number | undefined) ?? el.strokeWidth;
        const width = w0 !== undefined ? w0 * f : undefined;
        const height = h0 !== undefined ? h0 * f : undefined;
        const fontSize = fontSize0 !== undefined ? fontSize0 * f : undefined;
        const strokeWidth =
          strokeWidth0 !== undefined ? strokeWidth0 * f : undefined;
        const newSync: Record<string, unknown> = {
          x,
          y,
          w: width,
          h: height,
          w0,
          h0,
          mode: scaleMode,
        };
        if (fontSize0 !== undefined) {
          newSync.fontSize0 = fontSize0;
          // Projected value as written — reanchorIfMoved compares against it
          // to detect user style edits without re-deriving from the camera.
          newSync.fs = fontSize;
        }
        if (strokeWidth0 !== undefined) {
          newSync.strokeWidth0 = strokeWidth0;
          newSync.sw = strokeWidth;
        }
        return {
          ...el,
          x,
          y,
          ...(width !== undefined ? { width } : {}),
          ...(height !== undefined ? { height } : {}),
          ...(fontSize !== undefined ? { fontSize } : {}),
          ...(strokeWidth !== undefined ? { strokeWidth } : {}),
          customData: {
            ...(el.customData as Record<string, unknown>),
            _lastSync: newSync,
          },
        };
      }
      case "bbox": {
        const nw = projectPoint(this._map, anchor.west, anchor.north);
        if (scaleMode === "screen") {
          // Full snapshot — see the point/screen arm.
          return {
            ...el,
            x: nw.x,
            y: nw.y,
            customData: {
              ...(el.customData as Record<string, unknown>),
              _lastSync: {
                x: nw.x,
                y: nw.y,
                w: el.width,
                h: el.height,
                mode: "screen",
              },
            },
          };
        }
        const se = projectPoint(this._map, anchor.east, anchor.south);
        const projectedWidth = Math.max(1, se.x - nw.x);
        const projectedHeight = Math.max(1, se.y - nw.y);
        // Deferred below the screen arm: screen mode never reads the factor.
        const factor = computeScaleFactor(zoom, anchor.zRef);
        // RT-2 covers the geographic arm only. "screen" and "hybrid" stay
        // axis-aligned — i.e. billboarded — under a rotated camera. Neither is
        // reachable from any creation path (geographic has been the only
        // creation mode since 2026-07-19); they exist to render documents
        // saved before that, and hybrid's clamp is applied about the NW corner
        // rather than the centre, which a rotation has nowhere to put.
        if (scaleMode === "hybrid") {
          const f = clampHybridFactor(factor);
          const adj = f / factor;
          const prevSync = (el.customData as Record<string, unknown>)
            ._lastSync as Record<string, unknown> | undefined;
          const strokeWidth0 =
            (prevSync?.strokeWidth0 as number | undefined) ?? el.strokeWidth;
          const strokeWidth =
            strokeWidth0 !== undefined ? strokeWidth0 * f : undefined;
          const nextSync: Record<string, unknown> = {
            x: nw.x,
            y: nw.y,
            w: Math.max(1, projectedWidth * adj),
            h: Math.max(1, projectedHeight * adj),
            mode: scaleMode,
          };
          if (strokeWidth0 !== undefined) {
            nextSync.strokeWidth0 = strokeWidth0;
            nextSync.sw = strokeWidth;
          }
          return {
            ...el,
            x: nw.x,
            y: nw.y,
            width: Math.max(1, projectedWidth * adj),
            height: Math.max(1, projectedHeight * adj),
            ...(strokeWidth !== undefined ? { strokeWidth } : {}),
            customData: {
              ...(el.customData as Record<string, unknown>),
              _lastSync: nextSync,
            },
          };
        }
        const prevSync = (el.customData as Record<string, unknown>)
          ._lastSync as Record<string, unknown> | undefined;
        const strokeWidth0 =
          (prevSync?.strokeWidth0 as number | undefined) ?? el.strokeWidth;
        const strokeWidth =
          strokeWidth0 !== undefined ? strokeWidth0 * factor : undefined;
        // RT-2. The user's own rotation is the baseline; the camera's rotation
        // is added on top, exactly as w0/h0 baselines relate to w/h. So a
        // camera turn never eats a rotation the user applied, and returning to
        // north restores it.
        const angle0 = (prevSync?.a0 as number | undefined) ?? el.angle;
        const angle =
          angle0 !== undefined || cameraAngle !== 0
            ? (angle0 ?? 0) + cameraAngle
            : undefined;
        const rect: ScreenRect =
          cameraAngle === 0
            ? {
                x: nw.x,
                y: nw.y,
                width: projectedWidth,
                height: projectedHeight,
              }
            : rotatedBboxRect(this._map, anchor, nw, se);
        const nextSync: Record<string, unknown> = {
          x: rect.x,
          y: rect.y,
          w: rect.width,
          h: rect.height,
          mode: scaleMode,
        };
        if (strokeWidth0 !== undefined) {
          nextSync.strokeWidth0 = strokeWidth0;
          nextSync.sw = strokeWidth;
        }
        if (angle !== undefined) {
          nextSync.a0 = angle0 ?? 0;
          nextSync.a = angle;
        }
        return {
          ...el,
          x: rect.x,
          y: rect.y,
          width: rect.width,
          height: rect.height,
          ...(angle !== undefined ? { angle } : {}),
          ...(strokeWidth !== undefined ? { strokeWidth } : {}),
          customData: {
            ...(el.customData as Record<string, unknown>),
            _lastSync: nextSync,
          },
        };
      }
      case "polyline": {
        if (scaleMode === "screen") {
          const [first] = anchor.coordinates;
          if (!first) {
            return { ...el };
          }
          const origin = projectPoint(this._map, first[0], first[1]);
          const screenPoints = el.points;
          if (!screenPoints || screenPoints.length === 0) {
            return {
              ...el,
              x: origin.x,
              y: origin.y,
              width: 1,
              height: 1,
              customData: {
                ...(el.customData as Record<string, unknown>),
                _lastSync: { x: origin.x, y: origin.y, mode: "screen" },
              },
            };
          }
          // Single pass, Math.min/max accumulators (they propagate NaN the
          // same way the previous `Math.max(...spread)` did, and a spread
          // throws past the engine argument limit on huge polylines).
          let sMinX = Infinity;
          let sMaxX = -Infinity;
          let sMinY = Infinity;
          let sMaxY = -Infinity;
          for (const p of screenPoints) {
            sMinX = Math.min(sMinX, p[0]);
            sMaxX = Math.max(sMaxX, p[0]);
            sMinY = Math.min(sMinY, p[1]);
            sMaxY = Math.max(sMaxY, p[1]);
          }
          return {
            ...el,
            x: origin.x,
            y: origin.y,
            width: Math.max(1, sMaxX - sMinX),
            height: Math.max(1, sMaxY - sMinY),
            customData: {
              ...(el.customData as Record<string, unknown>),
              // Full snapshot (pts/mode included) — see the point/screen arm.
              _lastSync: {
                x: origin.x,
                y: origin.y,
                pts: screenPoints.map((p) => [p[0], p[1]]),
                mode: "screen",
              },
            },
          };
        }
        const coords = anchor.coordinates;
        if (coords.length === 0) {
          return { ...el };
        }
        // Deferred below the screen arm: screen mode never reads the factor.
        const factor = computeScaleFactor(zoom, anchor.zRef);
        const f =
          scaleMode === "hybrid" ? clampHybridFactor(factor) / factor : 1;
        const strokeFactor =
          scaleMode === "hybrid" ? clampHybridFactor(factor) : factor;
        const prevSync = (el.customData as Record<string, unknown>)
          ._lastSync as Record<string, unknown> | undefined;
        const strokeWidth0 =
          (prevSync?.strokeWidth0 as number | undefined) ?? el.strokeWidth;
        const strokeWidth =
          strokeWidth0 !== undefined ? strokeWidth0 * strokeFactor : undefined;
        // One pass: project, offset-scale, and min/max together (previously
        // four intermediate arrays + two spreads per element). Math.min/max
        // accumulators keep the spreads' NaN propagation.
        const origin = projectPoint(this._map, coords[0][0], coords[0][1]);
        const points: [number, number][] = new Array(coords.length);
        let minX = Infinity;
        let maxX = -Infinity;
        let minY = Infinity;
        let maxY = -Infinity;
        for (let i = 0; i < coords.length; i++) {
          const p =
            i === 0
              ? origin
              : projectPoint(this._map, coords[i][0], coords[i][1]);
          const px = (p.x - origin.x) * f;
          const py = (p.y - origin.y) * f;
          points[i] = [px, py];
          minX = Math.min(minX, px);
          maxX = Math.max(maxX, px);
          minY = Math.min(minY, py);
          maxY = Math.max(maxY, py);
        }
        const nextSync: Record<string, unknown> = {
          x: origin.x,
          y: origin.y,
          pts: points,
          mode: scaleMode,
        };
        if (strokeWidth0 !== undefined) {
          nextSync.strokeWidth0 = strokeWidth0;
          nextSync.sw = strokeWidth;
        }
        return {
          ...el,
          x: origin.x,
          y: origin.y,
          points,
          width: Math.max(1, maxX - minX),
          height: Math.max(1, maxY - minY),
          ...(strokeWidth !== undefined ? { strokeWidth } : {}),
          customData: {
            ...(el.customData as Record<string, unknown>),
            _lastSync: nextSync,
          },
        };
      }
    }
  }
}
