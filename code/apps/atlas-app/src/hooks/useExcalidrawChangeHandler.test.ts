// SPDX-License-Identifier: AGPL-3.0-only
// Tests for useExcalidrawChangeHandler. One describe block per numbered
// concern in the handler's comments.

import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { renderHook } from "@testing-library/react";

import type { ExcalidrawImperativeAPI } from "@atlasdraw/excalidraw";
import type { OrderedExcalidrawElement } from "@atlasdraw/element/types";
import type { AppState, BinaryFiles } from "@atlasdraw/excalidraw/types";

import { createViewStore } from "../session/view";
import { usePersistenceStore } from "../state/usePersistenceStore";

import { useExcalidrawChangeHandler } from "./useExcalidrawChangeHandler";

function makeAppState(overrides: Record<string, unknown> = {}): AppState {
  return {
    viewBackgroundColor: "transparent",
    scrollX: 0,
    scrollY: 0,
    zoom: { value: 1 },
    selectedElementIds: {},
    ...overrides,
  } as unknown as AppState;
}

const NO_FILES = {} as BinaryFiles;

/** Casts partial element fixtures — real ExcalidrawElement has ~20 fields
 * the handler under test never reads. */
function fakeElements(
  partials: ReadonlyArray<Record<string, unknown>>,
): readonly OrderedExcalidrawElement[] {
  return partials as unknown as readonly OrderedExcalidrawElement[];
}

function makeParams(
  overrides: Partial<Parameters<typeof useExcalidrawChangeHandler>[0]> = {},
) {
  const updateScene = vi.fn();
  const excalidrawAPI = { updateScene } as unknown as ExcalidrawImperativeAPI;
  return {
    excalidrawAPI,
    announceMapEditor: vi.fn(),
    setMapBg: vi.fn(),
    view: createViewStore(),
    ...overrides,
  };
}

beforeEach(() => {
  usePersistenceStore.setState({ isDirty: false, isDraining: false });
});

afterEach(() => {
  vi.restoreAllMocks();
});

describe("useExcalidrawChangeHandler — 1. background color intercept", () => {
  it("does not call setMapBg on the very first non-transparent onChange (mount-time default)", () => {
    const params = makeParams();
    const { result } = renderHook(() => useExcalidrawChangeHandler(params));

    result.current(
      fakeElements([]),
      makeAppState({ viewBackgroundColor: "#ffffff" }),
      NO_FILES,
    );
    expect(params.setMapBg).not.toHaveBeenCalled();
  });

  it("calls setMapBg with the user's color after a transparent baseline was seen", () => {
    const params = makeParams();
    const { result } = renderHook(() => useExcalidrawChangeHandler(params));

    result.current(
      fakeElements([]),
      makeAppState({ viewBackgroundColor: "transparent" }),
      NO_FILES,
    );
    result.current(
      fakeElements([]),
      makeAppState({ viewBackgroundColor: "#ff0000" }),
      NO_FILES,
    );

    expect(params.setMapBg).toHaveBeenCalledWith("#ff0000");
  });

  it("queues exactly one updateScene reset across repeated non-transparent calls", () => {
    const params = makeParams();
    const { result } = renderHook(() => useExcalidrawChangeHandler(params));

    for (let i = 0; i < 3; i++) {
      result.current(
        fakeElements([]),
        makeAppState({ viewBackgroundColor: "#ff0000" }),
        NO_FILES,
      );
    }

    const bgResets = (
      params.excalidrawAPI!.updateScene as ReturnType<typeof vi.fn>
    ).mock.calls.filter(
      ([arg]) => arg.appState?.viewBackgroundColor === "transparent",
    );
    expect(bgResets).toHaveLength(1);
  });
});

describe("useExcalidrawChangeHandler — 2. autosave markDirty gate", () => {
  it("does not mark dirty on the first call (establishes the baseline)", () => {
    const params = makeParams();
    const { result } = renderHook(() => useExcalidrawChangeHandler(params));

    result.current(fakeElements([{ id: "el1" }]), makeAppState(), NO_FILES);
    expect(usePersistenceStore.getState().isDirty).toBe(false);
  });

  it("marks dirty when an element is added", () => {
    const params = makeParams();
    const { result } = renderHook(() => useExcalidrawChangeHandler(params));

    result.current(fakeElements([{ id: "el1" }]), makeAppState(), NO_FILES);
    result.current(
      fakeElements([{ id: "el1" }, { id: "el2" }]),
      makeAppState(),
      NO_FILES,
    );

    expect(usePersistenceStore.getState().isDirty).toBe(true);
  });

  it("marks dirty when an element's version rises (an edit)", () => {
    const params = makeParams();
    const { result } = renderHook(() => useExcalidrawChangeHandler(params));

    result.current(
      fakeElements([{ id: "el1", version: 1, versionNonce: 7 }]),
      makeAppState(),
      NO_FILES,
    );
    result.current(
      fakeElements([{ id: "el1", version: 2, versionNonce: 9 }]),
      makeAppState(),
      NO_FILES,
    );

    expect(usePersistenceStore.getState().isDirty).toBe(true);
  });

  it("marks dirty when an element is deleted", () => {
    const params = makeParams();
    const { result } = renderHook(() => useExcalidrawChangeHandler(params));

    result.current(
      fakeElements([{ id: "el1", version: 1 }]),
      makeAppState(),
      NO_FILES,
    );
    result.current(
      fakeElements([{ id: "el1", version: 1, isDeleted: true }]),
      makeAppState(),
      NO_FILES,
    );

    expect(usePersistenceStore.getState().isDirty).toBe(true);
  });

  it("does not mark dirty for a camera move (a viewport change, same elements)", () => {
    const params = makeParams();
    const { result } = renderHook(() => useExcalidrawChangeHandler(params));
    const elements = fakeElements([
      { id: "el1", version: 3, versionNonce: 5, x: 10 },
    ]);

    result.current(elements, makeAppState(), NO_FILES);
    result.current(
      [...elements],
      makeAppState({ scrollX: -200, scrollY: 40, zoom: { value: 0.001 } }),
      NO_FILES,
    );

    expect(usePersistenceStore.getState().isDirty).toBe(false);
  });
});

describe("useExcalidrawChangeHandler — 3. selection aria-live announce", () => {
  it("announces a single selected element by type", () => {
    const params = makeParams();
    const { result } = renderHook(() => useExcalidrawChangeHandler(params));

    result.current(
      fakeElements([{ id: "el1", type: "rectangle" }]),
      makeAppState({ selectedElementIds: { el1: true } }),
      NO_FILES,
    );

    expect(params.announceMapEditor).toHaveBeenCalledWith(
      "Selected: rectangle",
    );
  });

  it("announces a multi-selection by count", () => {
    const params = makeParams();
    const { result } = renderHook(() => useExcalidrawChangeHandler(params));

    result.current(
      fakeElements([
        { id: "el1", type: "rectangle" },
        { id: "el2", type: "ellipse" },
      ]),
      makeAppState({ selectedElementIds: { el1: true, el2: true } }),
      NO_FILES,
    );

    expect(params.announceMapEditor).toHaveBeenCalledWith(
      "Selected: 2 elements",
    );
  });

  it("does not re-announce when the selection is unchanged", () => {
    const params = makeParams();
    const { result } = renderHook(() => useExcalidrawChangeHandler(params));
    const appState = makeAppState({ selectedElementIds: { el1: true } });
    const el = fakeElements([{ id: "el1", type: "rectangle" }]);

    result.current(el, appState, NO_FILES);
    result.current(el, appState, NO_FILES);

    expect(params.announceMapEditor).toHaveBeenCalledTimes(1);
  });

  it("throttles announcements to at most one per 500ms", () => {
    vi.useFakeTimers();
    const params = makeParams();
    const { result } = renderHook(() => useExcalidrawChangeHandler(params));

    result.current(
      fakeElements([{ id: "el1", type: "rectangle" }]),
      makeAppState({ selectedElementIds: { el1: true } }),
      NO_FILES,
    );
    result.current(
      fakeElements([{ id: "el2", type: "ellipse" }]),
      makeAppState({ selectedElementIds: { el2: true } }),
      NO_FILES,
    );

    expect(params.announceMapEditor).toHaveBeenCalledTimes(1);
    vi.useRealTimers();
  });
});

describe("useExcalidrawChangeHandler — 4. the canvas selection reaches the panel", () => {
  it("the selected elements become the selection; a panel-selected data layer stays", () => {
    const params = makeParams();
    params.view.getState().setSelection({ "dl:roads": true, old: true });
    const { result } = renderHook(() => useExcalidrawChangeHandler(params));

    result.current(
      fakeElements([{ id: "el1", type: "rectangle" }]),
      makeAppState({ selectedElementIds: { el1: true } }),
      NO_FILES,
    );

    expect(params.view.getState().selection).toEqual({
      "dl:roads": true,
      el1: true,
    });
  });

  it("an unchanged selection writes nothing", () => {
    const params = makeParams();
    params.view.getState().setSelection({ el1: true });
    const before = params.view.getState().selection;
    const { result } = renderHook(() => useExcalidrawChangeHandler(params));

    result.current(
      fakeElements([{ id: "el1", type: "rectangle" }]),
      makeAppState({ selectedElementIds: { el1: true } }),
      NO_FILES,
    );

    expect(params.view.getState().selection).toBe(before);
  });
});
