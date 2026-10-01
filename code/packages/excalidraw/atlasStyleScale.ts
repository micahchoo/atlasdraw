// Atlasdraw addition (ADR-0015).
//
// The atlas app's scene is a world map at a fixed reference zoom: one scene
// unit is one map pixel at zoom 22, so at the zoom where people draw a scene
// unit is a small part of a pixel. With the `screenSizedStyles` prop, stroke
// widths and font sizes are chosen in screen pixels and stored in scene
// units at the zoom where they are chosen. Without the prop nothing changes.

/** Scene units per screen pixel for a style size. 1 without the prop. */
export const styleScale = (
  screenSizedStyles: boolean | undefined,
  zoom: number,
): number => (screenSizedStyles ? 1 / zoom : 1);

/**
 * The picker value for a stored size: the size times the zoom value, snapped
 * to an option when it is that option up to float error. Exact matching would
 * miss every option, because the zoom value is rarely a power of two.
 */
export const pickerStyleValue = (
  stored: number,
  scale: number,
  options: readonly number[],
): number => {
  const shown = stored / scale;
  for (const option of options) {
    if (Math.abs(shown - option) <= 1e-6 * option) {
      return option;
    }
  }
  return shown;
};

/**
 * Elements from outside the atlas (a library item, a paste from another
 * Excalidraw) are sized for scene = screen. With `screenSizedStyles` they go
 * in at the size they had there: every element without a pixel unit
 * (`customData.atlas.unit`) is scaled by `scale` about (`ox`, `oy`) and
 * records `scale` as its unit. An element that has a unit is the atlas's own
 * and is returned as it is.
 */
export const scaleForeignElements = <
  T extends {
    x: number;
    y: number;
    width: number;
    height: number;
    strokeWidth: number;
    customData?: Record<string, any>;
  },
>(
  elements: readonly T[],
  scale: number,
  ox: number,
  oy: number,
): T[] =>
  elements.map((el) => {
    const atlas = el.customData?.atlas;
    if (scale === 1 || typeof atlas?.unit === "number") {
      return el;
    }
    const e = el as T & {
      points?: readonly (readonly [number, number])[];
      fontSize?: number;
      fixedSegments?:
        | readonly {
            start: readonly [number, number];
            end: readonly [number, number];
          }[]
        | null;
    };
    const pt = (p: readonly [number, number]) =>
      [p[0] * scale, p[1] * scale] as [number, number];
    return {
      ...el,
      x: ox + (el.x - ox) * scale,
      y: oy + (el.y - oy) * scale,
      width: el.width * scale,
      height: el.height * scale,
      strokeWidth: el.strokeWidth * scale,
      ...(e.points ? { points: e.points.map(pt) } : {}),
      ...(typeof e.fontSize === "number"
        ? { fontSize: e.fontSize * scale }
        : {}),
      ...(e.fixedSegments
        ? {
            fixedSegments: e.fixedSegments.map((s) => ({
              ...s,
              start: pt(s.start),
              end: pt(s.end),
            })),
          }
        : {}),
      customData: {
        ...el.customData,
        atlas: { ...atlas, unit: scale },
      },
    };
  });
