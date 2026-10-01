// apps/atlas-app/src/tools/seedToElement.ts
// SPDX-License-Identifier: AGPL-3.0-only
//
// AtlasdrawElementSeed → ExcalidrawElement, in the document's world frame.
//
// A tool says where an element goes in lng/lat (`seed.geo`) and at which map
// zoom it was made (`seed.geo.zRef`). This bridge:
//   1. Places every vertex with `toScene`: the element's x/y/points are world
//      coordinates (ADR-0015), so no camera move ever rewrites them.
//   2. Gives every size the tool states in screen pixels (pin diameter,
//      default circle, font size, stroke width) in scene units at zRef, so it
//      looks that size at the zoom where it was made.
//   3. Keeps tool data under `customData._data`, and marks a pin with
//      `customData.tool = "pin"` so export can give it as a point.
//
// PinTool is the only built-in producer. The other branches accept the rest
// of the seed union: `registerTool` is public, and a registered tool may emit
// any seed the type permits.

import { sceneUnitsPerPixel, toScene } from "@atlasdraw/geo";

import {
  newElement,
  newFreeDrawElement,
  newLinearElement,
  newArrowElement,
  newTextElement,
} from "@atlasdraw/element";

import { pointFrom } from "@atlasdraw/math";

import type { ExcalidrawElement } from "@atlasdraw/element/types";
import type { LocalPoint } from "@atlasdraw/math";

import type { AtlasdrawElementSeed } from "@atlasdraw/tools";
import type { WorldFrame } from "@atlasdraw/geo";

// Screen-pixel sizes at the zoom the seed was made at.
const PIN_DIAMETER_PX = 16;
const PIN_STROKE_COLOR = "#1971c2";
const PIN_FILL_COLOR = "#74c0fc";
const CIRCLE_DEFAULT_DIAMETER_PX = 40;
const TEXT_DEFAULT_FONT_SIZE_PX = 20;
const DEFAULT_STROKE_WIDTH_PX = 2;

/**
 * Element x/y (the first vertex) and points relative to it, as Excalidraw's
 * linear elements want them; width/height are the points' extent.
 */
function linearGeometry(
  coords: ReadonlyArray<[number, number]>,
  frame: WorldFrame,
): {
  x: number;
  y: number;
  points: LocalPoint[];
  width: number;
  height: number;
} {
  if (coords.length === 0) {
    throw new Error("seedToElement: linear/freedraw element needs >=1 point");
  }
  const scene = coords.map(([lng, lat]) => toScene(frame, lng, lat));
  const { x, y } = scene[0];
  const points = scene.map((p) => pointFrom<LocalPoint>(p.x - x, p.y - y));
  const xs = points.map((p) => p[0]);
  const ys = points.map((p) => p[1]);
  return {
    x,
    y,
    points,
    width: Math.max(...xs) - Math.min(...xs),
    height: Math.max(...ys) - Math.min(...ys),
  };
}

/** Tool data, and the tool that made the element when it is a pin. */
function customDataOf(
  seed: AtlasdrawElementSeed,
): Record<string, unknown> | undefined {
  const pin = seed.type === "custom" && seed.customType === "pin";
  if (!seed.data && !pin) {
    return undefined;
  }
  return {
    ...(seed.data ? { _data: seed.data } : {}),
    ...(pin ? { tool: "pin" } : {}),
  };
}

function wrongKind(seed: AtlasdrawElementSeed, want: string): Error {
  const what = seed.type === "custom" ? seed.customType ?? "custom" : seed.type;
  return new Error(
    `seedToElement: ${what} requires geo.kind="${want}", got "${seed.geo.kind}"`,
  );
}

/**
 * Convert a tool-emitted seed into an Excalidraw element in `frame`.
 *
 * @throws When the (type, customType, geo.kind) tuple is not supported.
 */
export function seedToElement(
  seed: AtlasdrawElementSeed,
  frame: WorldFrame,
): ExcalidrawElement {
  const unit = sceneUnitsPerPixel(frame, seed.geo.zRef);
  const strokeWidth =
    (seed.style?.strokeWidth ?? DEFAULT_STROKE_WIDTH_PX) * unit;
  const customData = customDataOf(seed);
  const withData = <T extends ExcalidrawElement>(el: T): T =>
    customData ? { ...el, customData } : el;

  // A pin, or a circle placed by its centre.
  if (
    (seed.type === "custom" && seed.customType === "pin") ||
    seed.type === "ellipse"
  ) {
    if (seed.geo.kind !== "point") {
      throw wrongKind(seed, "point");
    }
    const pin = seed.type === "custom";
    const diameter =
      (pin ? PIN_DIAMETER_PX : CIRCLE_DEFAULT_DIAMETER_PX) * unit;
    const c = toScene(frame, seed.geo.lng, seed.geo.lat);
    return withData(
      newElement({
        type: "ellipse",
        x: c.x - diameter / 2,
        y: c.y - diameter / 2,
        width: diameter,
        height: diameter,
        strokeWidth,
        strokeColor: pin
          ? PIN_STROKE_COLOR
          : seed.style?.strokeColor ?? "#1e1e1e",
        backgroundColor: pin
          ? PIN_FILL_COLOR
          : seed.style?.fillColor ?? "transparent",
        fillStyle: "solid",
        ...(pin ? { roughness: 0 } : {}),
      }),
    );
  }

  if (seed.type === "freedraw") {
    if (seed.geo.kind !== "polyline") {
      throw wrongKind(seed, "polyline");
    }
    return withData(
      newFreeDrawElement({
        type: "freedraw",
        ...linearGeometry(seed.geo.coordinates, frame),
        simulatePressure: false,
        strokeWidth,
        strokeColor: seed.style?.strokeColor ?? "#1e1e1e",
        backgroundColor: seed.style?.fillColor ?? "transparent",
        fillStyle: "solid",
      }),
    );
  }

  if (seed.type === "line" || seed.type === "arrow") {
    if (seed.geo.kind !== "polyline") {
      throw wrongKind(seed, "polyline");
    }
    const geometry = linearGeometry(seed.geo.coordinates, frame);
    const style = {
      strokeWidth,
      strokeColor: seed.style?.strokeColor ?? "#1e1e1e",
      backgroundColor: "transparent",
    };
    return withData(
      seed.type === "arrow"
        ? newArrowElement({
            type: "arrow",
            ...geometry,
            ...style,
            endArrowhead: "arrow",
          })
        : newLinearElement({ type: "line", ...geometry, ...style }),
    );
  }

  if (seed.type === "rectangle") {
    if (seed.geo.kind !== "bbox") {
      throw wrongKind(seed, "bbox");
    }
    const nw = toScene(frame, seed.geo.west, seed.geo.north);
    const se = toScene(frame, seed.geo.east, seed.geo.south);
    return withData(
      newElement({
        type: "rectangle",
        x: Math.min(nw.x, se.x),
        y: Math.min(nw.y, se.y),
        width: Math.abs(se.x - nw.x),
        height: Math.abs(se.y - nw.y),
        strokeWidth,
        strokeColor: seed.style?.strokeColor ?? "#1e1e1e",
        backgroundColor: seed.style?.fillColor ?? "transparent",
        fillStyle: "solid",
      }),
    );
  }

  if (seed.type === "text") {
    if (seed.geo.kind !== "point") {
      throw wrongKind(seed, "point");
    }
    const p = toScene(frame, seed.geo.lng, seed.geo.lat);
    const text =
      typeof (seed.data as { text?: unknown } | undefined)?.text === "string"
        ? (seed.data as { text: string }).text
        : "";
    return withData(
      newTextElement({
        x: p.x,
        y: p.y,
        text,
        fontSize: TEXT_DEFAULT_FONT_SIZE_PX * unit,
        strokeColor: seed.style?.strokeColor ?? "#1e1e1e",
        backgroundColor: "transparent",
      }),
    );
  }

  throw new Error(
    `seedToElement: unsupported (type="${seed.type}", customType="${
      seed.customType ?? ""
    }", geo.kind="${
      seed.geo.kind
    }") — extend the bridge before adding new tools.`,
  );
}
