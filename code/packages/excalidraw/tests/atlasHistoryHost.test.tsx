import React from "react";
import { vi } from "vitest";

import { Excalidraw } from "../index";

import { Keyboard, UI } from "./helpers/ui";
import { act, render } from "./test-utils";

import type { HistoryChange } from "../history";
import type { HistoryHost } from "../types";

// Atlasdraw addition (atlas-app session/history.ts). The atlas app keeps one
// history over two sources: its document commands and this drawing's own
// entries. It reads the drawing's history through `api.history`, and with
// the `historyHost` prop the undo and redo keys and buttons ask the host.

const { h } = window;

const api = () => h.app.api;

describe("api.history", () => {
  it("counts the drawing's entries and tells a listener what changed", async () => {
    await render(<Excalidraw handleKeyboardGlobally />);
    const heard: HistoryChange[] = [];
    api().history.subscribe((change) => heard.push(change));

    UI.createElement("rectangle", { x: 10, y: 10, size: 40 });

    expect(api().history.depth()).toEqual({ undo: 1, redo: 0 });
    expect(heard).toContainEqual({ kind: "record", elements: true });
  });

  it("undo and redo run the drawing's own history", async () => {
    await render(<Excalidraw handleKeyboardGlobally />);
    const rect = UI.createElement("rectangle", { x: 10, y: 10, size: 40 });

    act(() => api().history.undo());
    expect(rect.get().isDeleted).toBe(true);
    expect(api().history.depth()).toEqual({ undo: 0, redo: 1 });

    act(() => api().history.redo());
    expect(rect.get().isDeleted).toBe(false);
    expect(api().history.depth()).toEqual({ undo: 1, redo: 0 });
  });

  it("clearRedo drops the redo entries and keeps the undo entries", async () => {
    await render(<Excalidraw handleKeyboardGlobally />);
    UI.createElement("rectangle", { x: 10, y: 10, size: 40 });
    UI.createElement("ellipse", { x: 80, y: 10, size: 40 });
    act(() => api().history.undo());
    expect(api().history.depth()).toEqual({ undo: 1, redo: 1 });

    act(() => api().history.clearRedo());

    expect(api().history.depth()).toEqual({ undo: 1, redo: 0 });
  });

  it("clear says so", async () => {
    await render(<Excalidraw handleKeyboardGlobally />);
    UI.createElement("rectangle", { x: 10, y: 10, size: 40 });
    const heard: HistoryChange[] = [];
    api().history.subscribe((change) => heard.push(change));

    act(() => api().history.clear());

    expect(heard).toEqual([{ kind: "clear" }]);
    expect(api().history.depth()).toEqual({ undo: 0, redo: 0 });
  });
});

describe("historyHost", () => {
  const host = (can: { undo: boolean; redo: boolean }): HistoryHost => ({
    undo: vi.fn(),
    redo: vi.fn(),
    canUndo: () => can.undo,
    canRedo: () => can.redo,
    subscribe: () => () => {},
  });

  it("the undo and redo keys ask the host, and the drawing does not move", async () => {
    const owner = host({ undo: true, redo: true });
    await render(<Excalidraw handleKeyboardGlobally historyHost={owner} />);
    const rect = UI.createElement("rectangle", { x: 10, y: 10, size: 40 });

    Keyboard.undo();
    Keyboard.redo();

    expect(owner.undo).toHaveBeenCalledTimes(1);
    expect(owner.redo).toHaveBeenCalledTimes(1);
    expect(rect.get().isDeleted).toBe(false);
    expect(api().history.depth()).toEqual({ undo: 1, redo: 0 });
  });

  it("the buttons are enabled by the host, not by the drawing's stacks", async () => {
    const owner = host({ undo: true, redo: false });
    const { queryByTestId } = await render(
      <Excalidraw handleKeyboardGlobally historyHost={owner} />,
    );
    // Nothing drawn: the drawing's own undo stack is empty.
    const undo = queryByTestId("button-undo") as HTMLButtonElement;
    const redo = queryByTestId("button-redo") as HTMLButtonElement;
    expect(undo.disabled).toBe(false);
    expect(redo.disabled).toBe(true);

    act(() => undo.click());

    expect(owner.undo).toHaveBeenCalledTimes(1);
  });

  it("without the prop, the keys run the drawing's own history", async () => {
    await render(<Excalidraw handleKeyboardGlobally />);
    const rect = UI.createElement("rectangle", { x: 10, y: 10, size: 40 });

    Keyboard.undo();

    expect(rect.get().isDeleted).toBe(true);
  });
});
