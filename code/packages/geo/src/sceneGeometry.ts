// SPDX-License-Identifier: MIT
//
// The geometry of one drawn element in scene coordinates, as Excalidraw draws
// it: a box turned by `angle` about its centre, or a linear element's points
// turned about the centre of their box. Everything that turns a drawing into
// lng/lat (export, conversion, bounds, labels) reads it through here, then
// through the world frame.

import type { ScenePoint } from "./world.js";

/** The element fields scene geometry reads. */
export interface SceneShape {
  readonly type: string;
  readonly x: number;
  readonly y: number;
  readonly width?: number;
  readonly height?: number;
  /** Radians, y-down, about the centre. */
  readonly angle?: number;
  /** Linear elements only: points relative to x/y. */
  readonly points?: ReadonlyArray<readonly [number, number]>;
}

interface Box {
  minX: number;
  minY: number;
  maxX: number;
  maxY: number;
}

/** The unturned box. For a linear element, the box of its points. */
function shapeBox(el: SceneShape): Box {
  const pts = el.points;
  if (pts && pts.length > 0) {
    let minX = Infinity;
    let minY = Infinity;
    let maxX = -Infinity;
    let maxY = -Infinity;
    for (const [px, py] of pts) {
      minX = Math.min(minX, px);
      minY = Math.min(minY, py);
      maxX = Math.max(maxX, px);
      maxY = Math.max(maxY, py);
    }
    return {
      minX: el.x + minX,
      minY: el.y + minY,
      maxX: el.x + maxX,
      maxY: el.y + maxY,
    };
  }
  const w = el.width ?? 0;
  const h = el.height ?? 0;
  return {
    minX: Math.min(el.x, el.x + w),
    minY: Math.min(el.y, el.y + h),
    maxX: Math.max(el.x, el.x + w),
    maxY: Math.max(el.y, el.y + h),
  };
}

/** The point the element turns about. Turning does not move it. */
export function shapeCenter(el: SceneShape): ScenePoint {
  const b = shapeBox(el);
  return { x: (b.minX + b.maxX) / 2, y: (b.minY + b.maxY) / 2 };
}

/** Turn `p` about `c` by `angle` radians, y-down. */
export function rotateAbout(
  p: ScenePoint,
  c: ScenePoint,
  angle: number,
): ScenePoint {
  if (!angle) {
    return p;
  }
  const cos = Math.cos(angle);
  const sin = Math.sin(angle);
  const dx = p.x - c.x;
  const dy = p.y - c.y;
  return { x: c.x + dx * cos - dy * sin, y: c.y + dx * sin + dy * cos };
}

/**
 * The outline as drawn: a linear element's points, or the box corners in the
 * order NW, NE, SE, SW. Both are turned by `angle` about the centre.
 */
export function shapeOutline(el: SceneShape): ScenePoint[] {
  const angle = el.angle ?? 0;
  const c = shapeCenter(el);
  const pts = el.points;
  const raw: ScenePoint[] =
    pts && pts.length > 0
      ? pts.map(([px, py]) => ({ x: el.x + px, y: el.y + py }))
      : (() => {
          const w = el.width ?? 0;
          const h = el.height ?? 0;
          return [
            { x: el.x, y: el.y },
            { x: el.x + w, y: el.y },
            { x: el.x + w, y: el.y + h },
            { x: el.x, y: el.y + h },
          ];
        })();
  return angle ? raw.map((p) => rotateAbout(p, c, angle)) : raw;
}
