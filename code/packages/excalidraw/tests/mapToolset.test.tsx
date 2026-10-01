import React from "react";

import { KEYS } from "@atlasdraw/common";

import { CommandPalette, Excalidraw } from "../index";

import { API } from "./helpers/api";
import { Keyboard } from "./helpers/ui";
import { act, fireEvent, render, waitFor } from "./test-utils";

// Atlasdraw addition (code/decisions/0010-own-the-fork.md). Frames,
// embeddables, the laser pointer, Mermaid / text-to-diagram and the AI magic
// frame mean nothing on a map, so the editor offers no way to start them. Their
// element types stay: a document that already holds a frame, a magic frame, an
// embeddable or an iframe must still load and render.

const REMOVED_TOOL_TEST_IDS = [
  "toolbar-frame",
  "toolbar-embeddable",
  "toolbar-laser",
  "toolbar-magicframe",
];

describe("map toolset", () => {
  it("the extra-tools menu offers none of the removed tools", async () => {
    const { container } = await render(<Excalidraw />);
    const trigger = container.querySelector(
      ".App-toolbar__extra-tools-trigger",
    );
    if (trigger) {
      fireEvent.click(trigger);
    }
    for (const testId of REMOVED_TOOL_TEST_IDS) {
      expect(container.querySelector(`[data-testid="${testId}"]`)).toBe(null);
    }
    expect(container.textContent).not.toContain("Mermaid");
    expect(container.textContent).not.toContain("Text to diagram");
  });

  it("a collaboration session shows no laser pointer button", async () => {
    const { container } = await render(<Excalidraw isCollaborating />);
    expect(container.querySelector('[title="Laser pointer"]')).toBe(null);
  });

  it.each([
    ["F", KEYS.F],
    ["K", KEYS.K],
  ])("the %s key does not change the tool", async (_name, key) => {
    await render(<Excalidraw handleKeyboardGlobally />);
    expect(window.h.state.activeTool.type).toBe("selection");
    Keyboard.keyPress(key);
    expect(window.h.state.activeTool.type).toBe("selection");
  });

  it("the command palette offers none of the removed tools", async () => {
    await render(
      <Excalidraw>
        <CommandPalette />
      </Excalidraw>,
    );
    act(() => {
      API.setAppState({ openDialog: { name: "commandPalette" } });
    });
    await waitFor(() =>
      expect(document.querySelector(".command-item")).not.toBe(null),
    );
    const labels = Array.from(document.querySelectorAll(".command-item")).map(
      (item) => item.textContent ?? "",
    );
    expect(labels.length).toBeGreaterThan(0);
    for (const removed of ["Frame tool", "Mermaid", "Text to diagram"]) {
      expect(labels.some((label) => label.includes(removed))).toBe(false);
    }
  });

  it("a document with frame, magic frame, embeddable and iframe elements still loads", async () => {
    const elements = [
      API.createElement({ type: "frame", id: "frame" }),
      API.createElement({ type: "magicframe", id: "magicframe" }),
      API.createElement({
        type: "embeddable",
        id: "embeddable",
        link: "https://example.com",
      }),
      API.createElement({ type: "iframe", id: "iframe" }),
    ];
    await render(<Excalidraw initialData={{ elements }} />);
    expect(
      window.h.elements.map((element) => [element.id, element.type]),
    ).toEqual([
      ["frame", "frame"],
      ["magicframe", "magicframe"],
      ["embeddable", "embeddable"],
      ["iframe", "iframe"],
    ]);
  });
});
