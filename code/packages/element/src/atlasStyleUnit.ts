// Atlasdraw addition (ADR-0015): the unit of an element's pixel-sized details.
//
// The atlas app's scene is a world map at a fixed reference zoom, so an
// element drawn at a lower zoom is many scene units wide. Upstream draws some
// details at fixed sizes in scene units, calibrated for scene = screen:
// arrowheads, dash lengths, rough jitter, the adaptive corner radius and the
// padding of an element's cache canvas. At a zoom value of 2^-10 those are a
// thousandth of a pixel: arrows lose their heads and strokes are clipped.
//
// The app stores `customData.atlas.unit` on an element: scene units per
// screen pixel at the zoom it was drawn at. Those details are multiplied by
// it, so they look as upstream draws them at that zoom, and scale with the
// map like the rest of the element. Without it the unit is 1 and nothing
// changes.

import type { ExcalidrawElement } from "./types";

export const styleUnit = (element: ExcalidrawElement): number => {
  const unit = (
    element.customData as { atlas?: { unit?: unknown } } | undefined
  )?.atlas?.unit;
  return typeof unit === "number" && Number.isFinite(unit) && unit > 0
    ? unit
    : 1;
};
