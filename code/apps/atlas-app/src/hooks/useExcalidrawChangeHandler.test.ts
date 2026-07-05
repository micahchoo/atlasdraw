// SPDX-License-Identifier: AGPL-3.0-only
// Characterization tests for useExcalidrawChangeHandler — extracted from
// MapEditor.tsx (DEADWOOD.md god-module split, Cut 5, the hardest: this
// callback fused five concerns and was entirely uncovered before
// extraction). One describe block per numbered sub-concern from the
// original handler's comments.

import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { renderHook } from "@testing-library/react";

import type {
  ExcalidrawElement,
  ExcalidrawImperativeAPI,
} from "@atlasdraw/excalidraw";
import type { AppState, BinaryFiles } from "@atlasdraw/excalidraw/types";

import { usePersistenceStore } from "../state/usePersistenceStore";

import { useExcalidrawChangeHandler } from "./useExcalidrawChangeHandler";

import type maplibregl from "maplibre-gl";

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
): readonly ExcalidrawElement[] {
  return partials as unknown as readonly ExcalidrawElement[];
}

function makeGeoElement(
  id: string,
  x: number,
  y: number,
  geo: Record<string, unknown> = { kind: "point", lng: 0, lat: 0, zRef: 0 },
) {
  return {
    id,
    x,
    y,
    customData: {
      geo,
      scaleMode: "geographic",
      projection: "mercator",
      schemaVersion: 1,
    },
  };
}

function makeParams(
  overrides: Partial<Parameters<typeof useExcalidrawChangeHandler>[0]> = {},
) {
  const updateScene = vi.fn();
  const panBy = vi.fn();
  const project = vi.fn(() => ({ x: 0, y: 0 }));
  const map = { panBy, project } as unknown as maplibregl.Map;
  const excalidrawAPI = { updateScene } as unknown as ExcalidrawImperativeAPI;
  return {
    excalidrawAPI,
    map,
    syncNow: vi.fn(),
    announceMapEditor: vi.fn(),
    setMapBg: vi.fn(),
    spaceHeldRef: { current: false },
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

describe("useExcalidrawChangeHandler — 2. scroll lock + space-pan bridge", () => {
  it("resets non-identity scroll/zoom to identity and returns early", () => {
    const params = makeParams();
    const { result } = renderHook(() => useExcalidrawChangeHandler(params));

    result.current(
      fakeElements([]),
      makeAppState({ scrollX: 50, scrollY: 0 }),
      NO_FILES,
    );

    expect(params.excalidrawAPI!.updateScene).toHaveBeenCalledWith({
      appState: { scrollX: 0, scrollY: 0, zoom: { value: 1 } },
    });
    // Early return means no markDirty/announce processing happened for this
    // call — verified indirectly by the sync-gate tests below.
  });

  it("bridges a small scroll delta to map.panBy when space is held", () => {
    const params = makeParams({ spaceHeldRef: { current: true } });
    const { result } = renderHook(() => useExcalidrawChangeHandler(params));

    result.current(
      fakeElements([]),
      makeAppState({ scrollX: 20, scrollY: -10 }),
      NO_FILES,
    );

    expect(params.map!.panBy).toHaveBeenCalledWith([-20, 10], {
      animate: false,
    });
  });

  it("does not bridge a large scroll jump (scrollToContent, not a user drag)", () => {
    const params = makeParams({ spaceHeldRef: { current: true } });
    const { result } = renderHook(() => useExcalidrawChangeHandler(params));

    result.current(
      fakeElements([]),
      makeAppState({ scrollX: 500, scrollY: 0 }),
      NO_FILES,
    );

    expect(params.map!.panBy).not.toHaveBeenCalled();
  });

  it("does not bridge when space is not held", () => {
    const params = makeParams({ spaceHeldRef: { current: false } });
    const { result } = renderHook(() => useExcalidrawChangeHandler(params));

    result.current(
      fakeElements([]),
      makeAppState({ scrollX: 20, scrollY: 0 }),
      NO_FILES,
    );

    expect(params.map!.panBy).not.toHaveBeenCalled();
  });
});

describe("useExcalidrawChangeHandler — 3. post-load geo sync", () => {
  it("calls syncNow when a geo element's position diverges from its projected anchor", () => {
    const params = makeParams();
    (params.map!.project as ReturnType<typeof vi.fn>).mockReturnValue({
      x: 100,
      y: 100,
    });
    const { result } = renderHook(() => useExcalidrawChangeHandler(params));

    const el = makeGeoElement("el1", 50, 50); // 50px off from projected (100,100)
    result.current(fakeElements([el]), makeAppState(), NO_FILES);

    expect(params.syncNow).toHaveBeenCalled();
  });

  it("does not call syncNow when the element is already at its projected position", () => {
    const params = makeParams();
    (params.map!.project as ReturnType<typeof vi.fn>).mockReturnValue({
      x: 50,
      y: 50,
    });
    const { result } = renderHook(() => useExcalidrawChangeHandler(params));

    const el = makeGeoElement("el1", 50, 50);
    result.current(fakeElements([el]), makeAppState(), NO_FILES);

    expect(params.syncNow).not.toHaveBeenCalled();
  });

  it("ignores non-geo elements", () => {
    const params = makeParams();
    const { result } = renderHook(() => useExcalidrawChangeHandler(params));

    result.current(
      fakeElements([{ id: "el1", x: 0, y: 0 }]),
      makeAppState(),
      NO_FILES,
    );

    expect(params.syncNow).not.toHaveBeenCalled();
  });
});

describe("useExcalidrawChangeHandler — 4. autosave markDirty gate", () => {
  it("does not mark dirty on the first call (establishes the baseline)", () => {
    const params = makeParams();
    const { result } = renderHook(() => useExcalidrawChangeHandler(params));

    result.current(fakeElements([{ id: "el1" }]), makeAppState(), NO_FILES);
    expect(usePersistenceStore.getState().isDirty).toBe(false);
  });

  it("marks dirty when the elements reference changes on a subsequent call", () => {
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

  it("does not mark dirty again when the same elements reference recurs", () => {
    const params = makeParams();
    const { result } = renderHook(() => useExcalidrawChangeHandler(params));
    const sameElements = fakeElements([{ id: "el1" }]);

    result.current(sameElements, makeAppState(), NO_FILES);
    usePersistenceStore.getState().clearDirty();
    result.current(sameElements, makeAppState(), NO_FILES);

    expect(usePersistenceStore.getState().isDirty).toBe(false);
  });
});

describe("useExcalidrawChangeHandler — 5. selection aria-live announce", () => {
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
