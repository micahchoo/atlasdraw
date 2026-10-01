// SPDX-License-Identifier: AGPL-3.0-only
//
// useCommandKeys: one keydown listener runs the command a key names. The
// browser decides what reaches it, so a few cases here model the drawing as
// an element below the window with its own keydown listener.

import { act, cleanup, renderHook } from "@testing-library/react";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

import { PinTool } from "@atlasdraw/tools";

import { testSession } from "../session/__tests__/sessionFixture";

import { useCommandKeys } from "./useCommandKeys";

import type { Command } from "./commands";
import type { EditorSession } from "../session/EditorSession";
import type maplibregl from "maplibre-gl";

function fireKey(
  init: KeyboardEventInit,
  target: EventTarget = window,
): KeyboardEvent {
  const event = new KeyboardEvent("keydown", {
    bubbles: true,
    cancelable: true,
    ...init,
  });
  target.dispatchEvent(event);
  return event;
}

function command(
  id: string,
  keys: Command["keys"],
  available = () => true,
): Command & { run: ReturnType<typeof vi.fn> } {
  return { id, label: id, group: "Tools", keys, available, run: vi.fn() };
}

let session: EditorSession;
beforeEach(() => {
  session = testSession();
});
afterEach(() => {
  cleanup();
  document.body.innerHTML = "";
});

describe("a key runs its command", () => {
  it("runs the command, and the browser does not act on the key", () => {
    const save = command("save", [{ key: "s", mod: true }]);
    renderHook(() => useCommandKeys(session, [save]));

    const event = fireKey({ key: "s", ctrlKey: true });

    expect(save.run).toHaveBeenCalledWith(session);
    expect(event.defaultPrevented).toBe(true);
  });

  it("takes the key before the drawing sees it", () => {
    const help = command("help", [{ key: "?" }]);
    renderHook(() => useCommandKeys(session, [help]));
    const drawing = document.createElement("div");
    document.body.appendChild(drawing);
    const editor = vi.fn();
    drawing.addEventListener("keydown", editor);

    fireKey({ key: "?", shiftKey: true }, drawing);

    expect(help.run).toHaveBeenCalledTimes(1);
    expect(editor).not.toHaveBeenCalled();
  });

  it("leaves every other key to the drawing", () => {
    const comment = command("comment", [{ key: "c" }]);
    renderHook(() => useCommandKeys(session, [comment]));
    const drawing = document.createElement("div");
    document.body.appendChild(drawing);
    const editor = vi.fn();
    drawing.addEventListener("keydown", editor);

    // Copy, copy styles, copy as PNG: the drawing's, not the comment mode's.
    for (const init of [
      { key: "c", ctrlKey: true },
      { key: "c", metaKey: true, altKey: true },
      { key: "c", altKey: true, shiftKey: true },
      { key: "C", shiftKey: true },
    ]) {
      expect(fireKey(init, drawing).defaultPrevented).toBe(false);
    }
    expect(comment.run).not.toHaveBeenCalled();
    expect(editor).toHaveBeenCalledTimes(4);
  });

  it("an unavailable command lets its key through", () => {
    const save = command("save", [{ key: "s", mod: true }], () => false);
    renderHook(() => useCommandKeys(session, [save]));

    const event = fireKey({ key: "s", ctrlKey: true });

    expect(save.run).not.toHaveBeenCalled();
    expect(event.defaultPrevented).toBe(false);
  });
});

describe("typing, repeats and open dialogs", () => {
  function typedInto(tag: string): HTMLElement {
    const el = document.createElement(tag);
    if (tag === "div") {
      el.setAttribute("contenteditable", "true");
      // jsdom does not derive isContentEditable from the attribute.
      Object.defineProperty(el, "isContentEditable", { value: true });
    }
    document.body.appendChild(el);
    return el;
  }

  it("a bare key typed into a field types; it runs nothing", () => {
    const comment = command("comment", [{ key: "c" }]);
    renderHook(() => useCommandKeys(session, [comment]));

    for (const tag of ["input", "textarea", "div"]) {
      fireKey({ key: "c" }, typedInto(tag));
    }

    expect(comment.run).not.toHaveBeenCalled();
  });

  it("a key marked whileTyping runs from a field too", () => {
    const palette = command("palette", [
      { key: "k", mod: true, whileTyping: true },
    ]);
    renderHook(() => useCommandKeys(session, [palette]));

    fireKey({ key: "k", metaKey: true }, typedInto("input"));

    expect(palette.run).toHaveBeenCalledTimes(1);
  });

  it("a held key toggles once; a key marked repeat repeats", () => {
    const comment = command("comment", [{ key: "c" }]);
    const zoomIn = command("zoom", [
      { key: "+", mod: true, codes: ["Equal"], repeat: true },
    ]);
    renderHook(() => useCommandKeys(session, [comment, zoomIn]));

    fireKey({ key: "c" });
    fireKey({ key: "c", repeat: true });
    fireKey({ key: "c", repeat: true });
    fireKey({ code: "Equal", ctrlKey: true });
    fireKey({ code: "Equal", ctrlKey: true, repeat: true });

    expect(comment.run).toHaveBeenCalledTimes(1);
    expect(zoomIn.run).toHaveBeenCalledTimes(2);
  });

  it("while a dialog is open no command runs, not even a mod key", () => {
    const comment = command("comment", [{ key: "c" }]);
    const open = command("open", [{ key: "o", mod: true }]);
    renderHook(() => useCommandKeys(session, [comment, open]));
    void session.view.getState().ask({
      title: "Clear the drawing?",
      body: "…",
      confirmLabel: "Clear",
    });

    fireKey({ key: "c" });
    const event = fireKey({ key: "o", ctrlKey: true });

    expect(comment.run).not.toHaveBeenCalled();
    expect(open.run).not.toHaveBeenCalled();
    // The browser's own Ctrl+O is not left to open a file picker either.
    expect(event.defaultPrevented).toBe(true);
    expect(session.view.getState().dialog?.kind).toBe("confirm");
  });

  it("a dialog's own command still runs on its key (Ctrl+K closes the palette)", () => {
    const palette = command("palette", [
      { key: "k", mod: true, whileTyping: true },
    ]);
    const save = command("save", [{ key: "s", mod: true }]);
    renderHook(() => useCommandKeys(session, [palette, save]));
    session.view.getState().openDialog({ kind: "palette" });
    act(() => {
      session.keys.push({
        name: "palette",
        layer: "dialog",
        onKey: () => false,
        commands: ["palette"],
      });
    });

    fireKey({ key: "k", ctrlKey: true });
    fireKey({ key: "s", ctrlKey: true });

    expect(palette.run).toHaveBeenCalledTimes(1);
    expect(save.run).not.toHaveBeenCalled();
  });
});

describe("the editor's commands on their keys", () => {
  function fakeMap() {
    const map = {
      zoom: 10,
      zoomIn: () => void (map.zoom += 1),
      zoomOut: () => void (map.zoom -= 1),
      fitBounds: vi.fn(),
    };
    return map;
  }

  it("? opens the shortcuts, c toggles comment mode, m the Measure tool, Ctrl+K the palette", () => {
    renderHook(() => useCommandKeys(session));
    const view = () => session.view.getState();

    fireKey({ key: "c" });
    expect(view().commentMode).toBe(true);
    fireKey({ key: "m" });
    expect(view().measuring).toBe(true);
    fireKey({ key: "?", shiftKey: true });
    expect(view().dialog).toEqual({ kind: "shortcuts" });
    view().closeDialog();
    fireKey({ key: "k", ctrlKey: true });
    expect(view().dialog).toEqual({ kind: "palette" });
  });

  it("the zoom keys move the map, from the numpad too", () => {
    const map = fakeMap();
    session.view.getState().setMap(map as unknown as maplibregl.Map);
    renderHook(() => useCommandKeys(session));

    fireKey({ key: "=", code: "Equal", ctrlKey: true });
    fireKey({ key: "+", code: "NumpadAdd", metaKey: true });
    fireKey({ key: "-", code: "Minus", ctrlKey: true });

    expect(map.zoom).toBe(11);
  });
});

describe("Escape", () => {
  it("leaves comment mode", () => {
    renderHook(() => useCommandKeys(session));
    session.view.getState().setCommentMode(true);

    fireKey({ key: "Escape" });

    expect(session.view.getState().commentMode).toBe(false);
  });

  it("cancels the Pin tool (its hint promises it)", () => {
    renderHook(() => useCommandKeys(session));
    act(() => session.view.getState().setAtlasTool(PinTool));

    const event = fireKey({ key: "Escape" });

    expect(session.view.getState().atlasTool).toBeNull();
    expect(event.defaultPrevented).toBe(true);
  });

  it("in an open menu, closes the menu and leaves the tool on", () => {
    renderHook(() => useCommandKeys(session));
    act(() => session.view.getState().setAtlasTool(PinTool));
    const menu = document.createElement("div");
    menu.setAttribute("role", "menu");
    const item = document.createElement("button");
    menu.appendChild(item);
    document.body.appendChild(menu);

    fireKey({ key: "Escape" }, item);

    expect(session.view.getState().atlasTool).toBe(PinTool);
  });

  it("with a dialog open, leaves the mode alone: the dialog takes its own Escape", () => {
    renderHook(() => useCommandKeys(session));
    session.view.getState().setCommentMode(true);
    session.view.getState().openDialog({ kind: "shortcuts" });

    fireKey({ key: "Escape" });

    expect(session.view.getState().commentMode).toBe(true);
  });

  describe("with focus in the drawing", () => {
    // Excalidraw takes Escape at its root while a tool other than selection
    // is active and stops it there. The key scopes listen on the window in
    // the capture phase, before it.
    function drawing() {
      const layer = document.createElement("div");
      const canvas = document.createElement("div");
      layer.appendChild(canvas);
      document.body.appendChild(layer);
      const excalidraw = vi.fn((e: Event) => e.stopPropagation());
      canvas.addEventListener("keydown", excalidraw);
      return { layer, canvas, excalidraw };
    }

    it("leaves comment mode before the drawing sees it", () => {
      const { canvas, excalidraw } = drawing();
      renderHook(() => useCommandKeys(session));
      session.view.getState().setCommentMode(true);

      fireKey({ key: "Escape" }, canvas);

      expect(session.view.getState().commentMode).toBe(false);
      expect(excalidraw).not.toHaveBeenCalled();
    });

    it("goes to the drawing when comment mode is off", () => {
      const { canvas, excalidraw } = drawing();
      renderHook(() => useCommandKeys(session));

      fireKey({ key: "Escape" }, canvas);

      expect(excalidraw).toHaveBeenCalledTimes(1);
    });

    it("in a text box, stays with the text box", () => {
      const { layer } = drawing();
      const textarea = document.createElement("textarea");
      layer.appendChild(textarea);
      const typed = vi.fn();
      textarea.addEventListener("keydown", typed);
      renderHook(() => useCommandKeys(session));
      session.view.getState().setCommentMode(true);

      fireKey({ key: "Escape" }, textarea);

      expect(typed).toHaveBeenCalledTimes(1);
      expect(session.view.getState().commentMode).toBe(true);
    });
  });
});
