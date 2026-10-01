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

import { atlasStampNewElements } from "@atlasdraw/element";
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

/**
 * The box of the elements. A linear element's box comes from its points,
 * which can run left of or above its `x` and `y`.
 */
function boundsOf(elements: readonly PlaceableElement[]) {
  let minX = Infinity;
  let minY = Infinity;
  let maxX = -Infinity;
  let maxY = -Infinity;
  const add = (x: number, y: number) => {
    minX = Math.min(minX, x);
    minY = Math.min(minY, y);
    maxX = Math.max(maxX, x);
    maxY = Math.max(maxY, y);
  };
  for (const el of elements) {
    if (el.points && el.points.length > 0) {
      for (const [px, py] of el.points) {
        add(el.x + px, el.y + py);
      }
    } else {
      add(el.x, el.y);
      add(el.x + (el.width ?? 0), el.y + (el.height ?? 0));
    }
  }
  return { minX, minY, maxX, maxY };
}

/**
 * The drawing scaled by the fork's creation seam as an import (one unit of
 * the file is one screen pixel at the camera's zoom), then moved so its box
 * is centred on the camera.
 */
export function placeDrawing<T extends PlaceableElement>(
  elements: readonly T[],
  frame: WorldFrame,
  camera: { readonly center: readonly [number, number]; readonly zoom: number },
): Array<T & { customData: Record<string, unknown> }> {
  if (elements.length === 0) {
    return [];
  }
  const s = sceneUnitsPerPixel(frame, camera.zoom);
  const scaled = atlasStampNewElements(
    elements as unknown as (T & { customData?: Record<string, unknown> })[],
    "import",
    { zoom: 1 / s },
  );
  const b = boundsOf(scaled);
  const c = toScene(frame, camera.center[0], camera.center[1]);
  const dx = c.x - (b.minX + b.maxX) / 2;
  const dy = c.y - (b.minY + b.maxY) / 2;
  return scaled.map((el) => ({
    ...el,
    customData: el.customData ?? {},
    x: el.x + dx,
    y: el.y + dy,
  }));
}
