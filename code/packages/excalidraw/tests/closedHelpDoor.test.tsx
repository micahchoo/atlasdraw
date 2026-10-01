import React from "react";

import { KEYS } from "@atlasdraw/common";

import { Excalidraw } from "../index";

import { Keyboard } from "./helpers/ui";
import { render } from "./test-utils";

import type { UIOptions } from "../types";

// Atlasdraw addition (ADR-0010). A host with its own help surface sets
// canvasActions.toggleShortcuts to false; then `?` opens nothing here and
// the key goes on to the host. The atlas app does (MapEditor.tsx
// EXCALIDRAW_UI_OPTIONS), so `?` opens one help surface, its own.

const renderEditor = (uiOptions?: UIOptions) =>
  render(<Excalidraw UIOptions={uiOptions} handleKeyboardGlobally />);

describe("closed help door", () => {
  it("? opens the help dialog with the upstream defaults", async () => {
    await renderEditor();
    Keyboard.keyDown(KEYS.QUESTION_MARK);
    expect(window.h.state.openDialog).toEqual({ name: "help" });
  });

  it("? opens nothing, and is not consumed, when toggleShortcuts is false", async () => {
    await renderEditor({ canvasActions: { toggleShortcuts: false } });
    const seen: boolean[] = [];
    const listener = (e: KeyboardEvent) => seen.push(e.defaultPrevented);
    window.addEventListener("keydown", listener);
    Keyboard.keyDown(KEYS.QUESTION_MARK);
    window.removeEventListener("keydown", listener);
    expect(window.h.state.openDialog).toBe(null);
    expect(seen).toEqual([false]);
  });

  it("hides the footer's help button when toggleShortcuts is false", async () => {
    const { container } = await renderEditor({
      canvasActions: { toggleShortcuts: false },
    });
    expect(container.querySelector(".help-icon")).toBe(null);
  });
});
