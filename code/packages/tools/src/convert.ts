// packages/tools/src/convert.ts
// SPDX-License-Identifier: MPL-2.0
//
// A drawn element as GeoJSON: the one converter for "convert to data layer"
// and for the GeoJSON export.
//
// It reads the element's scene geometry (x, y, size, points and its own
// turn) and maps each vertex to lng/lat through the document's world frame
// (ADR-0015). The geometry is the shape as drawn on the map, turn included.
//
//   rectangle, image, frame, embed → Polygon (the four corners)
//   ellipse                        → Polygon (64 points on the ellipse)
//   diamond                        → Polygon (the four edge midpoints)
//   freedraw, closed               → Polygon
//   freedraw, open | line | arrow  → LineString
//   text, pin                      → Point (the centre)
//
// Convert-to-data-layer refuses text: a label is not a feature.

import {
  rotateAbout,
  shapeCenter,
  shapeOutline,
  toLngLat,
  type SceneShape,
  type ScenePoint,
  type WorldFrame,
} from "@atlasdraw/geo";

import type { Feature, FeatureCollection, Geometry, Position } from "geojson";

/** The element fields the converter reads. */
export type ConvertibleElement = SceneShape & {
  readonly id: string;
  readonly isDeleted?: boolean;
  readonly containerId?: string | null;
  readonly customData?: Record<string, unknown> | null;
};

/**
 * Thrown when an element type cannot be converted (text, or a type with no
 * geometry). The caller tells the user.
 */
export class UnsupportedConvertElementError extends Error {
  constructor(elementType: string) {
    super(
      `Element type ${JSON.stringify(
        elementType,
      )} cannot be converted to a data layer`,
    );
    this.name = "UnsupportedConvertElementError";
  }
}

const ELLIPSE_STEPS = 64;

/** A pin is an ellipse the pin tool made (`customData.tool`). */
function isPin(el: ConvertibleElement): boolean {
  return el.type === "ellipse" && el.customData?.tool === "pin";
}

function ring(frame: WorldFrame, pts: readonly ScenePoint[]): Position[] {
  const out = pts.map((p) => {
    const { lng, lat } = toLngLat(frame, p);
    return [lng, lat];
  });
  out.push(out[0]);
  return out;
}

function line(frame: WorldFrame, pts: readonly ScenePoint[]): Position[] {
  return pts.map((p) => {
    const { lng, lat } = toLngLat(frame, p);
    return [lng, lat];
  });
}

/** Points of the box shape, before the turn, then turned about the centre. */
function turned(el: ConvertibleElement, pts: ScenePoint[]): ScenePoint[] {
  const c = shapeCenter(el);
  return el.angle ? pts.map((p) => rotateAbout(p, c, el.angle!)) : pts;
}

/** The element's geometry in lng/lat, or null when its type has none. */
export function elementGeometry(
  el: ConvertibleElement,
  frame: WorldFrame,
): Geometry | null {
  if (el.type === "text" || isPin(el)) {
    const { lng, lat } = toLngLat(frame, shapeCenter(el));
    return { type: "Point", coordinates: [lng, lat] };
  }
  const w = el.width ?? 0;
  const h = el.height ?? 0;
  switch (el.type) {
    case "rectangle":
    case "image":
    case "frame":
    case "magicframe":
    case "embeddable":
    case "iframe":
      return { type: "Polygon", coordinates: [ring(frame, shapeOutline(el))] };
    case "diamond": {
      const mid = turned(el, [
        { x: el.x + w / 2, y: el.y },
        { x: el.x + w, y: el.y + h / 2 },
        { x: el.x + w / 2, y: el.y + h },
        { x: el.x, y: el.y + h / 2 },
      ]);
      return { type: "Polygon", coordinates: [ring(frame, mid)] };
    }
    case "ellipse": {
      const cx = el.x + w / 2;
      const cy = el.y + h / 2;
      const pts: ScenePoint[] = [];
      for (let i = 0; i < ELLIPSE_STEPS; i++) {
        const a = (2 * Math.PI * i) / ELLIPSE_STEPS;
        pts.push({
          x: cx + (w / 2) * Math.cos(a),
          y: cy + (h / 2) * Math.sin(a),
        });
      }
      return { type: "Polygon", coordinates: [ring(frame, turned(el, pts))] };
    }
    case "freedraw": {
      const pts = shapeOutline(el);
      const first = el.points?.[0];
      const last = el.points?.[el.points.length - 1];
      const closed =
        !!first && !!last && first[0] === last[0] && first[1] === last[1];
      if (closed && pts.length >= 4) {
        return {
          type: "Polygon",
          coordinates: [ring(frame, pts.slice(0, -1))],
        };
      }
      return { type: "LineString", coordinates: line(frame, pts) };
    }
    case "line":
    case "arrow":
      return { type: "LineString", coordinates: line(frame, shapeOutline(el)) };
    default:
      return null;
  }
}

/**
 * One element as a single-feature FeatureCollection, for a new data layer.
 *
 * @throws UnsupportedConvertElementError for text and for types with no geometry.
 */
export function annotationToFeatureCollection(
  el: ConvertibleElement,
  frame: WorldFrame,
): FeatureCollection {
  if (el.type === "text") {
    throw new UnsupportedConvertElementError(el.type);
  }
  const geometry = elementGeometry(el, frame);
  if (!geometry) {
    throw new UnsupportedConvertElementError(el.type);
  }
  return {
    type: "FeatureCollection",
    features: [{ type: "Feature", properties: {}, geometry }],
  };
}

/**
 * The whole drawing as GeoJSON: one feature per live element with geometry.
 * Text bound to a shape is part of the shape and is left out.
 */
export function drawingToFeatureCollection(
  elements: readonly ConvertibleElement[],
  frame: WorldFrame,
): FeatureCollection {
  const features: Feature[] = [];
  for (const el of elements) {
    if (el.isDeleted || el.containerId) {
      continue;
    }
    const geometry = elementGeometry(el, frame);
    if (geometry) {
      features.push({ type: "Feature", properties: {}, geometry });
    }
  }
  return { type: "FeatureCollection", features };
}
