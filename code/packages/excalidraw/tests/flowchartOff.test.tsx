import React from "react";

import { KEYS, reseed } from "@atlasdraw/common";

import { Excalidraw } from "../index";

import { API } from "./helpers/api";
import { Keyboard } from "./helpers/ui";
import { render, unmountComponent } from "./test-utils";

// Atlasdraw addition (docs/architecture/adr/0015-world-coordinates-gate.md).
// Ctrl/Cmd+Arrow on a shape adds a flowchart node 100 scene units away with
// an arrow that has no style unit. On a world map one scene unit is far less
// than a pixel, so the node lands on top of the shape and the arrow has no
// head. The atlas editor sets `flowchart={false}`; the key then moves the
// shape like a plain arrow key, and nothing is created.

unmountComponent();

const { h } = window;

async function editorWithRectangle(flowchart?: boolean) {
  localStorage.clear();
  reseed(7);
  await render(
    <Excalidraw handleKeyboardGlobally={true} flowchart={flowchart} />,
  );
  const rectangle = API.createElement({
    type: "rectangle",
    width: 200,
    height: 100,
  });
  API.setElements([rectangle]);
  API.setSelectedElements([rectangle]);
}

function ctrlArrowRight() {
  Keyboard.withModifierKeys({ ctrl: true }, () => {
    Keyboard.keyPress(KEYS.ARROW_RIGHT);
  });
  Keyboard.keyUp(KEYS.CTRL_OR_CMD);
}

describe("flowchart prop", () => {
  it("by default, Ctrl+Arrow adds a node and its arrow", async () => {
    await editorWithRectangle();
    ctrlArrowRight();
    expect(h.elements.length).toBe(3);
  });

  it("with flowchart={false}, Ctrl+Arrow adds nothing", async () => {
    await editorWithRectangle(false);
    ctrlArrowRight();
    expect(h.elements.length).toBe(1);
    expect(h.app.flowChartCreator.isCreatingChart).toBe(false);
  });
});
