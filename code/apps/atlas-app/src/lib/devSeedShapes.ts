// SPDX-License-Identifier: AGPL-3.0-only
//
// DEV-ONLY measurement hook, reached as `window.__atlasdraw__.seed(n)` (see
// MapEditor; the whole hook is behind `import.meta.env.DEV`). Seeds N shapes
// in world coordinates over the current view, so the pan benchmark
// (scripts/bench-world-coords.mjs) measures a known scene: two thirds
// rectangles, one third five-point lines, deterministic from a fixed seed.

import {
  CaptureUpdateAction,
  newElement,
  newLinearElement,
} from "@atlasdraw/element";
import { pointFrom } from "@atlasdraw/math";
import { sceneUnitsPerPixel, toScene } from "@atlasdraw/geo";

import type { ExcalidrawImperativeAPI } from "@atlasdraw/excalidraw";
import type { ExcalidrawElement } from "@atlasdraw/element/types";
import type { LocalPoint } from "@atlasdraw/math";
import type { WorldFrame } from "@atlasdraw/geo";

import type maplibregl from "maplibre-gl";

function mulberry32(seed: number): () => number {
  let a = seed;
  return () => {
    a = (a + 0x6d2b79f5) | 0;
    let t = Math.imul(a ^ (a >>> 15), 1 | a);
    t = (t + Math.imul(t ^ (t >>> 7), 61 | t)) ^ t;
    return ((t ^ (t >>> 14)) >>> 0) / 4294967296;
  };
}

export function seedShapes(
  map: maplibregl.Map,
  api: ExcalidrawImperativeAPI,
  n: number,
  frame: WorldFrame,
): number {
  const rand = mulberry32(15);
  const container = map.getContainer();
  const W = container.clientWidth;
  const H = container.clientHeight;
  const unit = sceneUnitsPerPixel(frame, map.getZoom());
  const stroke = 2 * unit;
  const customData = { atlas: { unit } };
  /** Screen px → scene coordinates. */
  const scene = (x: number, y: number) => {
    const p = map.unproject([x, y]);
    return toScene(frame, p.lng, p.lat);
  };
  const out: ExcalidrawElement[] = [];
  for (let i = 0; i < n; i++) {
    // Spread over twice the viewport, so a pan brings shapes in and out.
    const sx = (rand() * 2 - 0.5) * W;
    const sy = (rand() * 2 - 0.5) * H;
    const sw = 20 + rand() * 120;
    const sh = 20 + rand() * 120;
    if (i % 3 !== 2) {
      const nw = scene(sx, sy);
      const se = scene(sx + sw, sy + sh);
      out.push(
        newElement({
          type: "rectangle",
          x: nw.x,
          y: nw.y,
          width: se.x - nw.x,
          height: se.y - nw.y,
          strokeWidth: stroke,
          backgroundColor: "#a5d8ff",
          fillStyle: "solid",
          roughness: 0,
          customData,
        }),
      );
    } else {
      const screen: Array<[number, number]> = [];
      for (let k = 0; k < 5; k++) {
        screen.push([sx + rand() * sw, sy + rand() * sh]);
      }
      const o = scene(screen[0][0], screen[0][1]);
      const pts = screen.map(([x, y]) => {
        const p = scene(x, y);
        return pointFrom<LocalPoint>(p.x - o.x, p.y - o.y);
      });
      out.push(
        newLinearElement({
          type: "line",
          x: o.x,
          y: o.y,
          points: pts,
          strokeWidth: stroke,
          roughness: 0,
          customData,
        }),
      );
    }
  }
  api.updateScene({
    elements: [...api.getSceneElementsIncludingDeleted(), ...out],
    captureUpdate: CaptureUpdateAction.NEVER,
  });
  return out.length;
}
