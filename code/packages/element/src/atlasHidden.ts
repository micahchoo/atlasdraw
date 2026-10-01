// Atlasdraw: an element the user hid from the layer panel.
//
// The panel writes `customData.atlas.hidden = true` on the element. The flag
// is document content, so undo, redo and collaboration carry it like any
// other element change. The element stays in the scene; the renderer does
// not draw it, and hit-testing and box selection do not find it. Text bound
// to a hidden container is hidden with it.
//
// `isAtlasHidden` is the one predicate. Its call sites: scene/Renderer.ts
// (draw), App.getElementsAtPosition (click), selection.ts
// shouldIgnoreElementFromSelection (box select), actionSelectAll (select
// all), scene/export.ts prepareElementsForRender (every PNG, PDF, SVG and
// copy-as-image export) and actionCopy (the clipboard).

import type { ElementsMap, ExcalidrawElement } from "./types";

const hiddenFlag = (element: ExcalidrawElement): boolean => {
  const atlas = (element.customData as { atlas?: { hidden?: unknown } })?.atlas;
  return atlas?.hidden === true;
};

/**
 * True when the element, or the container its text is bound to, carries
 * `customData.atlas.hidden`. Pass `elementsMap` to check the container.
 */
export const isAtlasHidden = (
  element: ExcalidrawElement,
  elementsMap?: ElementsMap,
): boolean => {
  if (hiddenFlag(element)) {
    return true;
  }
  const containerId = (element as { containerId?: string | null }).containerId;
  if (containerId && elementsMap) {
    const container = elementsMap.get(containerId);
    return !!container && hiddenFlag(container);
  }
  return false;
};
