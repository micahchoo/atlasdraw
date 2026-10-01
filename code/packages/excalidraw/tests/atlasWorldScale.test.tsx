import React from "react";
import { vi } from "vitest";

import { CODES, FONT_SIZES, STROKE_WIDTH } from "@atlasdraw/common";

import { Excalidraw } from "../index";
import { pickerStyleValue } from "../atlasStyleScale";

import { API } from "./helpers/api";
import { Keyboard, UI } from "./helpers/ui";
import { act, render } from "./test-utils";

import type { NormalizedZoomValue, ZoomAction } from "../types";

// Atlasdraw addition (ADR-0015). The atlas app's scene is a world map at a
// fixed reference zoom, so the editor's zoom value is far below 1 where people
// draw. Two props keep the editor usable there:
//
//   screenSizedStyles — stroke width and font size are screen pixels; a new
//                       element and a picker change store them in scene units.
//   onZoomAction      — zoom actions go to the host's camera.
//
// Each case also runs without the prop, to show upstream behaviour is kept.

const { h } = window;

const ZOOM = 0.25 as NormalizedZoomValue;

const setZoom = () =>
  act(() => {
    API.setAppState({ zoom: { value: ZOOM } });
  });

describe("screenSizedStyles", () => {
  it("a new shape's stroke is the current stroke divided by the zoom", async () => {
    await render(<Excalidraw screenSizedStyles />);
    setZoom();
    const rect = UI.createElement("rectangle", { x: 10, y: 10, size: 40 });
    expect(h.state.currentItemStrokeWidth).toBe(STROKE_WIDTH.bold);
    expect(rect.get().strokeWidth).toBe(STROKE_WIDTH.bold / ZOOM);
  });

  it("a new line, arrow and freehand stroke are scaled too", async () => {
    await render(<Excalidraw screenSizedStyles />);
    setZoom();
    const line = UI.createElement("line", { x: 10, y: 10, size: 40 });
    const arrow = UI.createElement("arrow", { x: 60, y: 10, size: 40 });
    const free = UI.createElement("freedraw", { x: 110, y: 10, size: 40 });
    for (const el of [line, arrow, free]) {
      expect(el.get().strokeWidth).toBe(STROKE_WIDTH.bold / ZOOM);
    }
  });

  it("new text gets the current font size divided by the zoom", async () => {
    await render(<Excalidraw screenSizedStyles />);
    setZoom();
    UI.createElement("text", { x: 20, y: 20 });
    const text = h.elements.find((e) => e.type === "text");
    expect(text).toBeDefined();
    expect((text as { fontSize: number }).fontSize).toBe(
      h.state.currentItemFontSize / ZOOM,
    );
  });

  it("without the prop, sizes are stored as chosen", async () => {
    await render(<Excalidraw />);
    setZoom();
    const rect = UI.createElement("rectangle", { x: 10, y: 10, size: 40 });
    expect(rect.get().strokeWidth).toBe(STROKE_WIDTH.bold);
  });

  it("the stroke picker writes screen pixels as scene units", async () => {
    await render(<Excalidraw screenSizedStyles />);
    setZoom();
    const rect = UI.createElement("rectangle", { x: 10, y: 10, size: 40 });
    API.setSelectedElements([rect.get()]);
    UI.clickOnTestId("strokeWidth-extraBold");
    expect(rect.get().strokeWidth).toBe(STROKE_WIDTH.extraBold / ZOOM);
    expect(h.state.currentItemStrokeWidth).toBe(STROKE_WIDTH.extraBold);
  });

  it("the stroke picker shows the width as it looks at this zoom", async () => {
    const { container } = await render(<Excalidraw screenSizedStyles />);
    setZoom();
    const rect = UI.createElement("rectangle", { x: 10, y: 10, size: 40 });
    API.setSelectedElements([rect.get()]);
    const checked = () =>
      (
        container.querySelector(
          'input[name="stroke-width"]:checked',
        ) as HTMLInputElement | null
      )?.getAttribute("data-testid");
    expect(checked()).toBe("strokeWidth-bold");
    // Twice the zoom: the same stroke looks twice as wide.
    act(() => {
      API.setAppState({ zoom: { value: (ZOOM * 2) as NormalizedZoomValue } });
    });
    expect(checked()).toBe("strokeWidth-extraBold");
  });

  it("the font size picker writes screen pixels as scene units", async () => {
    await render(<Excalidraw screenSizedStyles />);
    setZoom();
    const text = API.createElement({ type: "text", text: "Ward 3" });
    API.setElements([text]);
    API.setSelectedElements([text]);
    UI.clickOnTestId("fontSize-large");
    const after = h.elements[0] as { fontSize: number };
    expect(after.fontSize).toBe(FONT_SIZES.lg / ZOOM);
    expect(h.state.currentItemFontSize).toBe(FONT_SIZES.lg);
  });
});

describe("pickerStyleValue", () => {
  it("snaps a size to the option it equals up to float error", () => {
    const scale = 1 / 0.1234567;
    expect(pickerStyleValue(2 * scale, scale, [1, 2, 4])).toBe(2);
  });

  it("returns the shown size when no option matches", () => {
    expect(pickerStyleValue(6, 2, [1, 2, 4])).toBe(3);
  });
});

describe("onZoomAction", () => {
  const keys: Array<[string, () => void, ZoomAction["type"]]> = [
    [
      "Ctrl+=",
      () =>
        Keyboard.withModifierKeys({ ctrl: true }, () =>
          Keyboard.codeDown(CODES.EQUAL),
        ),
      "zoomIn",
    ],
    [
      "Ctrl+-",
      () =>
        Keyboard.withModifierKeys({ ctrl: true }, () =>
          Keyboard.codeDown(CODES.MINUS),
        ),
      "zoomOut",
    ],
    [
      "Ctrl+0",
      () =>
        Keyboard.withModifierKeys({ ctrl: true }, () =>
          Keyboard.codeDown(CODES.ZERO),
        ),
      "resetZoom",
    ],
    [
      "Shift+1",
      () =>
        Keyboard.withModifierKeys({ shift: true }, () =>
          Keyboard.codeDown(CODES.ONE),
        ),
      "zoomToFit",
    ],
  ];

  it.each(keys)(
    "%s goes to the host, and the editor's zoom stays",
    async (_name, press, type) => {
      const onZoomAction = vi.fn(() => true);
      await render(
        <Excalidraw onZoomAction={onZoomAction} handleKeyboardGlobally />,
      );
      API.setElements([API.createElement({ type: "rectangle" })]);
      setZoom();
      const before = {
        zoom: h.state.zoom.value,
        scrollX: h.state.scrollX,
        scrollY: h.state.scrollY,
      };
      press();
      expect(onZoomAction).toHaveBeenCalledTimes(1);
      expect(onZoomAction.mock.calls[0][0]).toMatchObject({ type });
      expect({
        zoom: h.state.zoom.value,
        scrollX: h.state.scrollX,
        scrollY: h.state.scrollY,
      }).toEqual(before);
    },
  );

  it("a fit hands over the elements to frame", async () => {
    const onZoomAction = vi.fn((_: ZoomAction) => true);
    await render(
      <Excalidraw onZoomAction={onZoomAction} handleKeyboardGlobally />,
    );
    const rect = API.createElement({ type: "rectangle" });
    API.setElements([rect]);
    Keyboard.withModifierKeys({ shift: true }, () =>
      Keyboard.codeDown(CODES.ONE),
    );
    const action = onZoomAction.mock.calls[0][0];
    expect(action.type).toBe("zoomToFit");
    expect(
      action.type === "zoomToFit" ? action.elements.map((e) => e.id) : [],
    ).toEqual([rect.id]);
  });

  it("without the prop, Ctrl+= zooms the editor", async () => {
    await render(<Excalidraw handleKeyboardGlobally />);
    const before = h.state.zoom.value;
    Keyboard.withModifierKeys({ ctrl: true }, () => {
      Keyboard.codeDown(CODES.EQUAL);
    });
    expect(h.state.zoom.value).toBeGreaterThan(before);
  });

  it("a host that declines leaves the editor's zoom action alone", async () => {
    await render(
      <Excalidraw onZoomAction={() => false} handleKeyboardGlobally />,
    );
    const before = h.state.zoom.value;
    Keyboard.withModifierKeys({ ctrl: true }, () => {
      Keyboard.codeDown(CODES.EQUAL);
    });
    expect(h.state.zoom.value).toBeGreaterThan(before);
  });
});
