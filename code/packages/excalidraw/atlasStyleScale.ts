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
