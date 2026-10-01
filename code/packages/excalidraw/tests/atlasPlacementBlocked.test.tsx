import React from "react";

import { KEYS } from "@atlasdraw/common";

import { createPasteEvent } from "../clipboard";
import { Excalidraw } from "../index";

import { API } from "./helpers/api";
import { Keyboard } from "./helpers/ui";
import {
  GlobalTestState,
  act,
  render,
  unmountComponent,
  waitFor,
} from "./test-utils";

// Atlasdraw addition. While the atlas map is turned, the host turns the
// canvases with CSS, and Excalidraw's own screen-to-scene math does not know.
// The host gates the pointer; `placementBlocked` gates the keyboard and the
// clipboard, which place by that math.

unmountComponent();

const { h } = window;

const open = async (placementBlocked: boolean) => {
  await render(
    <Excalidraw handleKeyboardGlobally placementBlocked={placementBlocked} />,
  );
  Object.assign(document, {
    elementFromPoint: () => GlobalTestState.canvas,
  });
};

const pasteText = (text: string) => {
  h.app.focusContainer();
  act(() => {
    document.dispatchEvent(createPasteEvent({ types: { "text/plain": text } }));
  });
};

const sleep = (ms: number) =>
  new Promise((resolve) => setTimeout(() => resolve(null), ms));

describe("placementBlocked", () => {
  afterEach(() => unmountComponent());

  it("a paste places nothing", async () => {
    await open(true);
    pasteText("Ward 3");
    await sleep(50);
    expect(h.elements).toHaveLength(0);
  });

  it("an arrow key does not nudge", async () => {
    await open(true);
    const rect = API.createElement({ type: "rectangle", x: 10, y: 10 });
    API.setElements([rect]);
    API.setSelectedElements([rect]);
    Keyboard.keyPress(KEYS.ARROW_RIGHT);
    expect(h.elements[0].x).toBe(10);
  });

  it("without it, the paste and the nudge work", async () => {
    await open(false);
    pasteText("Ward 3");
    await waitFor(() => expect(h.elements).toHaveLength(1));
    const rect = API.createElement({ type: "rectangle", x: 10, y: 10 });
    API.setElements([rect]);
    API.setSelectedElements([rect]);
    Keyboard.keyPress(KEYS.ARROW_RIGHT);
    expect(h.elements[0].x).toBe(11);
  });
});
