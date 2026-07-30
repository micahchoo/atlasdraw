// SPDX-License-Identifier: AGPL-3.0-only
// Step 5 — comment MODE, at the two seams that decide whether it works.
//
// 1. useCommentModeTool: entering a mode borrows the editor; leaving it must
//    give the editor back. If the restore ever breaks, the symptom is a user
//    stuck on the hand tool with no idea why — silent, and blamed on the map.
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
  renderHook,
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
} from "../../state/comments-anchor-picker";
import { CommentAnchorsOverlay } from "../CommentAnchorsOverlay";

import type { CollabContextValue } from "../../hooks/useCollab";

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
 * Enough of the imperative API for the mode wiring + the overlay.
 *
 * `onChange` is a real emitter, because comment mode's exit-on-tool-pick reads
 * `appState.activeTool` through it — a stub that never fires would make the
 * transition untestable. Excalidraw notifies from componentDidUpdate with the
 * current state (App.tsx:3730), so every emit here carries the live tool.
 */
function makeFakeAPI(initialTool = "rectangle") {
  let tool = initialTool;
  type Listener = (elements: unknown, appState: unknown) => void;
  const listeners = new Set<Listener>();
  const emit = () => {
    for (const l of Array.from(listeners)) {
      l([], { activeTool: { type: tool } });
    }
  };
  const setActiveTool = vi.fn((next: { type: string }) => {
    tool = next.type;
    emit();
  });
  return {
    api: {
      getAppState: () => ({ activeTool: { type: tool } }),
      setActiveTool,
      getSceneElements: () => [],
      onChange: (cb: Listener) => {
        listeners.add(cb);
        return () => listeners.delete(cb);
      },
    } as unknown as ExcalidrawImperativeAPI,
    setActiveTool,
    currentTool: () => tool,
    /** What a tool shortcut / the toolbar / the ⌘K palette does to appState. */
    userPicksTool: (type: string) => {
      tool = type;
      act(() => emit());
    },
  };
}

/** A stand-in for the one-shot atlas Pin tool. */
const fakePinTool = { id: "pin" } as unknown as AtlasdrawTool;

/** A MapLibre stand-in that records `once`/`off` so arming is observable. */
function makeFakeMap() {
  const once = new Map<string, Set<(e: unknown) => void>>();
  return {
    map: {
      once: (ev: string, fn: (e: unknown) => void) => {
        if (!once.has(ev)) {
          once.set(ev, new Set());
        }
        once.get(ev)!.add(fn);
      },
      off: (ev: string, fn: (e: unknown) => void) => {
        once.get(ev)?.delete(fn);
      },
      on: () => {},
      project: () => ({ x: 42, y: 17 }),
    },
    clickListenerCount: () => once.get("click")?.size ?? 0,
    click: (lng: number, lat: number) => {
      const fns = Array.from(once.get("click") ?? []);
      once.get("click")?.clear();
      act(() => {
        fns.forEach((fn) => fn({ lngLat: { lng, lat } }));
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

describe("useCommentModeTool — the editor is borrowed, not taken", () => {
  const mount = (
    api: ExcalidrawImperativeAPI,
    atlasTool: AtlasdrawTool | null = null,
    setAtlasTool = vi.fn(),
  ) =>
    renderHook(() =>
      useCommentModeTool({ excalidrawAPI: api, atlasTool, setAtlasTool }),
    );

  it("swaps to `hand` on enter and back to the previous tool on exit", () => {
    const { api, setActiveTool, currentTool } = makeFakeAPI("rectangle");
    mount(api);

    act(() => setCommentMode(true));
    // `hand`, not `selection`: classifyTool() sends clicks to MapLibre only
    // for `hand`, and a map-anchored thread has to be placeable.
    expect(currentTool()).toBe("hand");
    expect(setActiveTool).toHaveBeenCalledWith({ type: "hand" });

    act(() => setCommentMode(false));
    expect(currentTool()).toBe("rectangle");
  });

  it("drops any active atlas tool so one click cannot do two things", () => {
    const { api } = makeFakeAPI();
    const setAtlasTool = vi.fn();
    mount(api, fakePinTool, setAtlasTool);

    act(() => setCommentMode(true));
    expect(setAtlasTool).toHaveBeenCalledWith(null);
  });

  it("puts the Pin tool back on exit, like the Excalidraw tool", () => {
    // "Borrowed, not taken" covers both tool systems or it covers neither:
    // Escape has to leave you where you were, and where you were included an
    // armed Pin.
    const { api } = makeFakeAPI();
    const setAtlasTool = vi.fn();
    mount(api, fakePinTool, setAtlasTool);

    act(() => setCommentMode(true));
    act(() => setCommentMode(false));
    expect(setAtlasTool).toHaveBeenLastCalledWith(fakePinTool);
  });

  it("does not thrash the tool when it was already `hand`", () => {
    const { api, setActiveTool } = makeFakeAPI("hand");
    mount(api);

    act(() => setCommentMode(true));
    act(() => setCommentMode(false));
    expect(setActiveTool).not.toHaveBeenCalled();
  });
});

// ---------------------------------------------------------------------------
// The mode cannot outlive the tool it needs.
//
// `classifyTool` only routes clicks to MapLibre for `hand`, so the instant the
// active tool is anything else the anchor picker is unreachable — while the
// crosshair, the on-plate hint and the rail's `aria-pressed` all keep saying
// the mode is live. Chosen resolution: picking a real tool EXITS the mode. The
// cases below pin every signal to that one decision.
// ---------------------------------------------------------------------------

describe("useCommentModeTool — a tool pick is an exit", () => {
  const mount = (
    api: ExcalidrawImperativeAPI,
    atlasTool: AtlasdrawTool | null = null,
    setAtlasTool = vi.fn(),
  ) =>
    renderHook(() =>
      useCommentModeTool({ excalidrawAPI: api, atlasTool, setAtlasTool }),
    );

  it("leaves the mode when the active tool changes under it", () => {
    const { api, userPicksTool } = makeFakeAPI("selection");
    mount(api);

    act(() => setCommentMode(true));
    expect(isCommentModeActive()).toBe(true);

    // `r` — the user wants a rectangle, not a thread.
    userPicksTool("rectangle");
    expect(isCommentModeActive()).toBe(false);
  });

  it("leaves the tool the user picked alone — no restore on that path", () => {
    // The bug this replaces: exiting restored the pre-mode tool, silently
    // undoing the keystroke that caused the exit.
    const { api, currentTool, userPicksTool } = makeFakeAPI("ellipse");
    mount(api);

    act(() => setCommentMode(true));
    expect(currentTool()).toBe("hand");

    // The pick WAS the exit, so no later restore can overwrite it — not now,
    // and not when a stray setCommentMode(false) arrives afterwards.
    userPicksTool("rectangle");
    expect(currentTool()).toBe("rectangle");
    act(() => setCommentMode(false));
    expect(currentTool()).toBe("rectangle");
  });

  it("does not re-arm the Pin tool on that path either", () => {
    const { api, userPicksTool } = makeFakeAPI();
    const setAtlasTool = vi.fn();
    mount(api, fakePinTool, setAtlasTool);

    act(() => setCommentMode(true));
    userPicksTool("rectangle");
    expect(setAtlasTool).toHaveBeenLastCalledWith(null);
  });

  it("stays in the mode when the tool is set to `hand` — that IS the mode", () => {
    const { api, userPicksTool } = makeFakeAPI("selection");
    mount(api);

    act(() => setCommentMode(true));
    userPicksTool("hand");
    expect(isCommentModeActive()).toBe(true);
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

  it("arms the map picker on enter and disarms it on exit", () => {
    const layer = makeLayer();
    const fakeMap = makeFakeMap();
    const { api } = makeFakeAPI();
    // The mode's side effects live in useCommentModeTool, so mount it too.
    renderHook(() =>
      useCommentModeTool({
        excalidrawAPI: api,
        atlasTool: null,
        setAtlasTool: () => {},
      }),
    );
    renderOverlay(layer, fakeMap.map, api);

    expect(fakeMap.clickListenerCount()).toBe(0);
    act(() => setCommentMode(true));
    expect(fakeMap.clickListenerCount()).toBe(1);
    act(() => setCommentMode(false));
    expect(fakeMap.clickListenerCount()).toBe(0);
  });

  it("a map click opens the draft composer at the projected anchor", () => {
    const layer = makeLayer();
    const fakeMap = makeFakeMap();
    const { api } = makeFakeAPI();
    renderHook(() =>
      useCommentModeTool({
        excalidrawAPI: api,
        atlasTool: null,
        setAtlasTool: () => {},
      }),
    );
    renderOverlay(layer, fakeMap.map, api);

    act(() => setCommentMode(true));
    // Nothing on screen until a point is picked — and note there are ZERO
    // comments, which used to make the overlay return null outright.
    expect(screen.queryByTestId("comment-draft-bubble")).toBe(null);

    fakeMap.click(-122.33, 47.6);

    const draft = screen.getByTestId("comment-draft-bubble");
    expect(draft.style.left).toBe("42px");
    expect(draft.style.top).toBe("17px");
    expect(screen.getByTestId("comment-draft-anchor-kind").textContent).toBe(
      "Anchored to map point",
    );
  });

  it("posting writes the thread to the CommentsLayer at that lng/lat", () => {
    const layer = makeLayer();
    const fakeMap = makeFakeMap();
    const { api } = makeFakeAPI();
    renderHook(() =>
      useCommentModeTool({
        excalidrawAPI: api,
        atlasTool: null,
        setAtlasTool: () => {},
      }),
    );
    renderOverlay(layer, fakeMap.map, api);

    act(() => setCommentMode(true));
    fakeMap.click(-122.33, 47.6);

    fireEvent.change(screen.getByTestId("comment-draft-text"), {
      target: { value: "  drainage looks wrong here  " },
    });
    fireEvent.click(screen.getByTestId("comment-draft-submit"));

    expect(layer.comments).toHaveLength(1);
    expect(layer.comments[0]?.text).toBe("drainage looks wrong here");
    expect(layer.comments[0]?.anchor).toEqual({
      kind: "map",
      lng: -122.33,
      lat: 47.6,
    });
    expect(layer.comments[0]?.resolved).toBe(false);
  });

  it("re-arms after posting, so the next click starts the next thread", () => {
    // The pickers are one-shot (`map.once`). Comment mode staying on has to
    // mean the NEXT click also works — that is the difference between a mode
    // and a one-shot tool. PickerState.arm is what carries it: `mode` is
    // "any" on both sides of the post, so mode alone cannot express a re-arm.
    const layer = makeLayer();
    const fakeMap = makeFakeMap();
    const { api } = makeFakeAPI();
    renderHook(() =>
      useCommentModeTool({
        excalidrawAPI: api,
        atlasTool: null,
        setAtlasTool: () => {},
      }),
    );
    renderOverlay(layer, fakeMap.map, api);

    act(() => setCommentMode(true));
    fakeMap.click(1, 2);
    fireEvent.change(screen.getByTestId("comment-draft-text"), {
      target: { value: "first" },
    });
    fireEvent.click(screen.getByTestId("comment-draft-submit"));

    expect(fakeMap.clickListenerCount()).toBe(1);
    fakeMap.click(3, 4);
    fireEvent.change(screen.getByTestId("comment-draft-text"), {
      target: { value: "second" },
    });
    fireEvent.click(screen.getByTestId("comment-draft-submit"));

    expect(layer.comments.map((c) => c.text)).toEqual(["first", "second"]);
  });

  it("Cancel drops the draft and leaves nothing behind", () => {
    const layer = makeLayer();
    const fakeMap = makeFakeMap();
    const { api } = makeFakeAPI();
    renderHook(() =>
      useCommentModeTool({
        excalidrawAPI: api,
        atlasTool: null,
        setAtlasTool: () => {},
      }),
    );
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
    expect(fakeMap.clickListenerCount()).toBe(1);
  });

  it("disarms both pickers when a tool pick ends the mode", () => {
    // The consequence that made this a bug rather than a cosmetic lie: the
    // element picker stays armed, drawing a shape auto-selects it, and a draft
    // composer opens on an element the user never asked to annotate.
    const layer = makeLayer();
    const fakeMap = makeFakeMap();
    const { api, userPicksTool } = makeFakeAPI("selection");
    renderHook(() =>
      useCommentModeTool({
        excalidrawAPI: api,
        atlasTool: null,
        setAtlasTool: () => {},
      }),
    );
    renderOverlay(layer, fakeMap.map, api);

    act(() => setCommentMode(true));
    expect(fakeMap.clickListenerCount()).toBe(1);

    userPicksTool("rectangle");
    expect(isCommentModeActive()).toBe(false);
    expect(fakeMap.clickListenerCount()).toBe(0);
    expect(screen.queryByTestId("comment-draft-bubble")).toBe(null);
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
