// SPDX-License-Identifier: AGPL-3.0-only
// Tests for useToolState (ISSUES.md Issue 6 — coverage climb).
//
// Subscribes to Excalidraw's onChange to derive isDrawingMode for the
// Flow B pointer-events gate. classifyTool is used unmocked — it's a pure,
// already-tested function (packages/tools/src/classifyTool.test.ts); mocking
// it here would just hide the real hand/selection/drawing-tool mapping this
// hook depends on.
//
// Per .claude/rules/test-fixtures.md: this file owns its own mocks.

import { describe, it, expect, vi, afterEach } from "vitest";
import { renderHook, cleanup, act } from "@testing-library/react";

import type { ExcalidrawImperativeAPI } from "@atlasdraw/excalidraw";

import { useToolState } from "./useToolState";

type OnChangeCb = (
  elements: unknown[],
  appState: { activeTool: { type: string } },
  files: unknown,
) => void;

function makeMockAPI(initialType: string): {
  api: ExcalidrawImperativeAPI;
  fireChange: (nextType: string) => void;
  unsubscribe: ReturnType<typeof vi.fn>;
} {
  let onChangeCb: OnChangeCb | null = null;
  const unsubscribe = vi.fn();
  const api = {
    getAppState: vi.fn(() => ({ activeTool: { type: initialType } })),
    onChange: vi.fn((cb: OnChangeCb) => {
      onChangeCb = cb;
      return unsubscribe;
    }),
  } as unknown as ExcalidrawImperativeAPI;
  return {
    api,
    fireChange: (nextType: string) => {
      onChangeCb?.([], { activeTool: { type: nextType } }, undefined);
    },
    unsubscribe,
  };
}

afterEach(() => {
  cleanup();
});

describe("useToolState", () => {
  it("returns the default state (null tool, not drawing) when api is null", () => {
    const { result } = renderHook(() => useToolState(null));
    expect(result.current).toEqual({ activeTool: null, isDrawingMode: false });
  });

  it("seeds initial state synchronously from api.getAppState()", () => {
    const { api } = makeMockAPI("rectangle");
    const { result } = renderHook(() => useToolState(api));
    expect(result.current).toEqual({
      activeTool: { type: "rectangle" },
      isDrawingMode: true,
    });
  });

  it("seeds isDrawingMode false for 'hand' (map-interactive tool)", () => {
    const { api } = makeMockAPI("hand");
    const { result } = renderHook(() => useToolState(api));
    expect(result.current).toEqual({
      activeTool: { type: "hand" },
      isDrawingMode: false,
    });
  });

  it("updates state when onChange fires with a new tool type", () => {
    const { api, fireChange } = makeMockAPI("hand");
    const { result } = renderHook(() => useToolState(api));

    act(() => fireChange("freedraw"));
    expect(result.current).toEqual({
      activeTool: { type: "freedraw" },
      isDrawingMode: true,
    });
  });

  it("bails out (no re-render / same reference) when the tool type is unchanged", () => {
    const { api, fireChange } = makeMockAPI("rectangle");
    const { result } = renderHook(() => useToolState(api));
    const firstState = result.current;

    act(() => fireChange("rectangle")); // same type — onChange fires on every pointer move mid-drag
    expect(result.current).toBe(firstState);
  });

  it("unsubscribes on unmount", () => {
    const { api, unsubscribe } = makeMockAPI("selection");
    const { unmount } = renderHook(() => useToolState(api));
    unmount();
    expect(unsubscribe).toHaveBeenCalledTimes(1);
  });

  it("re-subscribes when the api instance changes", () => {
    const first = makeMockAPI("hand");
    const second = makeMockAPI("rectangle");
    const { result, rerender } = renderHook(({ api }) => useToolState(api), {
      initialProps: { api: first.api },
    });
    expect(result.current.activeTool).toEqual({ type: "hand" });

    rerender({ api: second.api });
    expect(first.unsubscribe).toHaveBeenCalledTimes(1);
    expect(result.current.activeTool).toEqual({ type: "rectangle" });
  });
});
