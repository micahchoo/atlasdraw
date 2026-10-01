// SPDX-License-Identifier: MIT
//
// Measure a drawn element on the ground.
//
// An edge of a drawn element is straight in the scene, so it is straight on
// the Mercator map, and that is the line the reader sees. A long edge is not
// a geodesic, so it is cut into pieces of at most 0.01° of longitude before
// each piece is measured as a geodesic (`measure.ts`). The result is the
// length and area of the shape as drawn, not of a shape with the same
// vertices and geodesic edges. For edges below a few kilometres the two
// agree to well under a millimetre.

import { areaOf, lengthOf } from "./measure.js";
import { rotateAbout, shapeCenter, shapeOutline } from "./sceneGeometry.js";
import { WORLD_TILE_SIZE, toLngLat } from "./world.js";

import type { LngLat } from "./measure.js";
import type { SceneShape } from "./sceneGeometry.js";
import type { ScenePoint, WorldFrame } from "./world.js";

/** The element fields measurement reads: scene geometry plus a closed line. */
export interface MeasurableShape extends SceneShape {
  /** A line element drawn as a closed polygon. */
  readonly polygon?: boolean;
}

/** What a drawn element measures, in metres and square metres. */
export type ShapeMeasure =
  | { readonly kind: "length"; readonly length: number }
  | {
      readonly kind: "area";
      readonly area: number;
      readonly perimeter: number;
      /** Ellipses only: the semi-axes along the element's own x and y. */
      readonly radii?: { readonly a: number; readonly b: number };
    };

/** Pieces an edge is cut into, at most, so a long edge stays cheap. */
const MAX_PIECES = 512;
/** Points on an ellipse's outline. */
const ELLIPSE_POINTS = 720;

/** Longest scene piece: 0.01° of longitude at the frame's zoom. */
function pieceLength(frame: WorldFrame): number {
  return (WORLD_TILE_SIZE * Math.pow(2, frame.z0)) / 36_000;
}

/** The vertices of a scene path with long edges cut, in lng/lat. */
function densify(
  frame: WorldFrame,
  pts: readonly ScenePoint[],
  closed: boolean,
): LngLat[] {
  const step = pieceLength(frame);
  const out: LngLat[] = [];
  const n = pts.length;
  const edges = closed ? n : n - 1;
  if (n > 0) {
    out.push(toLngLat(frame, pts[0]));
  }
  for (let i = 0; i < edges; i++) {
    const a = pts[i];
    const b = pts[(i + 1) % n];
    const pieces = Math.min(
      MAX_PIECES,
      Math.max(1, Math.ceil(Math.hypot(b.x - a.x, b.y - a.y) / step)),
    );
    for (let k = 1; k <= pieces; k++) {
      const t = k / pieces;
      out.push(
        toLngLat(frame, { x: a.x + (b.x - a.x) * t, y: a.y + (b.y - a.y) * t }),
      );
    }
  }
  return out;
}

/** Ground length of a scene path, metres. `closed` adds the closing edge. */
export function scenePathLength(
  frame: WorldFrame,
  pts: readonly ScenePoint[],
  closed = false,
): number {
  return pts.length < 2 ? 0 : lengthOf(densify(frame, pts, closed));
}

/** Ground area of a scene ring, m². */
export function sceneRingArea(
  frame: WorldFrame,
  ring: readonly ScenePoint[],
): number {
  return ring.length < 3 ? 0 : areaOf(densify(frame, ring, true));
}

function ringMeasure(
  frame: WorldFrame,
  ring: readonly ScenePoint[],
): ShapeMeasure {
  return {
    kind: "area",
    area: sceneRingArea(frame, ring),
    perimeter: scenePathLength(frame, ring, true),
  };
}

const samePoint = (a: ScenePoint, b: ScenePoint) => a.x === b.x && a.y === b.y;

function ellipseMeasure(frame: WorldFrame, el: SceneShape): ShapeMeasure {
  const c = shapeCenter(el);
  const rx = Math.abs(el.width ?? 0) / 2;
  const ry = Math.abs(el.height ?? 0) / 2;
  const angle = el.angle ?? 0;
  const at = (x: number, y: number) => rotateAbout({ x, y }, c, angle);
  const ring: ScenePoint[] = [];
  for (let i = 0; i < ELLIPSE_POINTS; i++) {
    const t = (2 * Math.PI * i) / ELLIPSE_POINTS;
    ring.push(at(c.x + rx * Math.cos(t), c.y + ry * Math.sin(t)));
  }
  // A semi-axis is half its whole axis: on the Mercator map the two halves
  // of a north-south axis are not the same length on the ground.
  const a = scenePathLength(frame, [at(c.x - rx, c.y), at(c.x + rx, c.y)]) / 2;
  const b = scenePathLength(frame, [at(c.x, c.y - ry), at(c.x, c.y + ry)]) / 2;
  return { ...ringMeasure(frame, ring), radii: { a, b } } as ShapeMeasure;
}

/**
 * What a drawn element measures on the ground: a length for an open line,
 * arrow or freehand line; an area and perimeter for a rectangle, diamond,
 * ellipse or closed line, and the semi-axes of an ellipse. Null for any other
 * element, and for a line with fewer than two points.
 */
export function measureShape(
  frame: WorldFrame,
  el: MeasurableShape,
): ShapeMeasure | null {
  switch (el.type) {
    case "line":
    case "arrow":
    case "freedraw": {
      const pts = shapeOutline(el);
      if (pts.length < 2) {
        return null;
      }
      const closed =
        el.type === "line" &&
        pts.length >= 3 &&
        (el.polygon === true || samePoint(pts[0], pts[pts.length - 1]));
      if (closed) {
        const ring = samePoint(pts[0], pts[pts.length - 1])
          ? pts.slice(0, -1)
          : pts;
        return ringMeasure(frame, ring);
      }
      return { kind: "length", length: scenePathLength(frame, pts) };
    }
    case "rectangle":
      return ringMeasure(frame, shapeOutline(el));
    case "diamond": {
      const [nw, ne, se, sw] = shapeOutline(el);
      const mid = (p: ScenePoint, q: ScenePoint) => ({
        x: (p.x + q.x) / 2,
        y: (p.y + q.y) / 2,
      });
      return ringMeasure(frame, [
        mid(nw, ne),
        mid(ne, se),
        mid(se, sw),
        mid(sw, nw),
      ]);
    }
    case "ellipse":
      return ellipseMeasure(frame, el);
    default:
      return null;
  }
}
