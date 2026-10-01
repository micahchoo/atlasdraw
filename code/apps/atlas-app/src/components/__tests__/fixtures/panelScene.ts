// SPDX-License-Identifier: AGPL-3.0-only
//
// A drawing for the layer panel tests. The panel's annotation rows come from
// the scene store (state/scene.ts); this seeds a stateful scene stand-in and
// binds it there, as MapEditor binds the real Excalidraw.
//
// Per .claude/rules/test-fixtures.md: do not change this to fix one test.

import { act } from "@testing-library/react";

import { bindScene, useSceneStore } from "../../../state/scene";
import { annotationRows } from "../../../state/annotations";
import { makeFakeExcalidraw } from "../../../state/__tests__/fixtures/documentWorld";

import type { FakeExcalidraw } from "../../../state/__tests__/fixtures/documentWorld";

let unbind: (() => void) | null = null;

/** Drop the bound scene. Call from afterEach. */
export function unbindPanelScene(): void {
  unbind?.();
  unbind = null;
}

/**
 * Bind a scene of rectangles, bottom of the z-order first. A shape given a
 * label carries it as the user's name (customData.atlas.label).
 */
export function seedScene(
  ...shapes: Array<[id: string, label?: string]>
): FakeExcalidraw {
  unbindPanelScene();
  const fx = makeFakeExcalidraw(
    shapes.map(([id, label], i) => ({
      id,
      type: "rectangle",
      version: 1,
      versionNonce: 1,
      index: `a${i}`,
      isDeleted: false,
      ...(label ? { customData: { atlas: { label } } } : {}),
    })),
  );
  act(() => {
    unbind = bindScene(fx.api);
  });
  return fx;
}

/** The annotation rows the panel shows, as ids in panel order. */
export function sceneAnnotationIds(): string[] {
  return annotationRows(useSceneStore.getState().elements).map((r) => r.id);
}

/** One annotation row, as the panel shows it. */
export function sceneRow(id: string) {
  return annotationRows(useSceneStore.getState().elements).find(
    (r) => r.id === id,
  );
}
