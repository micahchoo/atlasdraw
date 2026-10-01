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

import type { ExcalidrawImperativeAPI } from "@atlasdraw/excalidraw";

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
      useConvertToDataLayer(fakeApi, addDataLayer, notify),
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
      useConvertToDataLayer(fakeApi, addDataLayer, notify),
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

describe("useConvertToDataLayer — conversion", () => {
  it("adds a named data layer and deletes the element as an undoable step", () => {
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
      useConvertToDataLayer(api, addDataLayer, { error: vi.fn() }),
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
    expect(updateScene).toHaveBeenCalledWith(
      expect.objectContaining({ captureUpdate: expect.anything() }),
    );
  });
});
