// apps/atlas-app/src/tools/seedToElement.ts
// SPDX-License-Identifier: AGPL-3.0-only
// Phase 2 Wave 1a Task T-W1a-BRIDGE — AtlasdrawElementSeed → ExcalidrawElement bridge.
//
// Originally added in Phase 1 Wave 3b Task 14 for PinTool only. Phase 2 extends
// it to the full Wave 1b tool family (T03–T09): polygon, polyline, freehand,
// text, arrow, rectangle, circle.
//
// Tools emit minimal seeds (geo + scaleMode + optional data + optional style).
// This bridge:
//   1. Projects geographic coords → scene/pixel coords using the live MapLibre map.
//      - point  → single projectPoint call.
//      - bbox   → project NW + SE corners, take min/max for x/y/width/height.
//      - polyline → project every vertex; element x/y = first vertex; per-vertex
//        `points[i]` = projected[i] - origin (relative LocalPoint tuples).
//   2. Constructs a real `ExcalidrawElement` via the appropriate factory from
//      `@atlasdraw/element` (`newElement`, `newFreeDrawElement`,
//      `newLinearElement`, `newArrowElement`, `newTextElement`).
//   3. Stamps the full `GeoCustomData` wrapper (`projection: "mercator"`,
//      `schemaVersion: 1`) so `useCoordinateSync` recognizes it via
//      `isGeoCustomData()` and re-projects on every camera move.
//   4. Optional tool-supplied `seed.data` is preserved under the `_data` escape
//      key to avoid colliding with reserved GeoCustomData fields. This escape
//      is load-bearing — `useCoordinateSync` ignores unknown keys but the type
//      guard rejects unknown reserved-key values.
//
// Q11 boundary: this bridge is HOST code (atlas-app side); importing maplibregl
// + Excalidraw factories directly is fine. The Q11 ban applies to tool code
// (`packages/tools`), not to the host bridge.

import { projectPoint } from "@atlasdraw/geo";

import {
  newElement,
  newFreeDrawElement,
  newLinearElement,
  newArrowElement,
  newTextElement,
} from "@atlasdraw/element";

import { pointFrom } from "@atlasdraw/math";

import type {
  ExcalidrawElement,
  ExcalidrawLinearElement,
  ExcalidrawFreeDrawElement,
} from "@atlasdraw/element/types";
import type { LocalPoint } from "@atlasdraw/math";

import type { AtlasdrawElementSeed } from "@atlasdraw/tools";
import type { GeoCustomData } from "@atlasdraw/geo";

import type maplibregl from "maplibre-gl";

// ---------------------------------------------------------------------------
// Visual constants (Phase 2 — temporary defaults; full styling lands Phase 6)
// ---------------------------------------------------------------------------
const PIN_DIAMETER_PX = 16;
const PIN_STROKE_COLOR = "#1971c2";
const PIN_FILL_COLOR = "#74c0fc";

// CircleTool emits a center point with no explicit radius. Until that contract
// expands (CircleTool drag preview will updateElement with a real size), seed
// the ellipse at a marker-friendly default. CircleTool overwrites this on
// pointermove via ctx.excalidraw.updateElement.
const CIRCLE_DEFAULT_DIAMETER_PX = 40;

// TextLabelTool emits text at a point with no explicit width/height. Excalidraw
// will recompute via measureText once the element renders; we just need a
// non-zero placeholder so layout doesn't blow up. Real width/height comes from
// the text element factory's internal sizing (see newTextElement).
const TEXT_DEFAULT_FONT_SIZE = 20;

// ---------------------------------------------------------------------------
// Helpers
// ---------------------------------------------------------------------------

/** Project an array of [lng, lat] coords into scene-space tuples. */
function projectCoords(
  coords: ReadonlyArray<[number, number]>,
  map: maplibregl.Map,
): Array<{ x: number; y: number }> {
  return coords.map(([lng, lat]) => projectPoint(map, lng, lat));
}

/**
 * Convert projected scene-coords into element (x, y) origin + relative
 * `LocalPoint[]` (per Excalidraw's linear/freedraw convention: `points[0]` is
 * always [0, 0] and the element's x/y is the first vertex's scene position).
 */
function buildLinearGeometry(projected: Array<{ x: number; y: number }>): {
  x: number;
  y: number;
  points: LocalPoint[];
  width: number;
  height: number;
} {
  if (projected.length === 0) {
    throw new Error("seedToElement: linear/freedraw element needs >=1 point");
  }
  const x = projected[0].x;
  const y = projected[0].y;
  const points = projected.map((p) => pointFrom<LocalPoint>(p.x - x, p.y - y));
  // Bounding box of relative points (used for element width/height).
  let minX = 0;
  let minY = 0;
  let maxX = 0;
  let maxY = 0;
  for (const p of points) {
    if (p[0] < minX) {
      minX = p[0];
    }
    if (p[1] < minY) {
      minY = p[1];
    }
    if (p[0] > maxX) {
      maxX = p[0];
    }
    if (p[1] > maxY) {
      maxY = p[1];
    }
  }
  return {
    x,
    y,
    points,
    width: maxX - minX,
    height: maxY - minY,
  };
}

/** Build the full GeoCustomData wrapper (+ optional `_data` escape). */
function buildCustomData(seed: AtlasdrawElementSeed): GeoCustomData & {
  _data?: unknown;
} {
  const wrapper: GeoCustomData = {
    geo: seed.geo,
    scaleMode: seed.scaleMode,
    projection: "mercator",
    schemaVersion: 1,
  };
  return seed.data ? { ...wrapper, _data: seed.data } : wrapper;
}

// ---------------------------------------------------------------------------
// Bridge
// ---------------------------------------------------------------------------

/**
 * Convert a tool-emitted seed into a fully-realized Excalidraw element.
 *
 * @param seed - The seed produced by an `AtlasdrawTool.onPointerDown`.
 * @param map  - Live MapLibre map; used for geo→scene projection.
 * @returns A new `ExcalidrawElement` ready to splice into the scene.
 * @throws  When the (type, customType, geo.kind) tuple is not yet supported.
 */
export function seedToElement(
  seed: AtlasdrawElementSeed,
  map: maplibregl.Map,
): ExcalidrawElement {
  // ----------------------------------------------------------- custom: pin
  // Phase 1 PinTool branch — preserve byte-identically (no regression).
  if (seed.type === "custom" && seed.customType === "pin") {
    if (seed.geo.kind !== "point") {
      throw new Error(
        `seedToElement: pin requires geo.kind="point", got "${seed.geo.kind}"`,
      );
    }
    const { lng, lat } = seed.geo;
    const projected = projectPoint(map, lng, lat);
    const x = projected.x - PIN_DIAMETER_PX / 2;
    const y = projected.y - PIN_DIAMETER_PX / 2;
    const element = newElement({
      type: "ellipse",
      x,
      y,
      width: PIN_DIAMETER_PX,
      height: PIN_DIAMETER_PX,
      strokeColor: PIN_STROKE_COLOR,
      backgroundColor: PIN_FILL_COLOR,
      fillStyle: "solid",
      roughness: 0,
    });
    return { ...element, customData: buildCustomData(seed) };
  }

  // --------------------------------------------------------------- freedraw
  // T03 PolygonTool (closed-ring polyline) + T05 FreehandTool both produce
  // freedraw with geo.kind="polyline". Polygon's coordinates have first==last;
  // freehand's are open. The element type is identical either way; downstream
  // CoordinateSync re-projects every vertex so the closure invariant holds.
  if (seed.type === "freedraw") {
    if (seed.geo.kind !== "polyline") {
      throw new Error(
        `seedToElement: freedraw requires geo.kind="polyline", got "${seed.geo.kind}"`,
      );
    }
    const projected = projectCoords(seed.geo.coordinates, map);
    const { x, y, points, width, height } = buildLinearGeometry(projected);
    const element: ExcalidrawFreeDrawElement = newFreeDrawElement({
      type: "freedraw",
      x,
      y,
      width,
      height,
      points,
      simulatePressure: false,
      strokeColor: seed.style?.strokeColor ?? "#1e1e1e",
      backgroundColor: seed.style?.fillColor ?? "transparent",
      fillStyle: "solid",
    });
    return { ...element, customData: buildCustomData(seed) };
  }

  // ------------------------------------------------------------------ line
  // T04 PolylineTool — open multi-vertex line.
  if (seed.type === "line") {
    if (seed.geo.kind !== "polyline") {
      throw new Error(
        `seedToElement: line requires geo.kind="polyline", got "${seed.geo.kind}"`,
      );
    }
    const projected = projectCoords(seed.geo.coordinates, map);
    const { x, y, points, width, height } = buildLinearGeometry(projected);
    const element: ExcalidrawLinearElement = newLinearElement({
      type: "line",
      x,
      y,
      width,
      height,
      points,
      strokeColor: seed.style?.strokeColor ?? "#1e1e1e",
      backgroundColor: "transparent",
    });
    return { ...element, customData: buildCustomData(seed) };
  }

  // ----------------------------------------------------------------- arrow
  // T07 ArrowTool — 2-vertex (or more for elbow arrows) directed line.
  if (seed.type === "arrow") {
    if (seed.geo.kind !== "polyline") {
      throw new Error(
        `seedToElement: arrow requires geo.kind="polyline", got "${seed.geo.kind}"`,
      );
    }
    const projected = projectCoords(seed.geo.coordinates, map);
    const { x, y, points, width, height } = buildLinearGeometry(projected);
    const element = newArrowElement({
      type: "arrow",
      x,
      y,
      width,
      height,
      points,
      endArrowhead: "arrow",
      strokeColor: seed.style?.strokeColor ?? "#1e1e1e",
      backgroundColor: "transparent",
    });
    return { ...element, customData: buildCustomData(seed) };
  }

  // ------------------------------------------------------------- rectangle
  // T08 RectangleTool — bbox geo, axis-aligned in mercator.
  if (seed.type === "rectangle") {
    if (seed.geo.kind !== "bbox") {
      throw new Error(
        `seedToElement: rectangle requires geo.kind="bbox", got "${seed.geo.kind}"`,
      );
    }
    const { west, south, east, north } = seed.geo;
    // NW corner (west, north) and SE corner (east, south). In screen-space,
    // north has smaller y (top) than south. Mercator preserves NSEW alignment
    // so min/max gives the correct axis-aligned bbox regardless of orientation.
    const nw = projectPoint(map, west, north);
    const se = projectPoint(map, east, south);
    const x = Math.min(nw.x, se.x);
    const y = Math.min(nw.y, se.y);
    const width = Math.abs(se.x - nw.x);
    const height = Math.abs(se.y - nw.y);
    const element = newElement({
      type: "rectangle",
      x,
      y,
      width,
      height,
      strokeColor: seed.style?.strokeColor ?? "#1e1e1e",
      backgroundColor: seed.style?.fillColor ?? "transparent",
      fillStyle: "solid",
    });
    return { ...element, customData: buildCustomData(seed) };
  }

  // --------------------------------------------------------------- ellipse
  // T09 CircleTool — center point + default screen-pixel diameter (CircleTool
  // updateElement on pointermove will overwrite width/height with the real
  // drag-radius). Width === height enforced (radius is rotation-invariant).
  if (seed.type === "ellipse") {
    if (seed.geo.kind !== "point") {
      throw new Error(
        `seedToElement: ellipse requires geo.kind="point", got "${seed.geo.kind}"`,
      );
    }
    const { lng, lat } = seed.geo;
    const projected = projectPoint(map, lng, lat);
    const diameter = CIRCLE_DEFAULT_DIAMETER_PX;
    const x = projected.x - diameter / 2;
    const y = projected.y - diameter / 2;
    const element = newElement({
      type: "ellipse",
      x,
      y,
      width: diameter,
      height: diameter,
      strokeColor: seed.style?.strokeColor ?? "#1e1e1e",
      backgroundColor: seed.style?.fillColor ?? "transparent",
      fillStyle: "solid",
    });
    return { ...element, customData: buildCustomData(seed) };
  }

  // ------------------------------------------------------------------ text
  // T06 TextLabelTool — text at a single geo point. newTextElement handles
  // the width/height computation via measureText internally.
  if (seed.type === "text") {
    if (seed.geo.kind !== "point") {
      throw new Error(
        `seedToElement: text requires geo.kind="point", got "${seed.geo.kind}"`,
      );
    }
    const { lng, lat } = seed.geo;
    const projected = projectPoint(map, lng, lat);
    const text =
      typeof seed.data === "object" &&
      seed.data !== null &&
      typeof (seed.data as { text?: unknown }).text === "string"
        ? (seed.data as { text: string }).text
        : "";
    const element = newTextElement({
      x: projected.x,
      y: projected.y,
      text,
      fontSize: TEXT_DEFAULT_FONT_SIZE,
      strokeColor: seed.style?.strokeColor ?? "#1e1e1e",
      backgroundColor: "transparent",
    });
    return { ...element, customData: buildCustomData(seed) };
  }

  // -------------------------------------------------------------- fallback
  throw new Error(
    `seedToElement: unsupported (type="${seed.type}", customType="${
      seed.customType ?? ""
    }", geo.kind="${
      seed.geo.kind
    }") — extend the bridge before adding new tools.`,
  );
}
