// SPDX-License-Identifier: AGPL-3.0-only
//
// Put a drawing that has no place on Earth onto the map view.
//
// A plain .excalidraw file has scene coordinates in screen pixels at zoom 1.
// In a document a scene unit is a map pixel at the reference zoom
// (docs/architecture/adr/0015-world-coordinates-gate.md),
// so the drawing is scaled to one screen pixel per unit at the camera's zoom
// and centred on the camera: it opens where the user is looking, at the size
// it had in Excalidraw.

import { sceneUnitsPerPixel, toScene, type WorldFrame } from "@atlasdraw/geo";

/** The element fields a placement reads and scales. */
export interface PlaceableElement {
  readonly x: number;
  readonly y: number;
  readonly width?: number;
  readonly height?: number;
  readonly strokeWidth?: number;
  readonly fontSize?: number;
  readonly points?: ReadonlyArray<readonly [number, number]>;
  readonly [key: string]: unknown;
}

/** customData with `atlas.unit` multiplied by `s` (a missing unit is 1). */
function withUnit(customData: unknown, s: number): Record<string, unknown> {
  const cd =
    typeof customData === "object" && customData !== null
      ? (customData as Record<string, unknown>)
      : {};
  const atlas =
    typeof cd.atlas === "object" && cd.atlas !== null
      ? (cd.atlas as Record<string, unknown>)
      : {};
  const unit = typeof atlas.unit === "number" ? atlas.unit : 1;
  return { ...cd, atlas: { ...atlas, unit: unit * s } };
}

export function placeDrawing<T extends PlaceableElement>(
  elements: readonly T[],
  frame: WorldFrame,
  camera: { readonly center: readonly [number, number]; readonly zoom: number },
): Array<T & { customData: Record<string, unknown> }> {
  if (elements.length === 0) {
    return [];
  }
  let minX = Infinity;
  let minY = Infinity;
  let maxX = -Infinity;
  let maxY = -Infinity;
  for (const el of elements) {
    minX = Math.min(minX, el.x);
    minY = Math.min(minY, el.y);
    maxX = Math.max(maxX, el.x + (el.width ?? 0));
    maxY = Math.max(maxY, el.y + (el.height ?? 0));
  }
  const s = sceneUnitsPerPixel(frame, camera.zoom);
  const c = toScene(frame, camera.center[0], camera.center[1]);
  const mx = (minX + maxX) / 2;
  const my = (minY + maxY) / 2;
  const scale = (v: number | undefined) => (v === undefined ? v : v * s);
  return elements.map((el) => ({
    ...el,
    // The drawing's pixel-sized details (arrowheads, dashes) scale with it.
    customData: withUnit(el.customData, s),
    x: c.x + (el.x - mx) * s,
    y: c.y + (el.y - my) * s,
    ...(el.width !== undefined ? { width: scale(el.width) } : {}),
    ...(el.height !== undefined ? { height: scale(el.height) } : {}),
    ...(el.strokeWidth !== undefined
      ? { strokeWidth: scale(el.strokeWidth) }
      : {}),
    ...(el.fontSize !== undefined ? { fontSize: scale(el.fontSize) } : {}),
    ...(el.points
      ? {
          points: el.points.map(
            ([px, py]) => [px * s, py * s] as [number, number],
          ),
        }
      : {}),
  }));
}
