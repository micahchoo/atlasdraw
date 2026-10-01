import React from "react";
import { vi } from "vitest";

import {
  CODES,
  FONT_SIZES,
  MAX_CANVAS_FONT_SIZE,
  STROKE_WIDTH,
} from "@atlasdraw/common";

import { Excalidraw } from "../index";
import { pickerStyleValue, scaleForeignElements } from "../atlasStyleScale";
import { exportToSvg } from "../scene/export";

import { API } from "./helpers/api";
import { Keyboard, Pointer, UI } from "./helpers/ui";
import { act, render } from "./test-utils";

import type { NormalizedZoomValue, ZoomAction } from "../types";

// Atlasdraw addition (docs/architecture/adr/0015-world-coordinates-gate.md).
// The atlas app's scene is a world map at a fixed reference zoom, so the
// editor's zoom value is far below 1 where people draw. Two props keep the
// editor usable there:
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

  it("a new shape records its pixel unit in customData.atlas.unit", async () => {
    await render(<Excalidraw screenSizedStyles />);
    setZoom();
    const rect = UI.createElement("rectangle", { x: 10, y: 10, size: 40 });
    const arrow = UI.createElement("arrow", { x: 60, y: 10, size: 40 });
    for (const el of [rect, arrow]) {
      expect(el.get().customData).toEqual({ atlas: { unit: 1 / ZOOM } });
    }
  });

  it("without the prop, sizes are stored as chosen", async () => {
    await render(<Excalidraw />);
    setZoom();
    const rect = UI.createElement("rectangle", { x: 10, y: 10, size: 40 });
    expect(rect.get().strokeWidth).toBe(STROKE_WIDTH.bold);
    expect(rect.get().customData).toBeUndefined();
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

describe("elements from outside the atlas", () => {
  it("a library item goes in at screen size, with its pixel unit", async () => {
    await render(<Excalidraw screenSizedStyles />);
    setZoom();
    const item = API.createElement({
      type: "rectangle",
      width: 100,
      height: 50,
      strokeWidth: 2,
    });
    act(() => {
      h.app.addElementsFromPasteOrLibrary({
        elements: [item],
        files: null,
        position: "center",
      });
    });
    const added = h.elements[h.elements.length - 1];
    expect(added.width).toBe(100 / ZOOM);
    expect(added.height).toBe(50 / ZOOM);
    expect(added.strokeWidth).toBe(2 / ZOOM);
    expect(added.customData).toEqual({ atlas: { unit: 1 / ZOOM } });
  });

  it("without the prop, a library item keeps its size", async () => {
    await render(<Excalidraw />);
    setZoom();
    act(() => {
      h.app.addElementsFromPasteOrLibrary({
        elements: [API.createElement({ type: "rectangle", width: 100 })],
        files: null,
        position: "center",
      });
    });
    expect(h.elements[h.elements.length - 1].width).toBe(100);
  });
});

describe("scaleForeignElements", () => {
  const base = {
    x: 10,
    y: 20,
    width: 30,
    height: 40,
    strokeWidth: 2,
  };

  it("scales position about the origin, sizes, points and font", () => {
    const [out] = scaleForeignElements(
      [{ ...base, points: [[0, 0] as const, [5, 6] as const], fontSize: 20 }],
      4,
      10,
      0,
    );
    expect(out).toMatchObject({
      x: 10,
      y: 80,
      width: 120,
      height: 160,
      strokeWidth: 8,
      points: [
        [0, 0],
        [20, 24],
      ],
      fontSize: 80,
      customData: { atlas: { unit: 4 } },
    });
  });

  it("leaves an element that has a unit alone: it is the atlas's own", () => {
    const own = { ...base, customData: { atlas: { unit: 1024 } } };
    expect(scaleForeignElements([own], 4, 0, 0)[0]).toBe(own);
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

  it("scrollToContent with a fit goes to the host", async () => {
    const onZoomAction = vi.fn((_: ZoomAction) => true);
    await render(<Excalidraw onZoomAction={onZoomAction} />);
    const rect = API.createElement({ type: "rectangle" });
    API.setElements([rect]);
    setZoom();
    act(() => {
      h.app.scrollToContent(rect, { fitToContent: true, animate: false });
    });
    expect(onZoomAction).toHaveBeenCalledTimes(1);
    expect(onZoomAction.mock.calls[0][0]).toMatchObject({
      type: "zoomToFit",
      inViewport: true,
    });
    expect(h.state.zoom.value).toBe(ZOOM);
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

describe("touch pinch with a host camera", () => {
  // At map zoom 12 the editor's zoom value is 2^-10, below Excalidraw's
  // clamp of [0.1, 30]. A clamped pinch jumped the map to zoom 18.7 on the
  // first frame. With `onZoomAction` the host owns the camera, so the pinch
  // passes the zoom on unclamped and the bridge moves the map.
  const MAP_ZOOM = (2 ** -10) as NormalizedZoomValue;

  const pinch = () => {
    const a = new Pointer("touch", 1);
    const b = new Pointer("touch", 2);
    a.downAt(300, 300);
    b.downAt(400, 300);
    // Fingers twice as far apart: twice the zoom.
    b.moveTo(500, 300);
    a.upAt();
    b.upAt();
  };

  it("doubles the zoom value, not the clamp", async () => {
    await render(<Excalidraw onZoomAction={() => true} />);
    act(() => {
      API.setAppState({ zoom: { value: MAP_ZOOM } });
    });
    pinch();
    expect(h.state.zoom.value).toBeCloseTo(MAP_ZOOM * 2, 12);
  });

  it("without the prop, the pinch is clamped as upstream", async () => {
    await render(<Excalidraw />);
    act(() => {
      API.setAppState({ zoom: { value: MAP_ZOOM } });
    });
    pinch();
    expect(h.state.zoom.value).toBe(0.1);
  });
});

describe("SVG text above the browser's font clamp", () => {
  // Chromium clamps an SVG text's font-size to 10000px, as it does a canvas
  // font: measured 2026-10-01, a 20480px <text> drew at 10000px. A
  // font-size of at most MAX_CANVAS_FONT_SIZE in a scaled <text> draws at
  // the full size. Library previews, copy-as-SVG in the embed and the
  // publish dialog all export atlas text this way.
  const textLines = async (fontSize: number) => {
    const text = API.createElement({
      type: "text",
      text: "Ward 3\nnorth",
      fontSize,
      x: 0,
      y: 0,
    });
    const svg = await exportToSvg(
      [text],
      { exportBackground: false, viewBackgroundColor: "#fff" },
      null,
      { skipInliningFonts: true },
    );
    return Array.from(svg.querySelectorAll("text")).map((t) => {
      const scale = Number(
        /scale\(([^)]+)\)/.exec(t.getAttribute("transform") ?? "")?.[1] ?? 1,
      );
      return {
        fontSize: parseFloat(t.getAttribute("font-size")!),
        // What the browser draws: the attributes times the scale.
        drawn: {
          fontSize: parseFloat(t.getAttribute("font-size")!) * scale,
          x: Number(t.getAttribute("x")) * scale,
          y: Number(t.getAttribute("y")) * scale,
        },
      };
    });
  };

  it("writes the font at the clamp and scales it to the full size", async () => {
    const big = 20 * 1024;
    const lines = await textLines(big);
    const reference = await textLines(20);
    expect(lines).toHaveLength(2);
    lines.forEach((line, i) => {
      expect(line.fontSize).toBeLessThanOrEqual(MAX_CANVAS_FONT_SIZE);
      expect(line.drawn.fontSize).toBeCloseTo(big, 6);
      expect(line.drawn.x).toBeCloseTo(reference[i].drawn.x * 1024, 6);
      expect(line.drawn.y).toBeCloseTo(reference[i].drawn.y * 1024, 6);
    });
  });

  it("leaves a font below the clamp as upstream writes it", async () => {
    const lines = await textLines(20);
    expect(lines.map((l) => l.fontSize)).toEqual([20, 20]);
  });
});
