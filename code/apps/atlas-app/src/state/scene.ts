// SPDX-License-Identifier: AGPL-3.0-only
//
// The drawing, published for views that are not in MapEditor's render tree.
//
// The layer panel mounts inside Excalidraw's sidebar (see state/mapInstance.ts
// for why it cannot take props), and it needs two things from the scene: the
// elements, to compute its annotation rows, and the API, to write an element.
// This store holds both.
//
// `elements` changes only when the drawing changes (the scene signature), not
// on every onChange. A pan gives Excalidraw a new elements array on every
// frame; the panel must not render on every frame.

import { useEffect, useMemo } from "react";
import { create } from "zustand";

import type { ExcalidrawImperativeAPI } from "@atlasdraw/excalidraw";

import type { ExcalidrawElement } from "@atlasdraw/element/types";

import { annotationRows, type AnnotationRow } from "./annotations";
import { sceneSignature } from "./sceneSignature";

export type SceneState = {
  /** null until Excalidraw mounts. */
  api: ExcalidrawImperativeAPI | null;
  /** Every element, deleted ones included, as of the last drawing change. */
  elements: readonly ExcalidrawElement[];
  signature: number;
};

export const useSceneStore = create<SceneState>(() => ({
  api: null,
  elements: [],
  signature: sceneSignature([]),
}));

/**
 * Publish this Excalidraw instance's scene. Returns the unbind function,
 * which also clears the store.
 */
export function bindScene(api: ExcalidrawImperativeAPI): () => void {
  const publish = (elements: readonly ExcalidrawElement[]) => {
    const signature = sceneSignature(elements);
    const prev = useSceneStore.getState();
    if (prev.api === api && prev.signature === signature) {
      return;
    }
    useSceneStore.setState({ api, elements, signature });
  };
  publish(api.getSceneElementsIncludingDeleted());
  const unsubscribe = api.onChange((elements) => publish(elements));
  return () => {
    unsubscribe();
    if (useSceneStore.getState().api === api) {
      useSceneStore.setState({
        api: null,
        elements: [],
        signature: sceneSignature([]),
      });
    }
  };
}

/** Bind the scene for the lifetime of the calling component. */
export function useSceneBinding(api: ExcalidrawImperativeAPI | null): void {
  useEffect(() => (api ? bindScene(api) : undefined), [api]);
}

/** The layer panel's annotation rows. */
export function useAnnotationRows(): AnnotationRow[] {
  const elements = useSceneStore((s) => s.elements);
  return useMemo(() => annotationRows(elements), [elements]);
}
