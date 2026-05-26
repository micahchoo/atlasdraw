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
    const projected = elements.map((el) =>
      isGeoCustomData(el.customData) ? this._projectElement(el) : el,
    );
    this._excalidrawAPI.updateScene({
      elements: projected,
      captureUpdate: "NEVER",
    });
  }

  private _projectElement(el: ExcalidrawElementLike): ExcalidrawElementLike {
    const customData = el.customData as GeoCustomData;
    const anchor = customData.geo;
    const scaleMode = customData.scaleMode;
    const factor = computeScaleFactor(this._map.getZoom(), anchor.zRef);
    switch (anchor.kind) {
      case "point": {
        const { x, y } = projectPoint(this._map, anchor.lng, anchor.lat);
        if (scaleMode === "screen") {
          return {
            ...el,
            x,
            y,
            customData: {
              ...(el.customData as Record<string, unknown>),
              _lastSync: { x, y },
            },
          };
        }
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
        };
        if (fontSize0 !== undefined) {
          newSync.fontSize0 = fontSize0;
        }
        if (strokeWidth0 !== undefined) {
          newSync.strokeWidth0 = strokeWidth0;
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
          return {
            ...el,
            x: nw.x,
            y: nw.y,
            customData: {
              ...(el.customData as Record<string, unknown>),
              _lastSync: { x: nw.x, y: nw.y },
            },
          };
        }
        const se = projectPoint(this._map, anchor.east, anchor.south);
        const projectedWidth = Math.max(1, se.x - nw.x);
        const projectedHeight = Math.max(1, se.y - nw.y);
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
          };
          if (strokeWidth0 !== undefined) {
            nextSync.strokeWidth0 = strokeWidth0;
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
        const nextSync: Record<string, unknown> = {
          x: nw.x,
          y: nw.y,
          w: projectedWidth,
          h: projectedHeight,
        };
        if (strokeWidth0 !== undefined) {
          nextSync.strokeWidth0 = strokeWidth0;
        }
        return {
          ...el,
          x: nw.x,
          y: nw.y,
          width: projectedWidth,
          height: projectedHeight,
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
                _lastSync: { x: origin.x, y: origin.y },
              },
            };
          }
          const sxs = screenPoints.map((p) => p[0]);
          const sys = screenPoints.map((p) => p[1]);
          return {
            ...el,
            x: origin.x,
            y: origin.y,
            width: Math.max(1, Math.max(...sxs) - Math.min(...sxs)),
            height: Math.max(1, Math.max(...sys) - Math.min(...sys)),
            customData: {
              ...(el.customData as Record<string, unknown>),
              _lastSync: { x: origin.x, y: origin.y },
            },
          };
        }
        const projected = anchor.coordinates.map(([lng, lat]) =>
          projectPoint(this._map, lng, lat),
        );
        const origin = projected[0];
        if (!origin) {
          return { ...el };
        }
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
        const points = projected.map(
          (p) =>
            [(p.x - origin.x) * f, (p.y - origin.y) * f] as [number, number],
        );
        const xs = points.map((p) => p[0]);
        const ys = points.map((p) => p[1]);
        const nextSync: Record<string, unknown> = {
          x: origin.x,
          y: origin.y,
          pts: points,
        };
        if (strokeWidth0 !== undefined) {
          nextSync.strokeWidth0 = strokeWidth0;
        }
        return {
          ...el,
          x: origin.x,
          y: origin.y,
          points,
          width: Math.max(1, Math.max(...xs) - Math.min(...xs)),
          height: Math.max(1, Math.max(...ys) - Math.min(...ys)),
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
