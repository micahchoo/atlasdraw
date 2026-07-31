// SPDX-License-Identifier: AGPL-3.0-only
// RT-3 — tests for MapCompass.
//
// The control closes FU-14: rotation may ship only because there is a way
// back to north. So the assertions that matter most are the two that keep the
// escape hatch reachable — a click resets north, and a drag does not eat the
// click that would have.
//
// Per .claude/rules/test-fixtures.md: this file owns its own mocks.

import { describe, it, expect, vi, afterEach } from "vitest";
import { render, screen, cleanup, fireEvent } from "@testing-library/react";

import { MapCompass } from "../MapCompass";

import type { CameraRotation } from "../../hooks/useCameraRotation";
import type maplibregl from "maplibre-gl";

/**
 * jsdom has no `PointerEvent`, and testing-library's `fireEvent.pointerDown`
 * falls back to an event type that drops `clientX`/`button` — the whole
 * payload here. A `MouseEvent` carrying the pointer type name is what the
 * browser delivers in every respect this component reads.
 */
function pointerEvent(
  type: string,
  clientX: number,
  clientY: number,
  button = 0,
): MouseEvent {
  const event = new MouseEvent(type, {
    bubbles: true,
    cancelable: true,
    clientX,
    clientY,
    button,
  });
  Object.assign(event, { pointerId: 1 });
  return event;
}

function makeMap() {
  return {
    resetNorth: vi.fn(),
    setBearing: vi.fn(),
  } as unknown as maplibregl.Map & {
    resetNorth: ReturnType<typeof vi.fn>;
    setBearing: ReturnType<typeof vi.fn>;
  };
}

function renderCompass(degrees = 0) {
  const map = makeMap();
  const rotation: CameraRotation = {
    degrees,
    isRotated: Math.abs(degrees) >= 0.01,
  };
  render(<MapCompass map={map} rotation={rotation} />);
  const dial = screen.getByTestId("map-compass");

  // jsdom has no layout: the dial's rect is all zeroes, which would put every
  // pointer angle at atan2(0,0). 40x40 at the origin gives centre (20, 20).
  dial.getBoundingClientRect = () =>
    ({ left: 0, top: 0, width: 40, height: 40 } as DOMRect);
  dial.setPointerCapture = vi.fn();
  dial.releasePointerCapture = vi.fn();
  dial.hasPointerCapture = vi.fn(() => true);

  return { map, dial };
}

afterEach(() => {
  cleanup();
});

describe("MapCompass needle", () => {
  it("turns the dial by the measured rotation, so the needle points north", () => {
    renderCompass(30);

    const dial = screen.getByTestId("map-compass").querySelector("svg");
    expect(dial?.getAttribute("style")).toContain("rotate(30deg)");
  });

  it("reads the angle out as clockwise-from-north, the way a person reads a compass", () => {
    // `degrees` is the screen angle of geographic EAST. A map turned 30°
    // clockwise puts east at -30°, and the label must say 30, not -30.
    renderCompass(-30);

    const label =
      screen.getByTestId("map-compass").getAttribute("aria-label") ?? "";
    expect(label).toContain("rotated 30° from north");
  });

  it("says north-up when it is, rather than reporting 0°", () => {
    renderCompass(0);

    const label =
      screen.getByTestId("map-compass").getAttribute("aria-label") ?? "";
    expect(label).toContain("north-up");
  });

  it("marks itself rotated so the styling can explain the blocked toolbar", () => {
    renderCompass(45);

    expect(screen.getByTestId("map-compass").getAttribute("data-rotated")).toBe(
      "true",
    );
  });
});

describe("MapCompass reset-north", () => {
  it("resets north on click — the defect this control exists to close", () => {
    const { map, dial } = renderCompass(45);

    fireEvent.click(dial);

    expect(map.resetNorth).toHaveBeenCalledOnce();
  });

  it("still resets north after a press that never became a drag", () => {
    // A click is a pointerdown, a pixel or two of jitter, and a pointerup.
    // If sub-slop travel counted as a drag, the escape hatch would be gone.
    const { map, dial } = renderCompass(45);

    fireEvent(dial, pointerEvent("pointerdown", 20, 0));
    fireEvent(dial, pointerEvent("pointermove", 21, 1));
    fireEvent(dial, pointerEvent("pointerup", 21, 1));
    fireEvent.click(dial);

    expect(map.setBearing).not.toHaveBeenCalled();
    expect(map.resetNorth).toHaveBeenCalledOnce();
  });

  it("resets north on Home", () => {
    const { map, dial } = renderCompass(45);

    fireEvent.keyDown(dial, { key: "Home" });

    expect(map.resetNorth).toHaveBeenCalledOnce();
  });
});

describe("MapCompass drag", () => {
  it("turns the camera by the angle the pointer swept", () => {
    // Down at the top of the dial (screen angle -90 about the centre), up at
    // the right (0). A +90 sweep, and `setBearing` negates.
    const { map, dial } = renderCompass(0);

    fireEvent(dial, pointerEvent("pointerdown", 20, 0));
    fireEvent(dial, pointerEvent("pointermove", 40, 20));

    expect(map.setBearing).toHaveBeenLastCalledWith(-90);
  });

  it("starts from where the camera already is, not from north", () => {
    const { map, dial } = renderCompass(15);

    fireEvent(dial, pointerEvent("pointerdown", 20, 0));
    fireEvent(dial, pointerEvent("pointermove", 40, 20));

    expect(map.setBearing).toHaveBeenLastCalledWith(-105);
  });

  it("captures the pointer so the drag survives leaving the 40px dial", () => {
    const { dial } = renderCompass(0);

    fireEvent(dial, pointerEvent("pointerdown", 20, 0));

    expect(dial.setPointerCapture).toHaveBeenCalledWith(1);
  });

  it("does not reset north on the click that ends a drag", () => {
    // The browser fires `click` after `pointerup` on the same element. Without
    // the slop check the drag would be undone the instant it finished.
    const { map, dial } = renderCompass(0);

    fireEvent(dial, pointerEvent("pointerdown", 20, 0));
    fireEvent(dial, pointerEvent("pointermove", 40, 20));
    fireEvent(dial, pointerEvent("pointerup", 40, 20));
    fireEvent.click(dial);

    expect(map.setBearing).toHaveBeenCalled();
    expect(map.resetNorth).not.toHaveBeenCalled();
  });

  it("allows a plain click again once the drag is over", () => {
    const { map, dial } = renderCompass(0);

    fireEvent(dial, pointerEvent("pointerdown", 20, 0));
    fireEvent(dial, pointerEvent("pointermove", 40, 20));
    fireEvent(dial, pointerEvent("pointerup", 40, 20));
    fireEvent.click(dial);
    fireEvent.click(dial);

    expect(map.resetNorth).toHaveBeenCalledOnce();
  });

  it("ignores a move with no button down", () => {
    const { map, dial } = renderCompass(0);

    fireEvent(dial, pointerEvent("pointermove", 40, 20));

    expect(map.setBearing).not.toHaveBeenCalled();
  });

  it("ignores non-primary buttons — right-click belongs to the context menu", () => {
    const { map, dial } = renderCompass(0);

    fireEvent(dial, pointerEvent("pointerdown", 20, 0, 2));
    fireEvent(dial, pointerEvent("pointermove", 40, 20));

    expect(map.setBearing).not.toHaveBeenCalled();
  });
});

describe("MapCompass keyboard", () => {
  it("rotates in fine steps on the arrow keys", () => {
    const { map, dial } = renderCompass(0);

    fireEvent.keyDown(dial, { key: "ArrowRight" });

    expect(map.setBearing).toHaveBeenLastCalledWith(-5);
  });

  it("rotates the other way on ArrowLeft", () => {
    const { map, dial } = renderCompass(0);

    fireEvent.keyDown(dial, { key: "ArrowLeft" });

    expect(map.setBearing).toHaveBeenLastCalledWith(5);
  });

  it("takes a coarse step with shift, for crossing the dial", () => {
    const { map, dial } = renderCompass(0);

    fireEvent.keyDown(dial, { key: "ArrowRight", shiftKey: true });

    expect(map.setBearing).toHaveBeenLastCalledWith(-45);
  });

  it("leaves other keys to the editor", () => {
    // The plate's own shortcuts live on the document; swallowing keys here
    // would make the compass a keyboard trap for anything that is not rotation.
    const { map, dial } = renderCompass(0);

    fireEvent.keyDown(dial, { key: "ArrowUp" });
    fireEvent.keyDown(dial, { key: "r" });

    expect(map.setBearing).not.toHaveBeenCalled();
    expect(map.resetNorth).not.toHaveBeenCalled();
  });
});

describe("MapCompass before the map is ready", () => {
  it("renders disabled rather than absent, so the plate does not reflow", () => {
    const rotation: CameraRotation = { degrees: 0, isRotated: false };
    render(<MapCompass map={null} rotation={rotation} />);

    expect(
      (screen.getByTestId("map-compass") as HTMLButtonElement).disabled,
    ).toBe(true);
  });
});
