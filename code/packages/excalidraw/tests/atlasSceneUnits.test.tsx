import React from "react";

import { KEYS, arrayToMap } from "@atlasdraw/common";
import { lineSegment, pointFrom } from "@atlasdraw/math";

import type { GlobalPoint, LocalPoint, Radians } from "@atlasdraw/math";

import { getLinkHandleFromCoords } from "../components/hyperlink/helpers";
import { eraserTest } from "../eraser";
import { Excalidraw } from "../index";

import { API } from "./helpers/api";
import { Keyboard, UI } from "./helpers/ui";
import { act, render, unmountComponent } from "./test-utils";

import type { NormalizedZoomValue } from "../types";

// Atlasdraw addition (docs/architecture/adr/0015-world-coordinates-gate.md).
// Upstream gives some distances in scene units: the gap between an arrow and
// the shape it binds to, how near an arrow end must come to bind, the padding
// of text in a container, the spacing of an elbow arrow's route, the arrow-key
// nudge and the eraser's reach. The atlas scene is a world map at zoom 22, so
// where people draw a scene unit is about a thousandth of a pixel and those
// distances vanish.
//
// Each case does the same screen gestures twice: in upstream's editor at
// zoom 1, and in the atlas editor (`screenSizedStyles`) at zoom 1/U. The
// atlas result, divided by U, must equal upstream's. That is "the editor
// looks and behaves at any map zoom as upstream does at zoom 1".

unmountComponent();

const { h } = window;

const U = 1024;

type Mode = { atlas: boolean; unit: number };
const UPSTREAM: Mode = { atlas: false, unit: 1 };
const ATLAS: Mode = { atlas: true, unit: U };

const open = async (mode: Mode) => {
  await render(
    <Excalidraw handleKeyboardGlobally screenSizedStyles={mode.atlas} />,
  );
  act(() => {
    API.setAppState({
      zoom: { value: (1 / mode.unit) as NormalizedZoomValue },
      scrollX: 0,
      scrollY: 0,
    });
  });
};

/** Run `scenario` in both editors; return each result in screen pixels. */
const both = async <T,>(scenario: (unit: number) => T) => {
  const out: T[] = [];
  for (const mode of [UPSTREAM, ATLAS]) {
    await open(mode);
    out.push(scenario(mode.unit));
    unmountComponent();
  }
  return out as [upstream: T, atlas: T];
};

/** Every number in `value`, divided by `unit`, rounded to 1e-6. */
const inPixels = (value: unknown, unit: number): unknown => {
  if (typeof value === "number") {
    return Math.round((value / unit) * 1e6) / 1e6 + 0;
  }
  if (Array.isArray(value)) {
    return value.map((v) => inPixels(v, unit));
  }
  return value;
};

const box = (
  el: { x: number; y: number; width: number; height: number },
  unit: number,
) => inPixels([el.x, el.y, el.width, el.height], unit);

describe("distances in the atlas editor equal upstream's at zoom 1", () => {
  it("an arrow ending near a shape binds, at the same gap", async () => {
    const [up, atlas] = await both((unit) => {
      const rect = UI.createElement("rectangle", {
        x: 100,
        y: 100,
        size: 100,
      });
      // The end stops 10 px left of the rectangle.
      const arrow = UI.createElement("arrow", {
        x: 0,
        y: 150,
        width: 90,
        height: 0,
      });
      const a = arrow.get();
      return {
        bound: a.endBinding?.elementId === rect.id,
        points: inPixels(
          a.points.map((p) => [a.x + p[0], a.y + p[1]]),
          unit,
        ),
      };
    });
    expect(up.bound).toBe(true);
    expect(atlas).toEqual(up);
  });

  it("text in a container sits at the same padding", async () => {
    // jsdom measures every character 10 wide at any font size, so the
    // text's width is not compared. Left and top alignment put the text at
    // the container's corner plus the padding.
    const [up, atlas] = await both((unit) => {
      const rect = UI.createElement("rectangle", {
        x: 100,
        y: 100,
        width: 200,
        height: 100,
      });
      API.setSelectedElements([rect.get()]);
      Keyboard.keyPress(KEYS.ENTER);
      const editor = document.querySelector(
        ".excalidraw-textEditorContainer > textarea",
      ) as HTMLTextAreaElement;
      act(() => {
        editor.value = "Ward 3";
        editor.dispatchEvent(new Event("input"));
      });
      Keyboard.keyPress(KEYS.ESCAPE);
      API.setSelectedElements([rect.get()]);
      UI.clickOnTestId("align-left");
      UI.clickOnTestId("align-top");
      const t = h.elements.find((e) => e.type === "text")!;
      expect(t).toMatchObject({ textAlign: "left", verticalAlign: "top" });
      return {
        container: box(rect.get(), unit),
        text: inPixels([t.x, t.y, t.height], unit),
      };
    });
    expect(atlas).toEqual(up);
  });

  it("an elbow arrow between two shapes takes the same route", async () => {
    const [up, atlas] = await both((unit) => {
      UI.createElement("rectangle", { x: 100, y: 100, size: 100 });
      UI.createElement("rectangle", { x: 400, y: 300, size: 100 });
      act(() => {
        API.setAppState({ currentItemArrowType: "elbow" });
      });
      const arrow = UI.createElement("arrow", {
        x: 150,
        y: 150,
        width: 300,
        height: 200,
      });
      const a = arrow.get();
      return inPixels(
        a.points.map((p) => [a.x + p[0], a.y + p[1]]),
        unit,
      );
    });
    expect((up as number[][]).length).toBeGreaterThan(2);
    expect(atlas).toEqual(up);
  });

  it("an arrow key nudges a shape by the same distance", async () => {
    const [up, atlas] = await both((unit) => {
      const rect = UI.createElement("rectangle", { x: 100, y: 100, size: 50 });
      API.setSelectedElements([rect.get()]);
      const x0 = rect.get().x;
      Keyboard.keyPress(KEYS.ARROW_RIGHT);
      const one = rect.get().x - x0;
      Keyboard.withModifierKeys({ shift: true }, () => {
        Keyboard.keyPress(KEYS.ARROW_RIGHT);
      });
      const shifted = rect.get().x - x0 - one;
      return inPixels([one, shifted], unit);
    });
    expect(up).toEqual([1, 5]);
    expect(atlas).toEqual(up);
  });
});

describe("the eraser reaches as far as upstream's at zoom 1", () => {
  // The editor's visible elements are empty in jsdom, so the eraser's hit
  // test is called directly, with the arguments the eraser gives it.
  const reaches = (
    type: "arrow" | "freedraw",
    dy: number,
    mode: Mode,
  ): boolean => {
    const u = mode.unit;
    const points = [
      pointFrom<LocalPoint>(0, 0),
      pointFrom<LocalPoint>(200 * u, 0),
    ];
    // API.createElement drops customData, so the unit is set after.
    const el = {
      ...API.createElement({
        type,
        x: 100 * u,
        y: 100 * u,
        width: 200 * u,
        height: 0,
        points,
        strokeWidth: 2 * u,
      }),
      ...(mode.atlas ? { customData: { atlas: { unit: u } } } : {}),
    };
    const y = (100 + dy) * u;
    return eraserTest(
      lineSegment(
        pointFrom<GlobalPoint>(150 * u, y),
        pointFrom<GlobalPoint>(250 * u, y),
      ),
      el,
      arrayToMap([el]),
      1 / u,
    );
  };

  it.each(["arrow", "freedraw"] as const)("a %s", (type) => {
    for (const dy of [1, 3, 40]) {
      expect(reaches(type, dy, ATLAS)).toBe(reaches(type, dy, UPSTREAM));
    }
    expect(reaches(type, 1, UPSTREAM)).toBe(true);
    expect(reaches(type, 40, UPSTREAM)).toBe(false);
  });
});

describe("the link icon is the size upstream's is at zoom 1", () => {
  it("in the editor's unit", () => {
    const handle = (mode: Mode) =>
      inPixels(
        getLinkHandleFromCoords(
          [100 * mode.unit, 100 * mode.unit, 300 * mode.unit, 200 * mode.unit],
          0 as Radians,
          {
            zoom: { value: (1 / mode.unit) as NormalizedZoomValue },
            screenSizedStyles: mode.atlas,
          },
        ),
        mode.unit,
      );
    expect(handle(ATLAS)).toEqual(handle(UPSTREAM));
  });
});
