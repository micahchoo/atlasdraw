// SPDX-License-Identifier: AGPL-3.0-only
//
// SheetPanelResizer — the sheet panel's left-edge drag handle.
//
// The requirement that carries these tests: a mouse-only resize is not
// acceptable. So the keyboard path is asserted key by key, and the accessible
// name / role / value trio is asserted as the contract a screen reader reads,
// not as an implementation detail.
//
// Pointer drags are asserted through the *math* — "a pointer 100px left of the
// container's right edge means a 100px panel" — because jsdom has no layout and
// getBoundingClientRect is the only place the geometry can come from.

import React from "react";
import { afterEach, describe, expect, it, vi } from "vitest";
import { cleanup, fireEvent, render, screen } from "@testing-library/react";

import {
  RIGHT_SIDEBAR_DEFAULT_WIDTH,
  RIGHT_SIDEBAR_MAX_WIDTH,
  RIGHT_SIDEBAR_MIN_WIDTH,
} from "@atlasdraw/common";

import { SheetPanelResizer } from "../SheetPanelResizer";

afterEach(() => {
  cleanup();
});

function renderResizer(width = RIGHT_SIDEBAR_DEFAULT_WIDTH) {
  const onWidth = vi.fn();
  const onReset = vi.fn();
  const result = render(
    <SheetPanelResizer width={width} onWidth={onWidth} onReset={onReset} />,
  );
  return { ...result, onWidth, onReset, handle: screen.getByRole("separator") };
}

describe("SheetPanelResizer accessibility contract", () => {
  it("is a focusable separator with a name and a value in px", () => {
    const { handle } = renderResizer(340);

    expect(handle.getAttribute("aria-orientation")).toBe("vertical");
    expect(handle.getAttribute("aria-label")).toBe("Resize sheet panel");
    expect(handle.getAttribute("aria-valuenow")).toBe("340");
    expect(handle.getAttribute("aria-valuemin")).toBe(
      String(RIGHT_SIDEBAR_MIN_WIDTH),
    );
    expect(handle.getAttribute("aria-valuemax")).toBe(
      String(RIGHT_SIDEBAR_MAX_WIDTH),
    );
    expect(handle.getAttribute("tabindex")).toBe("0");
  });

  it("is reachable by name", () => {
    renderResizer();
    expect(screen.getByLabelText("Resize sheet panel")).toBeTruthy();
  });

  it("sits at the panel's left edge — `right` tracks the live width", () => {
    const { handle } = renderResizer(420);
    expect(handle.style.right).toBe("420px");
  });
});

describe("SheetPanelResizer keyboard resizing", () => {
  it("widens on ArrowLeft — the panel grows leftward, so does the handle", () => {
    const { handle, onWidth } = renderResizer(300);
    fireEvent.keyDown(handle, { key: "ArrowLeft" });
    expect(onWidth).toHaveBeenCalledWith(316);
  });

  it("narrows on ArrowRight", () => {
    const { handle, onWidth } = renderResizer(300);
    fireEvent.keyDown(handle, { key: "ArrowRight" });
    expect(onWidth).toHaveBeenCalledWith(284);
  });

  it("takes a coarse step with Shift and with PageUp/PageDown", () => {
    const { handle, onWidth } = renderResizer(300);
    fireEvent.keyDown(handle, { key: "ArrowLeft", shiftKey: true });
    expect(onWidth).toHaveBeenLastCalledWith(364);
    fireEvent.keyDown(handle, { key: "PageUp" });
    expect(onWidth).toHaveBeenLastCalledWith(364);
    fireEvent.keyDown(handle, { key: "PageDown" });
    expect(onWidth).toHaveBeenLastCalledWith(236);
  });

  it("jumps to the ends of the travel with Home and End", () => {
    const { handle, onWidth } = renderResizer(300);
    fireEvent.keyDown(handle, { key: "Home" });
    expect(onWidth).toHaveBeenLastCalledWith(RIGHT_SIDEBAR_MIN_WIDTH);
    fireEvent.keyDown(handle, { key: "End" });
    expect(onWidth).toHaveBeenLastCalledWith(RIGHT_SIDEBAR_MAX_WIDTH);
  });

  it("resets on Enter and Space", () => {
    const { handle, onReset } = renderResizer(500);
    fireEvent.keyDown(handle, { key: "Enter" });
    fireEvent.keyDown(handle, { key: " " });
    expect(onReset).toHaveBeenCalledTimes(2);
  });

  it("leaves Escape and Tab to the editor", () => {
    const { handle, onWidth, onReset } = renderResizer();
    fireEvent.keyDown(handle, { key: "Escape" });
    fireEvent.keyDown(handle, { key: "Tab" });
    expect(onWidth).not.toHaveBeenCalled();
    expect(onReset).not.toHaveBeenCalled();
  });

  it("does not let an arrow key also nudge the selected element", () => {
    // The editor listens on the document; an unstopped arrow would resize the
    // panel AND move the shape.
    const onDocumentKeyDown = vi.fn();
    document.addEventListener("keydown", onDocumentKeyDown);
    try {
      const { handle } = renderResizer();
      fireEvent.keyDown(handle, { key: "ArrowLeft" });
      expect(onDocumentKeyDown).not.toHaveBeenCalled();
    } finally {
      document.removeEventListener("keydown", onDocumentKeyDown);
    }
  });
});

describe("SheetPanelResizer pointer resizing", () => {
  /**
   * jsdom has no `PointerEvent`, and testing-library's `fireEvent.pointerDown`
   * falls back to an event type that drops `clientX`/`button` — which is the
   * whole payload here. A `MouseEvent` carrying the pointer's type name is what
   * the browser delivers in every respect this component reads.
   */
  function pointerEvent(type: string, clientX: number, button = 0): MouseEvent {
    const event = new MouseEvent(type, {
      bubbles: true,
      cancelable: true,
      clientX,
      button,
    });
    Object.assign(event, { pointerId: 1 });
    return event;
  }

  /**
   * jsdom has no layout, so the handle's offsetParent rect is stubbed. 1000 is
   * the plate's right edge in client coordinates; a pointer at clientX=600 is
   * therefore a 400px panel.
   */
  function stubGeometry(handle: HTMLElement) {
    const parent = document.createElement("div");
    Object.defineProperty(handle, "offsetParent", {
      configurable: true,
      get: () => parent,
    });
    parent.getBoundingClientRect = () =>
      ({ right: 1000, left: 0, top: 0, bottom: 800 } as DOMRect);
    handle.setPointerCapture = vi.fn();
    handle.releasePointerCapture = vi.fn();
  }

  it("commits the width from the pointer's distance to the plate's right edge", () => {
    const { handle, onWidth } = renderResizer();
    stubGeometry(handle);

    fireEvent(handle, pointerEvent("pointerdown", 698));
    fireEvent(handle, pointerEvent("pointerup", 600));

    expect(onWidth).toHaveBeenLastCalledWith(400);
  });

  it("captures the pointer so a drag off the 7px handle keeps working", () => {
    const { handle } = renderResizer();
    stubGeometry(handle);

    fireEvent(handle, pointerEvent("pointerdown", 698));
    expect(handle.setPointerCapture).toHaveBeenCalledWith(1);
  });

  it("ignores non-primary buttons", () => {
    const { handle, onWidth } = renderResizer();
    stubGeometry(handle);

    fireEvent(handle, pointerEvent("pointerdown", 698, 2));
    fireEvent(handle, pointerEvent("pointerup", 600));

    expect(onWidth).not.toHaveBeenCalled();
  });

  it("coalesces a burst of pointermoves — one commit per frame, not per move", async () => {
    const { handle, onWidth } = renderResizer();
    stubGeometry(handle);

    fireEvent(handle, pointerEvent("pointerdown", 698));
    for (const clientX of [690, 680, 670, 660, 650]) {
      fireEvent(handle, pointerEvent("pointermove", clientX));
    }
    // Nothing has committed yet — the frame has not run.
    expect(onWidth).not.toHaveBeenCalled();

    await new Promise((resolve) => requestAnimationFrame(() => resolve(null)));
    await new Promise((resolve) => requestAnimationFrame(() => resolve(null)));

    // One commit, carrying the LAST position of the burst (1000 - 650).
    expect(onWidth).toHaveBeenCalledTimes(1);
    expect(onWidth).toHaveBeenCalledWith(350);
  });

  it("lands the final position on pointerup even if a frame is pending", () => {
    const { handle, onWidth } = renderResizer();
    stubGeometry(handle);

    fireEvent(handle, pointerEvent("pointerdown", 698));
    fireEvent(handle, pointerEvent("pointermove", 700));
    fireEvent(handle, pointerEvent("pointerup", 500));

    // Synchronous, and the queued frame must not overwrite it afterwards.
    expect(onWidth).toHaveBeenCalledTimes(1);
    expect(onWidth).toHaveBeenCalledWith(500);
  });

  it("resets to the default on double-click", () => {
    const { handle, onReset } = renderResizer(520);
    fireEvent.doubleClick(handle);
    expect(onReset).toHaveBeenCalledTimes(1);
  });
});
