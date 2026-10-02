// SPDX-License-Identifier: AGPL-3.0-only
// Tests for useConvertToDataLayer: a conversion adds a data layer and deletes
// the element as one undoable scene step, and every failure reaches the user
// as a toast, never as an uncaught exception.
//
// Per .claude/rules/test-fixtures.md: this file owns its own mocks.

import { describe, it, expect, vi, beforeEach } from "vitest";
import { renderHook } from "@testing-library/react";

import {
  annotationToFeatureCollection,
  UnsupportedConvertElementError,
  type ConvertibleElement,
} from "@atlasdraw/tools";
import { defaultLayerStyle } from "@atlasdraw/basemap";
import { CaptureUpdateAction } from "@atlasdraw/element";

import type { ExcalidrawImperativeAPI } from "@atlasdraw/excalidraw";

import { createHistory } from "../session/history";
import { createDocumentStore } from "../state/document";
import { followDocumentHistory } from "../state/documentUndo";

import { useConvertToDataLayer } from "./useConvertToDataLayer";

vi.mock("@atlasdraw/tools", async (importOriginal) => {
  const actual = await importOriginal<typeof import("@atlasdraw/tools")>();
  return {
    ...actual,
    annotationToFeatureCollection: vi.fn(),
  };
});

vi.mock("@atlasdraw/basemap", () => ({
  defaultLayerStyle: vi.fn(() => ({})),
}));

const EL: ConvertibleElement = {
  id: "el-1",
  type: "rectangle",
  x: 0,
  y: 0,
  width: 100,
  height: 50,
};

const fakeApi = {
  registerContextMenuItem: vi.fn(() => vi.fn()),
} as unknown as ExcalidrawImperativeAPI;

const addDataLayer = vi.fn();

beforeEach(() => {
  vi.clearAllMocks();
  vi.mocked(defaultLayerStyle).mockReturnValue({} as never);
  vi.mocked(annotationToFeatureCollection).mockReturnValue({
    type: "FeatureCollection",
    features: [],
  } as never);
});

describe("useConvertToDataLayer — error handling", () => {
  it("notifies via toast (not window.alert) on UnsupportedConvertElementError", () => {
    const thrown = new UnsupportedConvertElementError("text");
    vi.mocked(annotationToFeatureCollection).mockImplementation(() => {
      throw thrown;
    });
    const notify = { error: vi.fn() };
    const alertSpy = vi.spyOn(window, "alert").mockImplementation(() => {});

    const { result } = renderHook(() =>
      useConvertToDataLayer(fakeApi, addDataLayer, createHistory(), notify),
    );
    result.current.handleConvert(EL);

    expect(alertSpy).not.toHaveBeenCalled();
    expect(notify.error).toHaveBeenCalledWith(thrown.message);
    alertSpy.mockRestore();
  });

  it("logs and toasts an unexpected failure instead of throwing", () => {
    vi.mocked(annotationToFeatureCollection).mockImplementation(() => {
      throw new Error("no geometry");
    });
    const notify = { error: vi.fn() };
    const consoleErrorSpy = vi
      .spyOn(console, "error")
      .mockImplementation(() => {});

    const { result } = renderHook(() =>
      useConvertToDataLayer(fakeApi, addDataLayer, createHistory(), notify),
    );

    expect(() => result.current.handleConvert(EL)).not.toThrow();
    expect(consoleErrorSpy).toHaveBeenCalled();
    expect(notify.error).toHaveBeenCalledWith(
      "Couldn't convert to a data layer — no geometry",
    );
    expect(addDataLayer).not.toHaveBeenCalled();
    consoleErrorSpy.mockRestore();
  });
});

/** A drawing with one rectangle that the fake API's updateScene rewrites. */
function oneRectangle() {
  let elements = [
    {
      id: "el-1",
      type: "rectangle",
      version: 1,
      versionNonce: 1,
      isDeleted: false,
      customData: EL.customData,
    },
  ];
  const updateScene = vi.fn((opts: { elements: typeof elements }) => {
    elements = opts.elements;
  });
  const api = {
    registerContextMenuItem: vi.fn(() => vi.fn()),
    getSceneElements: () => elements.filter((e) => !e.isDeleted),
    getSceneElementsIncludingDeleted: () => elements,
    updateScene,
  } as unknown as ExcalidrawImperativeAPI;
  return { api, updateScene, elements: () => elements };
}

describe("useConvertToDataLayer — one undo step", () => {
  it("undo removes the layer and brings the shape back; redo does both again", () => {
    const store = createDocumentStore();
    const history = createHistory();
    followDocumentHistory(store, history);
    const doc = () => store.getState().doc;
    const { api, elements } = oneRectangle();
    const { result } = renderHook(() =>
      useConvertToDataLayer(
        api,
        (layer) => doc().dispatch({ type: "add-data-layer", ...layer }),
        history,
        { error: vi.fn() },
      ),
    );

    result.current.handleConvert(EL);
    expect(doc().snapshot().overlays).toHaveLength(1);
    expect(elements()[0].isDeleted).toBe(true);

    history.undo();
    expect(doc().snapshot().overlays).toHaveLength(0);
    expect(elements()[0].isDeleted).toBe(false);
    expect(history.canUndo).toBe(false);

    history.redo();
    expect(doc().snapshot().overlays).toHaveLength(1);
    expect(elements()[0].isDeleted).toBe(true);
  });
});

describe("useConvertToDataLayer — conversion", () => {
  it("adds a named data layer and deletes the element, out of the drawing's own history", () => {
    let elements = [
      {
        id: "el-1",
        type: "rectangle",
        version: 1,
        versionNonce: 1,
        isDeleted: false,
        customData: EL.customData,
      },
    ];
    const updateScene = vi.fn((opts: { elements: typeof elements }) => {
      elements = opts.elements;
    });
    const api = {
      registerContextMenuItem: vi.fn(() => vi.fn()),
      getSceneElements: () => elements.filter((e) => !e.isDeleted),
      getSceneElementsIncludingDeleted: () => elements,
      updateScene,
    } as unknown as ExcalidrawImperativeAPI;

    const { result } = renderHook(() =>
      useConvertToDataLayer(api, addDataLayer, createHistory(), {
        error: vi.fn(),
      }),
    );
    result.current.handleConvert(EL);

    expect(addDataLayer).toHaveBeenCalledWith(
      expect.objectContaining({
        id: expect.stringMatching(/^dl:/),
        label: expect.stringMatching(/^Rectangle/),
      }),
    );
    expect(elements).toEqual([
      expect.objectContaining({ id: "el-1", isDeleted: true, version: 2 }),
    ]);
    // The step is the one history's (the group above), not the drawing's.
    expect(updateScene).toHaveBeenCalledWith(
      expect.objectContaining({ captureUpdate: CaptureUpdateAction.NEVER }),
    );
  });
});
