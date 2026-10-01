import React from "react";

import { KEYS } from "@atlasdraw/common";

import { Excalidraw } from "../index";

import { API } from "./helpers/api";
import { render, unmountComponent } from "./test-utils";

// Atlasdraw addition (WCAG 2.1.2, no keyboard trap). Upstream took every Tab
// on the canvas for its shape conversion, so focus could not leave the
// canvas by the keyboard. Tab is taken only when a conversion applies.

unmountComponent();

const container = () =>
  document.querySelector(".excalidraw-container") as HTMLElement;

/** Press Tab on the focused canvas; true when the editor took it. */
const tabTaken = (shiftKey = false) => {
  container().focus();
  expect(document.activeElement).toBe(container());
  const event = new KeyboardEvent("keydown", {
    key: KEYS.TAB,
    shiftKey,
    bubbles: true,
    cancelable: true,
  });
  container().dispatchEvent(event);
  return event.defaultPrevented;
};

describe("Tab on the canvas", () => {
  beforeEach(async () => {
    await render(<Excalidraw handleKeyboardGlobally />);
  });

  it("moves focus on when nothing is selected", () => {
    expect(tabTaken()).toBe(false);
    expect(tabTaken(true)).toBe(false);
  });

  it("moves focus on when the selection cannot be converted", () => {
    const text = API.createElement({ type: "text", text: "Ward 3" });
    API.setElements([text]);
    API.setSelectedElements([text]);
    expect(tabTaken()).toBe(false);
  });

  it("converts a selected shape, as upstream does", () => {
    const rect = API.createElement({ type: "rectangle" });
    API.setElements([rect]);
    API.setSelectedElements([rect]);
    expect(tabTaken()).toBe(true);
  });
});
