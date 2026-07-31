// packages/geo/src/excalidrawTypes.ts
// SPDX-License-Identifier: MIT
//
// Minimal Excalidraw API surface consumed by CoordinateSync and other geo
// utilities. Decoupled from @excalidraw — consumers pass values compatible
// with these shapes. Previously lived in CoordinateSync.ts; extracted so
// other modules (bounds, excalidrawToGeo) can use them without depending on
// the CoordinateSync runtime class.

/**
 * Minimal element shape. `customData.geo` is read but never mutated;
 * `x/y/width/height/points/angle` are the fields written by projection.
 *
 * `angle` joined that list in RT-2 (2026-07-31). Under a rotated camera a
 * geographic bbox lands on screen as a rotated rectangle — Mercator is
 * conformal — and `angle` is how Excalidraw represents one. Projection only
 * ever writes the *camera* part of the rotation; a user's own rotation is
 * kept as the `_lastSync.a0` baseline and added back on top, the same way
 * `w0`/`h0` work for size.
 */
export interface ExcalidrawElementLike {
  id: string;
  x: number;
  y: number;
  width?: number;
  height?: number;
  /** Rotation in radians, y-down, about the element's centre. */
  angle?: number;
  fontSize?: number;
  strokeWidth?: number;
  points?: ReadonlyArray<readonly [number, number]>;
  customData?: unknown;
  [k: string]: unknown;
}

/**
 * Minimal Excalidraw API surface. Mirrors `getSceneElements` and `updateScene`
 * from `@atlasdraw/excalidraw`'s `ExcalidrawImperativeAPI` without coupling.
 */
export interface ExcalidrawAPI {
  getSceneElements(): ReadonlyArray<ExcalidrawElementLike>;
  updateScene(opts: {
    elements: ReadonlyArray<ExcalidrawElementLike>;
    captureUpdate: "NEVER" | "IMMEDIATELY" | "EVENTUALLY";
  }): void;
}
