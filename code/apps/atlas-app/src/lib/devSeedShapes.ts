// SPDX-License-Identifier: AGPL-3.0-only
//
// ADR-0015 spike — DEV-ONLY measurement hook. Seeds N shapes over the current
// view so the pan benchmark can compare the scroll lock with the camera
// bridge at the same scene: two thirds rectangles (bbox anchors), one third
// five-point lines (polyline anchors), deterministic from a fixed seed.
//
// Scroll lock (frame === null): screen-pixel elements carrying the v1
// `customData.geo` anchor, exactly what useGeoAnchor stamps.
// World (frame given): world-coordinate elements with no anchor.

import {
  CaptureUpdateAction,
  newElement,
  newLinearElement,
} from "@atlasdraw/element";
import { pointFrom } from "@atlasdraw/math";
import { toScene } from "@atlasdraw/geo";

import type { ExcalidrawImperativeAPI } from "@atlasdraw/excalidraw";
import type { ExcalidrawElement } from "@atlasdraw/element/types";
import type { LocalPoint } from "@atlasdraw/math";
import type { GeoCustomData, WorldFrame } from "@atlasdraw/geo";

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
  frame: WorldFrame | null,
): number {
  const rand = mulberry32(15);
  const container = map.getContainer();
  const W = container.clientWidth;
  const H = container.clientHeight;
  const zoom = map.getZoom();
  const scale = frame ? Math.pow(2, zoom - frame.z0) : 1;
  const ll = (x: number, y: number) => map.unproject([x, y]);
  /** Screen px → this mode's scene coordinates. */
  const scene = (x: number, y: number) => {
    if (!frame) {
      return { x, y };
    }
    const p = ll(x, y);
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
      const a = ll(sx, sy);
      const b = ll(sx + sw, sy + sh);
      const geo: GeoCustomData | undefined = frame
        ? undefined
        : {
            geo: {
              kind: "bbox",
              west: a.lng,
              north: a.lat,
              east: b.lng,
              south: b.lat,
              zRef: zoom,
            },
            scaleMode: "geographic",
            projection: "mercator",
            schemaVersion: 1,
          };
      out.push(
        newElement({
          type: "rectangle",
          x: nw.x,
          y: nw.y,
          width: se.x - nw.x,
          height: se.y - nw.y,
          strokeWidth: 2 / scale,
          backgroundColor: "#a5d8ff",
          fillStyle: "solid",
          roughness: 0,
          ...(geo ? { customData: geo } : {}),
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
      const geo: GeoCustomData | undefined = frame
        ? undefined
        : {
            geo: {
              kind: "polyline",
              coordinates: screen.map(([x, y]) => {
                const p = ll(x, y);
                return [p.lng, p.lat] as [number, number];
              }),
              zRef: zoom,
            },
            scaleMode: "geographic",
            projection: "mercator",
            schemaVersion: 1,
          };
      out.push(
        newLinearElement({
          type: "line",
          x: o.x,
          y: o.y,
          points: pts,
          strokeWidth: 2 / scale,
          roughness: 0,
          ...(geo ? { customData: geo } : {}),
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
