// Atlasdraw addition (docs/architecture/adr/0015-world-coordinates-gate.md):
// the unit of an element's pixel-sized details.
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
//
// Distances that belong to the element's geometry use the element's unit:
// binding gaps, bound-text padding, elbow-arrow spacing. Distances that
// belong to the editor's interaction use the editor's unit (`editorUnit`):
// how near an arrow end must come to bind, the arrow-key nudge. Both make
// the atlas editor behave at any map zoom as upstream does at zoom 1.

import type { ExcalidrawElement } from "./types";

export const styleUnit = (
  element: Pick<ExcalidrawElement, "customData">,
): number => {
  const unit = (
    element.customData as { atlas?: { unit?: unknown } } | undefined
  )?.atlas?.unit;
  return typeof unit === "number" && Number.isFinite(unit) && unit > 0
    ? unit
    : 1;
};

/** What the editor's own distances depend on. `AppState` satisfies it. */
export type EditorView = {
  zoom: { value: number };
  screenSizedStyles: boolean;
};

/**
 * Scene units per screen pixel for the editor's own distances. With
 * `screenSizedStyles` it is one pixel at the current zoom; without, 1, and
 * upstream's zoom rules apply.
 */
export const editorUnit = (view: EditorView): number =>
  view.screenSizedStyles ? 1 / view.zoom.value : 1;
