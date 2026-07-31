// SPDX-License-Identifier: AGPL-3.0-only
// Step 5 — comment MODE, at the two seams that decide whether it works.
//
// 1. useCommentModeTool: the mode's editor-side edges — it arms the anchor
//    picker and manages the atlas tool (drop on enter, restore on exit). The
//    Excalidraw tool is deliberately untouched: the overlay intercepts clicks
//    itself, so nothing is borrowed and a tool pick is not an exit.
// 2. CommentAnchorsOverlay: click → draft → post, all on the plate. This is
//    the thing that makes it a mode rather than a tab with a different button:
//    the whole gesture happens where the thread will live.
//
// Design: PLANS/ATLASDRAW_SIDEBAR_DESIGN.md §3

import React from "react";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import {
  act,
  cleanup,
  fireEvent,
  render,
  screen,
} from "@testing-library/react";
import * as Y from "yjs";

import type { ExcalidrawImperativeAPI } from "@atlasdraw/excalidraw";

import type { AtlasdrawTool } from "@atlasdraw/tools";

import { CollabContext } from "../../hooks/useCollab";
import { useCommentModeTool } from "../../hooks/useCommentModeTool";
import { CommentsLayer } from "../../state/comments";
import {
  __resetForTest as __resetCommentMode,
  isCommentModeActive,
  setCommentMode,
} from "../../state/commentMode";
import {
  __resetForTest as __resetPicker,
  setPendingAnchor,
  usePendingAnchor,
} from "../../state/comments-anchor-picker";
import { useLayerRegistryStore } from "../../state/layerRegistry";
import { CommentAnchorsOverlay } from "../CommentAnchorsOverlay";

import type { CollabContextValue } from "../../hooks/useCollab";
import type maplibregl from "maplibre-gl";

function makeLayer(): CommentsLayer {
  return new CommentsLayer({
    wsUrl: "ws://test.invalid",
    roomId: "test-room",
    workspaceId: null,
    doc: new Y.Doc(),
    providerFactory: () => null,
  });
}

/**
 * Enough of the imperative API for the overlay's hit-test + projections.
 *
 * `getAppState` returns the full app-state slice the projection math reads
 * (zoom / offset / scroll), and `getSceneElements` is configurable so the
 * element branch of the hit-test cascade can be exercised. `onChange` is a
 * real emitter — the overlay subscribes to it to re-project on scene changes.
 */
type SceneElement = {
  id: string;
  x: number;
  y: number;
  width: number;
  height: number;
};
function makeFakeAPI(sceneElements: SceneElement[] = []) {
  type Listener = (elements: unknown, appState: unknown) => void;
  const listeners = new Set<Listener>();
  return {
    api: {
      getAppState: () => ({
        zoom: { value: 1 },
        offsetLeft: 0,
        offsetTop: 0,
        scrollX: 0,
        scrollY: 0,
      }),
      getSceneElements: () => sceneElements,
      onChange: (cb: Listener) => {
        listeners.add(cb);
        return () => listeners.delete(cb);
      },
    } as unknown as ExcalidrawImperativeAPI,
  };
}

/** A stand-in for the one-shot atlas Pin tool. */
const fakePinTool = { id: "pin" } as unknown as AtlasdrawTool;

/**
 * A MapLibre stand-in with deterministic projection — lng maps to x*10, lat
 * to y*20 — so the overlay's project/unproject round-trip is assertable.
 */
function makeFakeMap() {
  return {
    map: {
      on: () => {},
      off: () => {},
      project: ([lng, lat]: [number, number]) => ({
        x: lng * 10,
        y: lat * 20,
      }),
      unproject: ([x, y]: [number, number]) => ({ lng: x, lat: y }),
    } as unknown as maplibregl.Map,
    /**
     * Click the click-intercept div at client coords. jsdom's
     * getBoundingClientRect is all zeros, so clientX/Y equal the map-pixel
     * coords the hit-test and unproject receive.
     */
    click: (clientX: number, clientY: number) => {
      act(() => {
        fireEvent.click(screen.getByTestId("comment-click-intercept"), {
          clientX,
          clientY,
        });
      });
    },
  };
}

beforeEach(() => {
  __resetCommentMode();
  __resetPicker();
});

afterEach(() => {
  cleanup();
  __resetCommentMode();
  __resetPicker();
});

// A tiny harness that mounts the hook and exposes the picker's live mode so
// the tests can observe what entering/leaving the mode does to the picker.
function Harness({
  atlasTool,
  setAtlasTool,
}: {
  atlasTool: AtlasdrawTool | null;
  setAtlasTool: (tool: AtlasdrawTool | null) => void;
}) {
  useCommentModeTool({ atlasTool, setAtlasTool });
  const { mode } = usePendingAnchor();
  return <div data-testid="picker-mode">{mode ?? "null"}</div>;
}

describe("useCommentModeTool — arms the picker, manages the atlas tool", () => {
  it("arms the picker in `any` on enter and clears it on exit", () => {
    render(<Harness atlasTool={null} setAtlasTool={vi.fn()} />);
    expect(screen.getByTestId("picker-mode").textContent).toBe("null");

    act(() => setCommentMode(true));
    expect(screen.getByTestId("picker-mode").textContent).toBe("any");

    act(() => setCommentMode(false));
    expect(screen.getByTestId("picker-mode").textContent).toBe("null");
  });

  it("drops any active atlas tool so one click cannot do two things", () => {
    const setAtlasTool = vi.fn();
    render(<Harness atlasTool={fakePinTool} setAtlasTool={setAtlasTool} />);

    act(() => setCommentMode(true));
    expect(setAtlasTool).toHaveBeenCalledWith(null);
  });

  it("restores the pre-entry atlas tool on exit", () => {
    const setAtlasTool = vi.fn();
    render(<Harness atlasTool={fakePinTool} setAtlasTool={setAtlasTool} />);

    act(() => setCommentMode(true));
    act(() => setCommentMode(false));
    expect(setAtlasTool).toHaveBeenLastCalledWith(fakePinTool);
  });

  it("does not exit when an atlas tool is armed mid-mode, and leaves it alone on exit", () => {
    // Entering drops the Pin, but the Pin button stays mounted and enabled, so
    // it can come back while the mode is live. That is no longer an exit: no
    // tool pick is. On exit the mode restores only the pre-entry tool (null
    // here), so the Pin the user armed mid-mode stays put.
    const setAtlasTool = vi.fn();
    const { rerender } = render(
      <Harness atlasTool={null} setAtlasTool={setAtlasTool} />,
    );

    act(() => setCommentMode(true));
    expect(isCommentModeActive()).toBe(true);

    // What clicking the Pin button does: setActiveAtlasTool(PinTool), which
    // re-renders this harness's owner with a non-null atlasTool.
    act(() =>
      rerender(<Harness atlasTool={fakePinTool} setAtlasTool={setAtlasTool} />),
    );

    expect(isCommentModeActive()).toBe(true);

    act(() => setCommentMode(false));
    expect(setAtlasTool).not.toHaveBeenCalledWith(fakePinTool);
    expect(setAtlasTool).toHaveBeenCalledTimes(1); // only the entry's null
  });
});

describe("CommentAnchorsOverlay — placing a thread in comment mode", () => {
  const renderOverlay = (
    commentsLayer: CommentsLayer | null,
    map: ReturnType<typeof makeFakeMap>["map"],
    api: ExcalidrawImperativeAPI,
  ) => {
    const value = { commentsLayer } as unknown as CollabContextValue;
    return render(
      <CollabContext.Provider value={value}>
        <CommentAnchorsOverlay
          map={map as never}
          excalidrawAPI={api as never}
        />
      </CollabContext.Provider>,
    );
  };

  it("shows the click-intercept in comment mode and hides it outside", () => {
    const layer = makeLayer();
    const fakeMap = makeFakeMap();
    const { api } = makeFakeAPI();
    renderOverlay(layer, fakeMap.map, api);

    expect(screen.queryByTestId("comment-click-intercept")).toBe(null);
    act(() => setCommentMode(true));
    // Zero comments AND no draft: the intercept is what makes the mode
    // placeable at all — the overlay must not bail to null here.
    expect(screen.getByTestId("comment-click-intercept")).toBeTruthy();
    act(() => setCommentMode(false));
    expect(screen.queryByTestId("comment-click-intercept")).toBe(null);
  });

  it("a bare-map click opens the draft composer at the projected anchor", () => {
    const layer = makeLayer();
    const fakeMap = makeFakeMap();
    const { api } = makeFakeAPI();
    renderOverlay(layer, fakeMap.map, api);

    act(() => setCommentMode(true));
    // Nothing on screen until a point is picked.
    expect(screen.queryByTestId("comment-draft-bubble")).toBe(null);

    fakeMap.click(10, 20);

    const draft = screen.getByTestId("comment-draft-bubble");
    // project({lng: 10, lat: 20}) → {x: 10*10, y: 20*20}
    expect(draft.style.left).toBe("100px");
    expect(draft.style.top).toBe("400px");
    expect(screen.getByTestId("comment-draft-anchor-kind").textContent).toBe(
      "Anchored to map point",
    );
  });

  it("posting writes the thread to the CommentsLayer at that lng/lat", () => {
    const layer = makeLayer();
    const fakeMap = makeFakeMap();
    const { api } = makeFakeAPI();
    renderOverlay(layer, fakeMap.map, api);

    act(() => setCommentMode(true));
    fakeMap.click(10, 20);

    fireEvent.change(screen.getByTestId("comment-draft-text"), {
      target: { value: "  drainage looks wrong here  " },
    });
    fireEvent.click(screen.getByTestId("comment-draft-submit"));

    expect(layer.comments).toHaveLength(1);
    expect(layer.comments[0]?.text).toBe("drainage looks wrong here");
    expect(layer.comments[0]?.anchor).toEqual({
      kind: "map",
      lng: 10,
      lat: 20,
    });
    expect(layer.comments[0]?.resolved).toBe(false);
  });

  it("re-arms after posting, so the next click starts the next thread", () => {
    // Submitting re-arms via setAnchorMode("any"), which nulls the anchor —
    // that is what brings the click-intercept div back. The mode staying on
    // must mean the NEXT click also works: the difference between a mode and
    // a one-shot tool.
    const layer = makeLayer();
    const fakeMap = makeFakeMap();
    const { api } = makeFakeAPI();
    renderOverlay(layer, fakeMap.map, api);

    act(() => setCommentMode(true));
    fakeMap.click(1, 2);
    fireEvent.change(screen.getByTestId("comment-draft-text"), {
      target: { value: "first" },
    });
    fireEvent.click(screen.getByTestId("comment-draft-submit"));

    expect(screen.getByTestId("comment-click-intercept")).toBeTruthy();
    fakeMap.click(3, 4);
    fireEvent.change(screen.getByTestId("comment-draft-text"), {
      target: { value: "second" },
    });
    fireEvent.click(screen.getByTestId("comment-draft-submit"));

    expect(layer.comments.map((c) => c.text)).toEqual(["first", "second"]);
  });

  it("Cancel drops the draft and leaves the intercept armed", () => {
    const layer = makeLayer();
    const fakeMap = makeFakeMap();
    const { api } = makeFakeAPI();
    renderOverlay(layer, fakeMap.map, api);

    act(() => setCommentMode(true));
    fakeMap.click(1, 2);
    fireEvent.change(screen.getByTestId("comment-draft-text"), {
      target: { value: "never mind" },
    });
    fireEvent.click(screen.getByTestId("comment-draft-cancel"));

    expect(layer.comments).toHaveLength(0);
    expect(screen.queryByTestId("comment-draft-bubble")).toBe(null);
    // still armed — cancelling a draft is not leaving the mode
    expect(screen.getByTestId("comment-click-intercept")).toBeTruthy();
  });

  it("an element hit anchors the thread to the element", () => {
    const layer = makeLayer();
    const fakeMap = makeFakeMap();
    const { api } = makeFakeAPI([
      { id: "el-1", x: 0, y: 0, width: 100, height: 50 },
    ]);
    renderOverlay(layer, fakeMap.map, api);

    act(() => setCommentMode(true));
    // (15, 30) in client coords → scene coords (15, 30) at zoom 1 → inside
    // el-1's AABB, so the cascade picks the element before the map.
    fakeMap.click(15, 30);

    expect(screen.getByTestId("comment-draft-anchor-kind").textContent).toBe(
      "Anchored to element",
    );
    fireEvent.change(screen.getByTestId("comment-draft-text"), {
      target: { value: "on the shape" },
    });
    fireEvent.click(screen.getByTestId("comment-draft-submit"));

    expect(layer.comments[0]?.anchor).toEqual({
      kind: "annotation",
      source: "element",
      elementId: "el-1",
    });
  });

  it("Pin to map on a hit drops a geographic point instead of following", () => {
    const layer = makeLayer();
    const fakeMap = makeFakeMap();
    const { api } = makeFakeAPI([
      { id: "el-1", x: 0, y: 0, width: 100, height: 50 },
    ]);
    renderOverlay(layer, fakeMap.map, api);

    act(() => setCommentMode(true));
    fakeMap.click(15, 30);
    // Default is Follow (the click hit a target); flip to Pin.
    fireEvent.click(screen.getByTestId("comment-draft-pin"));
    fireEvent.change(screen.getByTestId("comment-draft-text"), {
      target: { value: "pinned instead" },
    });
    fireEvent.click(screen.getByTestId("comment-draft-submit"));

    // Pin writes the geographic point recorded at click time.
    expect(layer.comments[0]?.anchor).toEqual({
      kind: "map",
      lng: 15,
      lat: 30,
    });
  });

  it("a raster hit anchors the thread to the raster", () => {
    // Seeded here, and this test runs after the bare-map tests: the raster's
    // projected corners (10,20)-(30,60) enclose the (10,20) click those tests
    // use, so registering it earlier would steal their map fallback.
    useLayerRegistryStore.setState({ entries: [] });
    useLayerRegistryStore.getState().registerRasterLayer({
      id: "rl:test-1",
      label: "plate",
      corners: [
        [1, 1],
        [3, 1],
        [3, 3],
        [1, 3],
      ],
      imageKey: "k",
    });
    const layer = makeLayer();
    const fakeMap = makeFakeMap();
    const { api } = makeFakeAPI();
    renderOverlay(layer, fakeMap.map, api);

    act(() => setCommentMode(true));
    // (20, 40) is inside the projected raster polygon and no element covers
    // it — the raster branch wins the cascade.
    fakeMap.click(20, 40);

    expect(screen.getByTestId("comment-draft-anchor-kind").textContent).toBe(
      "Anchored to raster",
    );
    fireEvent.change(screen.getByTestId("comment-draft-text"), {
      target: { value: "on the plate" },
    });
    fireEvent.click(screen.getByTestId("comment-draft-submit"));

    expect(layer.comments[0]?.anchor).toEqual({
      kind: "annotation",
      source: "raster",
      rasterId: "rl:test-1",
    });
  });

  it("exiting the mode clears the draft and the intercept", () => {
    const layer = makeLayer();
    const fakeMap = makeFakeMap();
    const { api } = makeFakeAPI();
    renderOverlay(layer, fakeMap.map, api);

    act(() => setCommentMode(true));
    fakeMap.click(1, 2);
    expect(screen.getByTestId("comment-draft-bubble")).toBeTruthy();

    act(() => setCommentMode(false));
    expect(screen.queryByTestId("comment-draft-bubble")).toBe(null);
    expect(screen.queryByTestId("comment-click-intercept")).toBe(null);
  });

  it("shows no draft outside comment mode, even with a pending anchor", () => {
    // The Threads list's own Map/Element toggle sets a pending anchor and
    // composes in the panel. The on-plate composer is the MODE's affordance
    // and must not hijack that path.
    const layer = makeLayer();
    const fakeMap = makeFakeMap();
    const { api } = makeFakeAPI();
    renderOverlay(layer, fakeMap.map, api);

    act(() => setPendingAnchor({ kind: "map", lng: 1, lat: 2 }));
    expect(screen.queryByTestId("comment-draft-bubble")).toBe(null);
  });
});
