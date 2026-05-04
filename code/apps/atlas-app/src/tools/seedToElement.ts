// apps/atlas-app/src/tools/seedToElement.ts
// SPDX-License-Identifier: AGPL-3.0-only
// Phase 1 Wave 3b Task 14 — AtlasdrawElementSeed → ExcalidrawElement bridge.
//
// PinTool (and any future custom-type tool) emits a minimal seed: the bare
// `geo` payload, scaleMode, and optional data. This bridge:
//   1. Projects geographic coords → scene/pixel coords using the live map.
//   2. Constructs a real `ExcalidrawElement` via `newElement`.
//   3. Stamps the full `GeoCustomData` wrapper (`projection: "mercator"`,
//      `schemaVersion: 1`) so `useCoordinateSync` recognizes it via
//      `isGeoCustomData()` and re-projects on every camera move.
//
// Phase 1 scope: only `customType: "pin"` is supported. Other seed types
// throw — keeps surface area tight while we validate the round-trip.

import type maplibregl from "maplibre-gl";
import { projectPoint } from "@atlasdraw/geo";
import type { GeoCustomData } from "@atlasdraw/geo";
import type { AtlasdrawElementSeed } from "@atlasdraw/tools";
import { newElement } from "@excalidraw/element";
import type { ExcalidrawElement } from "@excalidraw/element/types";

// Visual constants — small enough to feel like a marker, large enough to click.
const PIN_DIAMETER_PX = 16;
const PIN_STROKE_COLOR = "#1971c2";
const PIN_FILL_COLOR = "#74c0fc";

/**
 * Convert a tool-emitted seed into a fully-realized Excalidraw element.
 *
 * @param seed - The seed produced by an `AtlasdrawTool.onPointerDown`.
 * @param map  - Live MapLibre map; used for geo→scene projection.
 * @returns A new `ExcalidrawElement` ready to splice into the scene.
 * @throws  When `seed.customType` is not yet supported (Phase 1 scope).
 */
export function seedToElement(
  seed: AtlasdrawElementSeed,
  map: maplibregl.Map,
): ExcalidrawElement {
  if (seed.type !== "custom" || seed.customType !== "pin") {
    throw new Error(
      "seedToElement: only customType=pin supported in Phase 1",
    );
  }
  if (seed.geo.kind !== "point") {
    // Pin is the only customType — its geo MUST be a point. This branch is a
    // type-narrowing guard for the projection call below.
    throw new Error(
      `seedToElement: pin requires geo.kind="point", got "${seed.geo.kind}"`,
    );
  }

  const { lng, lat, zRef } = seed.geo;
  const projected = projectPoint(map, lng, lat);

  // Center the marker on the projected point. Excalidraw's element x/y is
  // the top-left corner of the bbox, so subtract half the diameter.
  const x = projected.x - PIN_DIAMETER_PX / 2;
  const y = projected.y - PIN_DIAMETER_PX / 2;

  const geoCustomData: GeoCustomData = {
    geo: { kind: "point", lng, lat, zRef },
    scaleMode: seed.scaleMode,
    projection: "mercator",
    schemaVersion: 1,
  };

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

  // Splice in customData. newElement initializes customData to undefined; we
  // tack on our wrapper plus any tool-supplied free-form `data` (kept under
  // `_data` to avoid colliding with reserved GeoCustomData keys).
  return {
    ...element,
    customData: {
      ...geoCustomData,
      ...(seed.data ? { _data: seed.data } : {}),
    },
  };
}
