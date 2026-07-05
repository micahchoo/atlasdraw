// SPDX-License-Identifier: AGPL-3.0-only
// Characterization tests for useMapEditorKeyboard — extracted from
// MapEditor.tsx (DEADWOOD.md god-module split, Cut 4). No test covered
// either keyboard binding directly before this extraction.

import { afterEach, describe, expect, it, vi } from "vitest";
import { renderHook, cleanup } from "@testing-library/react";

import type { ExcalidrawImperativeAPI } from "@atlasdraw/excalidraw";

import { useMapEditorKeyboard } from "./useMapEditorKeyboard";

function fireKey(
  init: Partial<KeyboardEventInit> & { key?: string; code?: string },
  target?: EventTarget,
) {
  const event = new KeyboardEvent("keydown", { bubbles: true, ...init });
  (target ?? window).dispatchEvent(event);
}

function fireKeyUp(init: Partial<KeyboardEventInit> & { code?: string }) {
  window.dispatchEvent(new KeyboardEvent("keyup", { bubbles: true, ...init }));
}

function baseParams(
  overrides: Partial<Parameters<typeof useMapEditorKeyboard>[0]> = {},
) {
  return {
    spaceHeldRef: { current: false },
    excalidrawAPI: null as ExcalidrawImperativeAPI | null,
    showShortcuts: false,
    setShowShortcuts: vi.fn(),
    setShowQuickActions: vi.fn(),
    onSave: vi.fn(),
    onOpen: vi.fn(),
    ...overrides,
  };
}

afterEach(() => {
  cleanup();
});

describe("useMapEditorKeyboard — space-held tracker", () => {
  it("sets spaceHeldRef true on keydown Space and false on keyup", () => {
    const params = baseParams();
    renderHook(() => useMapEditorKeyboard(params));

    fireKey({ code: "Space" });
    expect(params.spaceHeldRef.current).toBe(true);

    fireKeyUp({ code: "Space" });
    expect(params.spaceHeldRef.current).toBe(false);
  });

  it("ignores repeat keydown events (does not re-trigger)", () => {
    const params = baseParams();
    renderHook(() => useMapEditorKeyboard(params));

    fireKey({ code: "Space", repeat: true });
    expect(params.spaceHeldRef.current).toBe(false);
  });

  it("removes its listeners on unmount", () => {
    const params = baseParams();
    const { unmount } = renderHook(() => useMapEditorKeyboard(params));
    unmount();

    fireKey({ code: "Space" });
    expect(params.spaceHeldRef.current).toBe(false);
  });
});

describe("useMapEditorKeyboard — shortcut bindings", () => {
  it("toggles quick actions on Cmd+K", () => {
    const params = baseParams();
    renderHook(() => useMapEditorKeyboard(params));

    fireKey({ key: "k", metaKey: true });
    expect(params.setShowQuickActions).toHaveBeenCalledTimes(1);
    const updater = params.setShowQuickActions.mock.calls[0][0];
    expect(updater(false)).toBe(true);
  });

  it("calls onSave on Cmd+S and prevents default", () => {
    const params = baseParams();
    renderHook(() => useMapEditorKeyboard(params));

    const event = new KeyboardEvent("keydown", {
      key: "s",
      metaKey: true,
      cancelable: true,
    });
    const preventSpy = vi.spyOn(event, "preventDefault");
    window.dispatchEvent(event);

    expect(params.onSave).toHaveBeenCalledWith(null);
    expect(preventSpy).toHaveBeenCalled();
  });

  it("calls onOpen on Cmd+O", () => {
    const params = baseParams();
    renderHook(() => useMapEditorKeyboard(params));

    fireKey({ key: "o", metaKey: true });
    expect(params.onOpen).toHaveBeenCalledWith(null);
  });

  it("does not fire save/open when Shift is also held", () => {
    const params = baseParams();
    renderHook(() => useMapEditorKeyboard(params));

    fireKey({ key: "s", metaKey: true, shiftKey: true });
    fireKey({ key: "o", metaKey: true, shiftKey: true });
    expect(params.onSave).not.toHaveBeenCalled();
    expect(params.onOpen).not.toHaveBeenCalled();
  });

  it("toggles the shortcuts panel on bare `?`", () => {
    const params = baseParams();
    renderHook(() => useMapEditorKeyboard(params));

    fireKey({ key: "?" });
    expect(params.setShowShortcuts).toHaveBeenCalledTimes(1);
    const updater = params.setShowShortcuts.mock.calls[0][0];
    expect(updater(false)).toBe(true);
  });

  it("ignores `?` typed into an input or textarea", () => {
    const params = baseParams();
    renderHook(() => useMapEditorKeyboard(params));

    const input = document.createElement("input");
    document.body.appendChild(input);
    fireKey({ key: "?" }, input);
    expect(params.setShowShortcuts).not.toHaveBeenCalled();
    document.body.removeChild(input);
  });

  it("dismisses the shortcuts panel on Escape only when it's open", () => {
    const openParams = baseParams({ showShortcuts: true });
    renderHook(() => useMapEditorKeyboard(openParams));
    fireKey({ key: "Escape" });
    expect(openParams.setShowShortcuts).toHaveBeenCalledWith(false);

    cleanup();

    const closedParams = baseParams({ showShortcuts: false });
    renderHook(() => useMapEditorKeyboard(closedParams));
    fireKey({ key: "Escape" });
    expect(closedParams.setShowShortcuts).not.toHaveBeenCalled();
  });

  it("passes the live excalidrawAPI through to onSave/onOpen", () => {
    const fakeAPI = { id: "fake" } as unknown as ExcalidrawImperativeAPI;
    const params = baseParams({ excalidrawAPI: fakeAPI });
    renderHook(() => useMapEditorKeyboard(params));

    fireKey({ key: "s", metaKey: true });
    expect(params.onSave).toHaveBeenCalledWith(fakeAPI);
  });
});
