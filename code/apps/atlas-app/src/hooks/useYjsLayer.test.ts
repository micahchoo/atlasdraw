// SPDX-License-Identifier: AGPL-3.0-only
// Tests for useYjsLayer (ISSUES.md Issue 6 — coverage climb).
//
// This is the WIRING hook (Step 3 of data-layer-crdt): subscribe/unsubscribe
// lifecycle, mutator currying, null-safety. YjsLayer/observeLayer/addFeature
// etc.'s own CRDT logic lives in @atlasdraw/data and is tested there — mocked
// here so this file stays focused on what the hook itself owns.
//
// Per .claude/rules/test-fixtures.md: this file owns its own mocks.

import { describe, it, expect, vi, beforeEach, afterEach } from "vitest";
import { renderHook, cleanup, act } from "@testing-library/react";

import { useYjsLayer, type YjsLayerCollab } from "./useYjsLayer";

import type * as Y from "yjs";
import type { FeatureCollection } from "geojson";

const {
  YjsLayerCtor,
  getOrCreateLayerMock,
  observeLayerMock,
  addFeatureMock,
  deleteFeatureMock,
  setPropertyMock,
  appendVertexMock,
  deleteVertexMock,
} = vi.hoisted(() => {
  const getOrCreateLayerMock = vi.fn();
  const YjsLayerCtor = vi.fn(function (this: unknown) {
    Object.assign(this as object, { getOrCreateLayer: getOrCreateLayerMock });
  });
  return {
    YjsLayerCtor,
    getOrCreateLayerMock,
    observeLayerMock: vi.fn(),
    addFeatureMock: vi.fn(),
    deleteFeatureMock: vi.fn(),
    setPropertyMock: vi.fn(),
    appendVertexMock: vi.fn(),
    deleteVertexMock: vi.fn(),
  };
});

vi.mock("@atlasdraw/data", () => ({
  YjsLayer: YjsLayerCtor,
  observeLayer: observeLayerMock,
  addFeature: addFeatureMock,
  deleteFeature: deleteFeatureMock,
  setProperty: setPropertyMock,
  appendVertex: appendVertexMock,
  deleteVertex: deleteVertexMock,
}));

const FAKE_LAYER = { __brand: "layer" };
const FAKE_SNAPSHOT: FeatureCollection = {
  type: "FeatureCollection",
  features: [],
};

let observeCallback: ((snapshot: FeatureCollection) => void) | null = null;
const unsubscribeMock = vi.fn();

beforeEach(() => {
  vi.clearAllMocks();
  getOrCreateLayerMock.mockReturnValue(FAKE_LAYER);
  observeLayerMock.mockImplementation(
    (_layer: unknown, cb: (s: FeatureCollection) => void) => {
      observeCallback = cb;
      cb(FAKE_SNAPSHOT);
      return unsubscribeMock;
    },
  );
});

afterEach(() => {
  cleanup();
  observeCallback = null;
});

function activeCollab(yjsDoc: Y.Doc = {} as Y.Doc): YjsLayerCollab {
  return { active: true, yjsDoc };
}

describe("useYjsLayer", () => {
  it("returns null features/mutate when collab is inactive", () => {
    const { result } = renderHook(() =>
      useYjsLayer({ active: false, yjsDoc: {} as Y.Doc }),
    );
    expect(result.current).toEqual({ features: null, mutate: null });
    expect(YjsLayerCtor).not.toHaveBeenCalled();
  });

  it("returns null features/mutate when yjsDoc is null, even if active", () => {
    const { result } = renderHook(() =>
      useYjsLayer({ active: true, yjsDoc: null }),
    );
    expect(result.current).toEqual({ features: null, mutate: null });
    expect(YjsLayerCtor).not.toHaveBeenCalled();
  });

  it("constructs a YjsLayer, gets the 'default' layer, and seeds features synchronously from observeLayer's initial callback", () => {
    const doc = {} as Y.Doc;
    const collab = activeCollab(doc);
    const { result } = renderHook(() => useYjsLayer(collab));
    expect(YjsLayerCtor).toHaveBeenCalledWith(doc);
    expect(getOrCreateLayerMock).toHaveBeenCalledWith("default");
    expect(result.current.features).toBe(FAKE_SNAPSHOT);
    expect(result.current.mutate).not.toBeNull();
  });

  it("updates features when observeLayer's callback fires again (remote/local mutation)", () => {
    const collab = activeCollab();
    const { result } = renderHook(() => useYjsLayer(collab));
    const next: FeatureCollection = { type: "FeatureCollection", features: [] };
    act(() => observeCallback?.(next));
    expect(result.current.features).toBe(next);
  });

  it("mutate.addFeature curries the layer reference into the @atlasdraw/data helper", () => {
    const collab = activeCollab();
    const { result } = renderHook(() => useYjsLayer(collab));
    result.current.mutate?.addFeature("f1", "Point", [[[0, 0]]], { a: 1 });
    expect(addFeatureMock).toHaveBeenCalledWith(
      FAKE_LAYER,
      "f1",
      "Point",
      [[[0, 0]]],
      { a: 1 },
    );
  });

  it("mutate.deleteFeature/setProperty/appendVertex/deleteVertex all curry the layer reference", () => {
    const collab = activeCollab();
    const { result } = renderHook(() => useYjsLayer(collab));
    result.current.mutate?.deleteFeature("f1");
    expect(deleteFeatureMock).toHaveBeenCalledWith(FAKE_LAYER, "f1");

    result.current.mutate?.setProperty("f1", "color", "red");
    expect(setPropertyMock).toHaveBeenCalledWith(
      FAKE_LAYER,
      "f1",
      "color",
      "red",
    );

    result.current.mutate?.appendVertex("f1", 0, [1, 1]);
    expect(appendVertexMock).toHaveBeenCalledWith(FAKE_LAYER, "f1", 0, [1, 1]);

    result.current.mutate?.deleteVertex("f1", 0, 2);
    expect(deleteVertexMock).toHaveBeenCalledWith(FAKE_LAYER, "f1", 0, 2);
  });

  it("unsubscribes and clears mutate on cleanup when collab goes inactive", () => {
    const { result, rerender } = renderHook(
      ({ collab }) => useYjsLayer(collab),
      { initialProps: { collab: activeCollab() } },
    );
    expect(result.current.mutate).not.toBeNull();

    rerender({ collab: { active: false, yjsDoc: null } });
    expect(unsubscribeMock).toHaveBeenCalledTimes(1);
    expect(result.current.mutate).toBeNull();
    expect(result.current.features).toBeNull();
  });

  it("unsubscribes on unmount", () => {
    const collab = activeCollab();
    const { unmount } = renderHook(() => useYjsLayer(collab));
    unmount();
    expect(unsubscribeMock).toHaveBeenCalledTimes(1);
  });

  it("re-subscribes with a new YjsLayer when the yjsDoc reference changes", () => {
    const docA = {} as Y.Doc;
    const docB = {} as Y.Doc;
    const { rerender } = renderHook(({ collab }) => useYjsLayer(collab), {
      initialProps: { collab: activeCollab(docA) },
    });
    expect(YjsLayerCtor).toHaveBeenCalledTimes(1);

    rerender({ collab: activeCollab(docB) });
    expect(YjsLayerCtor).toHaveBeenCalledTimes(2);
    expect(YjsLayerCtor).toHaveBeenLastCalledWith(docB);
    expect(unsubscribeMock).toHaveBeenCalledTimes(1);
  });
});
