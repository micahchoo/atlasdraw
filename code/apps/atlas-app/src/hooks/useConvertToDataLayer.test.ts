// SPDX-License-Identifier: AGPL-3.0-only
// Tests for useConvertToDataLayer's error-handling paths (ISSUES.md Issue 7 —
// silence audit). Registration/predicate/perform-pipeline happy paths are
// already covered end-to-end by MapEditor.contextmenu.test.tsx; this file
// covers only the two failure branches that used to be a bare window.alert
// and an unguarded rethrow.
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

import type { LayerRegistryState } from "../state/layerRegistry";
import type maplibregl from "maplibre-gl";

vi.mock("@atlasdraw/tools", async (importOriginal) => {
  const actual = await importOriginal<typeof import("@atlasdraw/tools")>();
  return {
    ...actual,
    annotationToFeatureCollection: vi.fn(),
  };
});

vi.mock("@atlasdraw/basemap", () => ({
  compileLayer: vi.fn(),
  defaultLayerStyle: vi.fn(() => ({})),
}));

const EL: ConvertibleElement = {
  id: "el-1",
  type: "rectangle",
  customData: {
    geo: { kind: "bbox" },
  } as unknown as ConvertibleElement["customData"],
};

function makeMap(overrides: Partial<maplibregl.Map> = {}) {
  return {
    addSource: vi.fn(),
    addLayer: vi.fn(),
    removeSource: vi.fn(),
    ...overrides,
  } as unknown as maplibregl.Map;
}

const fakeApi = {
  registerContextMenuItem: vi.fn(() => vi.fn()),
} as unknown as ExcalidrawImperativeAPI;

const registry: Pick<LayerRegistryState, "registerDataLayer" | "remove"> = {
  registerDataLayer: vi.fn(),
  remove: vi.fn(),
};

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
    const map = makeMap();
    const notify = { error: vi.fn() };
    const alertSpy = vi.spyOn(window, "alert").mockImplementation(() => {});

    const { result } = renderHook(() =>
      useConvertToDataLayer(map, fakeApi, registry, notify),
    );
    result.current.handleConvert(EL);

    expect(alertSpy).not.toHaveBeenCalled();
    expect(notify.error).toHaveBeenCalledWith(thrown.message);
    alertSpy.mockRestore();
  });

  it("rolls back the orphan source, logs, and toasts (does not rethrow uncaught) when addLayer fails", () => {
    const removeSource = vi.fn();
    const map = makeMap({
      addLayer: vi.fn(() => {
        throw new Error("invalid layer spec");
      }),
      removeSource,
    });
    const notify = { error: vi.fn() };
    const consoleErrorSpy = vi
      .spyOn(console, "error")
      .mockImplementation(() => {});

    const { result } = renderHook(() =>
      useConvertToDataLayer(map, fakeApi, registry, notify),
    );

    expect(() => result.current.handleConvert(EL)).not.toThrow();
    expect(removeSource).toHaveBeenCalled();
    expect(consoleErrorSpy).toHaveBeenCalled();
    expect(notify.error).toHaveBeenCalledWith(
      "Couldn't convert to a data layer — invalid layer spec",
    );
    consoleErrorSpy.mockRestore();
  });
});
