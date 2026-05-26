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
 * `x/y/width/height/points` are the only fields written by projection.
 */
export interface ExcalidrawElementLike {
  id: string;
  x: number;
  y: number;
  width?: number;
  height?: number;
  fontSize?: number;
  strokeWidth?: number;
  points?: ReadonlyArray<readonly [number, number]>;
  customData?: unknown;
  [k: string]: unknown;
}

/**
 * Minimal Excalidraw API surface. Mirrors `getSceneElements` and `updateScene`
 * from `@excalidraw/excalidraw`'s `ExcalidrawImperativeAPI` without coupling.
 */
export interface ExcalidrawAPI {
  getSceneElements(): ReadonlyArray<ExcalidrawElementLike>;
  updateScene(opts: {
    elements: ReadonlyArray<ExcalidrawElementLike>;
    captureUpdate: "NEVER" | "IMMEDIATELY" | "EVENTUALLY";
  }): void;
}
