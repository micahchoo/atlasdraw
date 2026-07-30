// SPDX-License-Identifier: AGPL-3.0-only
// Characterization tests for useMapEditorKeyboard — extracted from
// MapEditor.tsx (DEADWOOD.md god-module split, Cut 4). No test covered
// either keyboard binding directly before this extraction.

import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { renderHook, cleanup } from "@testing-library/react";

import type { ExcalidrawImperativeAPI } from "@atlasdraw/excalidraw";

import {
  isCommentModeActive,
  __resetForTest as __resetCommentMode,
} from "../state/commentMode";

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
    const updater = vi.mocked(params.setShowQuickActions).mock.calls[0][0];
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
    const updater = vi.mocked(params.setShowShortcuts).mock.calls[0][0];
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

// ---------------------------------------------------------------------------
// Step 5 — comment mode on bare `c`
//
// KEYBINDING AUDIT (the reason a bare letter is defensible here): system.md:43
// keeps the interaction model Excalidraw's, so `c` had to be shown free first.
// Excalidraw's tool table (packages/excalidraw/components/shapes.tsx) binds
// h v r d o a l p x t e k and 0-9 — no `c`. The only C bindings anywhere in
// packages/ are Ctrl/Cmd+Alt+C (actionStyles.ts:66, copy styles) and
// Alt+Shift+C (actionClipboard.tsx:251, copy as PNG); Ctrl+C is the browser's
// native copy event, not a keyTest. `Shift+C` was free too. The cases below
// pin that all three of those combinations still fall through to Excalidraw.
// ---------------------------------------------------------------------------

describe("useMapEditorKeyboard — comment mode (`c`)", () => {
  beforeEach(() => {
    __resetCommentMode();
  });
  afterEach(() => {
    __resetCommentMode();
  });

  it("toggles comment mode on bare `c`, both ways", () => {
    renderHook(() => useMapEditorKeyboard(baseParams()));

    fireKey({ key: "c" });
    expect(isCommentModeActive()).toBe(true);

    fireKey({ key: "c" });
    expect(isCommentModeActive()).toBe(false);
  });

  it("ignores auto-repeat, so holding `c` enters the mode exactly once", () => {
    // Same guard, same reason as the Space tracker above: a held key repeats
    // ~30×/s, and a toggle driven by that lands on repeat parity — plus every
    // odd flip runs the exit path, which destroys an open draft.
    renderHook(() => useMapEditorKeyboard(baseParams()));

    fireKey({ key: "c" });
    expect(isCommentModeActive()).toBe(true);

    for (let i = 0; i < 5; i++) {
      fireKey({ key: "c", repeat: true });
    }
    expect(isCommentModeActive()).toBe(true);
  });

  it("leaves every Excalidraw C binding alone", () => {
    renderHook(() => useMapEditorKeyboard(baseParams()));

    // Ctrl+C — native copy. Cmd/Ctrl+Alt+C — copyStyles. Alt+Shift+C —
    // copyAsPng. Shift+C — unbound upstream, and we did not take it either.
    for (const init of [
      { key: "c", ctrlKey: true },
      { key: "c", metaKey: true },
      { key: "c", ctrlKey: true, altKey: true },
      { key: "c", altKey: true, shiftKey: true },
      { key: "C", shiftKey: true },
    ]) {
      fireKey(init);
      expect(isCommentModeActive()).toBe(false);
    }
  });

  it("does not fire while the user is typing", () => {
    renderHook(() => useMapEditorKeyboard(baseParams()));

    for (const tag of ["input", "textarea"]) {
      const el = document.createElement(tag);
      document.body.appendChild(el);
      fireKey({ key: "c" }, el);
      expect(isCommentModeActive()).toBe(false);
      document.body.removeChild(el);
    }

    // contenteditable too — Excalidraw's wysiwyg and any future rich composer
    const div = document.createElement("div");
    div.setAttribute("contenteditable", "true");
    // jsdom does not implement isContentEditable off the attribute.
    Object.defineProperty(div, "isContentEditable", { value: true });
    document.body.appendChild(div);
    fireKey({ key: "c" }, div);
    expect(isCommentModeActive()).toBe(false);
    document.body.removeChild(div);
  });

  it("Escape leaves comment mode", () => {
    renderHook(() => useMapEditorKeyboard(baseParams()));

    fireKey({ key: "c" });
    expect(isCommentModeActive()).toBe(true);

    fireKey({ key: "Escape" });
    expect(isCommentModeActive()).toBe(false);
  });

  it("Escape closes the shortcuts panel FIRST, leaving the mode intact", () => {
    // One Escape, one dismissal — otherwise opening help while commenting and
    // pressing Escape would silently drop you out of the mode as well.
    const params = baseParams({ showShortcuts: true });
    renderHook(() => useMapEditorKeyboard(params));

    fireKey({ key: "c" });
    expect(isCommentModeActive()).toBe(true);

    fireKey({ key: "Escape" });
    expect(params.setShowShortcuts).toHaveBeenCalledWith(false);
    expect(isCommentModeActive()).toBe(true);
  });
});
