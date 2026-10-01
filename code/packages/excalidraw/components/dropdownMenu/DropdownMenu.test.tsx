import React from "react";

import { KEYS } from "@atlasdraw/common";

import { Excalidraw } from "../../index";
import { Keyboard } from "../../tests/helpers/ui";
import {
  render,
  waitFor,
  getByTestId,
  fireEvent,
} from "../../tests/test-utils";

describe("Test <DropdownMenu/>", () => {
  it("should", async () => {
    const { container } = await render(<Excalidraw />);

    expect(window.h.state.openMenu).toBe(null);

    fireEvent.click(getByTestId(container, "main-menu-trigger"));
    expect(window.h.state.openMenu).toBe("canvas");

    await waitFor(() => {
      Keyboard.keyDown(KEYS.ESCAPE);
      expect(window.h.state.openMenu).toBe(null);
    });
  });

  it("the main menu's trigger has a name and opens from the keyboard", async () => {
    const { container } = await render(<Excalidraw />);
    const trigger = getByTestId(container, "main-menu-trigger");

    expect(trigger.getAttribute("aria-label")).toBe("Menu");

    // Radix stops the click that Enter or Space would make, so the trigger
    // opens on the key itself.
    fireEvent.keyDown(trigger, { key: "Enter" });
    expect(window.h.state.openMenu).toBe("canvas");
    fireEvent.keyDown(trigger, { key: " " });
    expect(window.h.state.openMenu).toBe(null);
    fireEvent.keyDown(trigger, { key: "ArrowDown" });
    expect(window.h.state.openMenu).toBe("canvas");
    // ArrowDown opens; it never closes.
    fireEvent.keyDown(trigger, { key: "ArrowDown" });
    expect(window.h.state.openMenu).toBe("canvas");
  });
});
