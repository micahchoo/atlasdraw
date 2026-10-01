import { reseed } from "@atlasdraw/common";

import { exportToCanvas, exportToSvg } from "@atlasdraw/utils";

import { actionCopy } from "../actions/actionClipboard";
import { actionSelectAll } from "../actions/actionSelectAll";
import { Excalidraw } from "../index";

import { API } from "./helpers/api";
import { Pointer } from "./helpers/ui";
import { act, render, unmountComponent } from "./test-utils";

unmountComponent();

const mouse = new Pointer("mouse");
const { h } = window;

const HIDDEN = { atlas: { hidden: true } };

/** API.createElement has no customData parameter; set it on the result. */
const hide = <T extends object>(el: T): T => ({ ...el, customData: HIDDEN });

describe("an element hidden by customData.atlas.hidden", () => {
  beforeEach(async () => {
    localStorage.clear();
    reseed(7);
    await render(<Excalidraw handleKeyboardGlobally={true} />);
    API.setElements([]);
  });

  it("is not drawn", () => {
    const shown = API.createElement({ type: "rectangle", id: "shown" });
    const hidden = hide(
      API.createElement({
        type: "rectangle",
        id: "hidden",
      }),
    );
    act(() => API.setElements([shown, hidden]));

    expect(h.app.visibleElements.map((e) => e.id)).toEqual(["shown"]);
  });

  it("does not take a click", () => {
    const hidden = hide(
      API.createElement({
        type: "rectangle",
        width: 100,
        backgroundColor: "red",
        fillStyle: "solid",
      }),
    );
    API.setElements([hidden]);

    mouse.clickAt(50, 50);

    expect(API.getSelectedElements()).toHaveLength(0);
  });

  it("is not caught by a box selection", () => {
    const hidden = hide(
      API.createElement({
        type: "rectangle",
        width: 100,
        x: 100,
        y: 100,
      }),
    );
    API.setElements([hidden]);

    mouse.downAt(50, 50);
    mouse.moveTo(250, 250);
    mouse.upAt(250, 250);

    expect(API.getSelectedElements()).toHaveLength(0);
  });

  it("hides the text bound to it", () => {
    const container = hide(
      API.createElement({
        type: "rectangle",
        id: "box",
      }),
    );
    const text = API.createElement({
      type: "text",
      id: "label",
      text: "Ward 3",
      containerId: "box",
    });
    act(() => API.setElements([container, text]));

    expect(h.app.visibleElements.map((e) => e.id)).toEqual([]);
  });

  it("is drawn again when the flag goes", () => {
    const el = hide(
      API.createElement({
        type: "rectangle",
        id: "el",
      }),
    );
    act(() => API.setElements([el]));
    act(() =>
      API.updateScene({
        elements: [{ ...el, customData: { atlas: {} }, version: 9 }],
      }),
    );

    expect(h.app.visibleElements.map((e) => e.id)).toEqual(["el"]);
  });
});

describe("a hidden element is left out of every whole-scene path", () => {
  beforeEach(async () => {
    localStorage.clear();
    reseed(7);
    await render(<Excalidraw handleKeyboardGlobally={true} />);
    API.setElements([]);
  });

  /** A 100x100 shape at the origin, and a hidden one far away. */
  const scene = () => [
    API.createElement({
      type: "rectangle",
      id: "shown",
      width: 100,
      height: 100,
    }),
    hide(
      API.createElement({
        type: "rectangle",
        id: "hidden",
        x: 500,
        y: 500,
        width: 100,
        height: 100,
      }),
    ),
  ];

  it("select all does not select it", () => {
    act(() => API.setElements(scene()));
    act(() => {
      h.app.actionManager.executeAction(actionSelectAll);
    });
    expect(API.getSelectedElements().map((e) => e.id)).toEqual(["shown"]);
  });

  it("a canvas export (PNG, PDF, copy as PNG) does not draw it", async () => {
    const canvas = await exportToCanvas({
      elements: scene(),
      files: null,
      exportPadding: 0,
    });
    expect([canvas.width, canvas.height]).toEqual([100, 100]);
  });

  it("an SVG export does not draw it", async () => {
    const svg = await exportToSvg({
      elements: scene(),
      files: null,
      exportPadding: 0,
    });
    expect(svg.getAttribute("width")).toBe("100");
  });

  it("a copy does not carry it", async () => {
    const [shown, hidden] = scene();
    // A group selection can hold a hidden member.
    act(() =>
      API.setElements([
        { ...shown, groupIds: ["g"] },
        { ...hidden, groupIds: ["g"] },
      ]),
    );
    API.setSelectedElements(h.elements.slice());
    const event = new ClipboardEvent("copy", {
      clipboardData: new DataTransfer(),
    });
    await act(() =>
      h.app.actionManager.executeAction(actionCopy, "keyboard", event),
    );
    const copied = JSON.parse(event.clipboardData!.getData("text/plain"));
    expect(copied.elements.map((e: { id: string }) => e.id)).toEqual(["shown"]);
  });
});
