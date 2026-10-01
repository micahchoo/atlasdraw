// Atlasdraw addition (docs/architecture/adr/0015-world-coordinates-gate.md):
// the atlas adapter of the fork's creation seam.
//
// The fork calls its `stampNewElements` prop on every element that enters the
// scene, with `how` it came in (`NewElementHow`). Upstream's adapter is no
// prop: the elements go in as they are. This adapter makes two facts true for
// a world-coordinate scene:
//
// - Every new element records its pixel unit, `customData.atlas.unit`
//   (scene units per screen pixel; see atlasStyleUnit.ts).
// - Content made for scene = screen comes in at the size it had on screen.
//
// `how` decides which rule applies. A missing unit decides nothing: text made
// before every path recorded a unit is the atlas's own, not foreign.

import type { ExcalidrawElement } from "./types";

/** How a new element came into the scene. */
export type NewElementHow =
  /** Made by a drawing tool now, sized in screen pixels at this zoom. */
  | "draw"
  /** Made by the text tool, a plain-text paste or a container's label. */
  | "text"
  /** An image placeholder, from the image tool, a paste or a drop. */
  | "insert-image"
  /** A copy of elements in this scene: Ctrl+D, Alt+drag. */
  | "duplicate"
  /** Elements from a clipboard that an editor with world units wrote. */
  | "paste"
  /** A library item. Library items are kept at a screen size. */
  | "library"
  /**
   * Content from outside, made for scene = screen: a clipboard from another
   * Excalidraw, a .excalidraw file, a chart.
   */
  | "import";

/** What the stamp reads from the editor. */
export type StampView = { zoom: number };

/** The fork prop's type. Returns the elements in the order given. */
export type StampNewElements = <T extends ExcalidrawElement>(
  elements: readonly T[],
  how: NewElementHow,
  view: StampView,
) => T[];

/** The fields the stamp reads and scales. Raw file JSON satisfies it. */
export type StampableElement = {
  x: number;
  y: number;
  width?: number;
  height?: number;
  strokeWidth?: number;
  customData?: Record<string, any>;
};

type Pt = readonly [number, number];

const unitOf = (el: StampableElement): number | undefined => {
  const unit = el.customData?.atlas?.unit;
  return typeof unit === "number" && Number.isFinite(unit) && unit > 0
    ? unit
    : undefined;
};

const withUnit = <T extends StampableElement>(el: T, unit: number): T => ({
  ...el,
  customData: {
    ...el.customData,
    atlas: { ...el.customData?.atlas, unit },
  },
});

/** The unit of the first element that records one. */
const batchUnit = (elements: readonly StampableElement[]) => {
  for (const el of elements) {
    const unit = unitOf(el);
    if (unit !== undefined) {
      return unit;
    }
  }
  return undefined;
};

/**
 * Every length of `el` times `f`, its position scaled about (`ox`, `oy`).
 * Elements scaled about one point keep their places relative to each other.
 */
const scaleElement = <T extends StampableElement>(
  el: T,
  f: number,
  ox: number,
  oy: number,
): T => {
  const e = el as T & {
    points?: readonly Pt[];
    fontSize?: number;
    fixedSegments?: readonly { start: Pt; end: Pt }[] | null;
  };
  const pt = (p: Pt) => [p[0] * f, p[1] * f] as [number, number];
  return {
    ...el,
    x: ox + (el.x - ox) * f,
    y: oy + (el.y - oy) * f,
    ...(el.width !== undefined ? { width: el.width * f } : {}),
    ...(el.height !== undefined ? { height: el.height * f } : {}),
    ...(el.strokeWidth !== undefined
      ? { strokeWidth: el.strokeWidth * f }
      : {}),
    ...(e.points ? { points: e.points.map(pt) } : {}),
    ...(typeof e.fontSize === "number" ? { fontSize: e.fontSize * f } : {}),
    ...(e.fixedSegments
      ? {
          fixedSegments: e.fixedSegments.map((s) => ({
            ...s,
            start: pt(s.start),
            end: pt(s.end),
          })),
        }
      : {}),
  };
};

/**
 * The atlas's `stampNewElements`. `view.zoom` is Excalidraw's zoom value, so
 * one screen pixel is `1 / zoom` scene units.
 *
 * - draw, text, insert-image: the element is sized for this zoom already. It
 *   records the unit `1 / zoom`.
 * - paste, duplicate: atlas content. Geometry is kept. An element without a
 *   unit takes its batch's, or `1 / zoom` when no element has one.
 * - import, library: the batch is scaled so that one unit of its own (its
 *   batch unit, or 1 when it records none) becomes one screen pixel, about
 *   its top-left element corner; the caller places it.
 */
export const atlasStampNewElements = <T extends StampableElement>(
  elements: readonly T[],
  how: NewElementHow,
  view: StampView,
): T[] => {
  const pixel = 1 / view.zoom;
  switch (how) {
    case "draw":
    case "text":
    case "insert-image":
      return elements.map((el) => withUnit(el, pixel));
    case "paste":
    case "duplicate": {
      const fallback = batchUnit(elements) ?? pixel;
      return elements.map((el) =>
        unitOf(el) === undefined ? withUnit(el, fallback) : el,
      );
    }
    case "import":
    case "library": {
      const own = batchUnit(elements) ?? 1;
      const f = pixel / own;
      let ox = Infinity;
      let oy = Infinity;
      for (const el of elements) {
        ox = Math.min(ox, el.x);
        oy = Math.min(oy, el.y);
      }
      return elements.map((el) =>
        withUnit(scaleElement(el, f, ox, oy), (unitOf(el) ?? own) * f),
      );
    }
  }
};
