import React from "react";
import { vi } from "vitest";

import { CODES, KEYS } from "@atlasdraw/common";

import { CommandPalette, Excalidraw } from "../index";
import * as data from "../data/index";
import * as json from "../data/json";

import { API } from "./helpers/api";
import { Keyboard, UI } from "./helpers/ui";
import { GlobalTestState, act, fireEvent, render, waitFor } from "./test-utils";

import type { UIOptions } from "../types";

// Atlasdraw addition (code/decisions/0010-own-the-fork.md). A host that sets
// these canvasActions to false closes every upstream door that writes an image
// or an .excalidraw file: the keyboard shortcuts, the command-palette entries
// and the copy-as-image items of the context menu. The atlas app uses exactly
// these options (MapEditor.tsx EXCALIDRAW_UI_OPTIONS), so its own Export dialog
// and the .atlasdraw bundle are the only doors. Each case also runs with the
// upstream defaults, to show that the probe can see an open door.

// The copy actions check clipboard support once, when their module loads,
// and jsdom has no clipboard. Without this stub the copy items never show,
// and the closed-door cases below would pass without testing anything.
vi.hoisted(() => {
  Object.defineProperty(navigator, "clipboard", {
    configurable: true,
    value: { writeText: async () => {}, write: async () => {} },
  });
});

const CLOSED: UIOptions = {
  canvasActions: {
    loadScene: false,
    saveToActiveFile: false,
    export: false,
    saveAsImage: false,
  },
};

const renderEditor = (uiOptions?: UIOptions) =>
  render(
    <Excalidraw
      UIOptions={uiOptions}
      initialData={{ elements: [API.createElement({ type: "rectangle" })] }}
      handleKeyboardGlobally
    >
      <CommandPalette />
    </Excalidraw>,
  );

const paletteLabels = async () => {
  act(() => {
    API.setAppState({ openDialog: { name: "commandPalette" } });
  });
  await waitFor(() =>
    expect(document.querySelector(".command-item")).not.toBe(null),
  );
  return Array.from(document.querySelectorAll(".command-item")).map(
    (item) => item.textContent ?? "",
  );
};

describe("closed export doors", () => {
  afterEach(() => {
    vi.restoreAllMocks();
  });

  describe("Ctrl+Shift+E (image export dialog)", () => {
    it("opens the dialog with the upstream defaults", async () => {
      await renderEditor();
      Keyboard.withModifierKeys({ ctrl: true, shift: true }, () => {
        Keyboard.keyDown(KEYS.E);
      });
      expect(window.h.state.openDialog).toEqual({ name: "imageExport" });
    });

    it("does nothing when saveAsImage is false", async () => {
      await renderEditor(CLOSED);
      Keyboard.withModifierKeys({ ctrl: true, shift: true }, () => {
        Keyboard.keyDown(KEYS.E);
      });
      expect(window.h.state.openDialog).toBe(null);
    });
  });

  describe("Ctrl+Shift+S (.excalidraw save to disk)", () => {
    it("saves with the upstream defaults", async () => {
      const save = vi
        .spyOn(json, "saveAsJSON")
        .mockResolvedValue({ fileHandle: null });
      await renderEditor();
      Keyboard.withModifierKeys({ ctrl: true, shift: true }, () => {
        Keyboard.keyDown(KEYS.S);
      });
      await waitFor(() => expect(save).toHaveBeenCalledTimes(1));
    });

    it("does nothing when export is false", async () => {
      const save = vi
        .spyOn(json, "saveAsJSON")
        .mockResolvedValue({ fileHandle: null });
      await renderEditor(CLOSED);
      Keyboard.withModifierKeys({ ctrl: true, shift: true }, () => {
        Keyboard.keyDown(KEYS.S);
      });
      await new Promise((resolve) => setTimeout(resolve, 0));
      expect(save).not.toHaveBeenCalled();
    });
  });

  describe("command palette", () => {
    it("lists the export and save entries with the upstream defaults", async () => {
      await renderEditor();
      const labels = await paletteLabels();
      expect(labels.some((label) => label.includes("Export image"))).toBe(true);
      expect(labels.some((label) => label.includes("Save to disk"))).toBe(true);
    });

    it("lists neither entry when the doors are closed", async () => {
      await renderEditor(CLOSED);
      const labels = await paletteLabels();
      expect(labels.some((label) => label.includes("Export image"))).toBe(
        false,
      );
      expect(labels.some((label) => label.includes("Save to disk"))).toBe(
        false,
      );
    });
  });

  describe("copy as PNG / SVG (image to the clipboard)", () => {
    const openCanvasMenu = () => {
      fireEvent.contextMenu(GlobalTestState.interactiveCanvas, {
        button: 2,
        clientX: 1,
        clientY: 1,
      });
      return UI.queryContextMenu();
    };

    it("is in the canvas context menu with the upstream defaults", async () => {
      await renderEditor();
      const menu = openCanvasMenu();
      expect(menu?.querySelector('li[data-testid="copyAsSvg"]')).not.toBe(null);
    });

    it("is absent from the canvas context menu when saveAsImage is false", async () => {
      await renderEditor(CLOSED);
      const menu = openCanvasMenu();
      expect(menu).not.toBe(null);
      expect(menu?.querySelector('li[data-testid="copyAsSvg"]')).toBe(null);
      expect(menu?.querySelector('li[data-testid="copyAsPng"]')).toBe(null);
    });

    it("Shift+Alt+C copies with the upstream defaults", async () => {
      const exportCanvas = vi
        .spyOn(data, "exportCanvas")
        .mockResolvedValue(undefined);
      await renderEditor();
      Keyboard.withModifierKeys({ shift: true, alt: true }, () => {
        Keyboard.codeDown(CODES.C);
      });
      await waitFor(() => expect(exportCanvas).toHaveBeenCalledTimes(1));
    });

    it("Shift+Alt+C does nothing when saveAsImage is false", async () => {
      const exportCanvas = vi
        .spyOn(data, "exportCanvas")
        .mockResolvedValue(undefined);
      await renderEditor(CLOSED);
      Keyboard.withModifierKeys({ shift: true, alt: true }, () => {
        Keyboard.codeDown(CODES.C);
      });
      await new Promise((resolve) => setTimeout(resolve, 0));
      expect(exportCanvas).not.toHaveBeenCalled();
    });
  });
});
