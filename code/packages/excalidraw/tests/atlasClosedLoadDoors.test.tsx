import React from "react";
import { vi } from "vitest";

import { EXPORT_DATA_TYPES, KEYS, MIME_TYPES } from "@atlasdraw/common";

import type { ExcalidrawElement } from "@atlasdraw/element/types";

import { createPasteEvent, serializeAsClipboardJSON } from "../clipboard";
import { encodePngMetadata } from "../data/image";
import { serializeAsJSON } from "../data/json";
import { restoreElements } from "../data/restore";
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

// Atlasdraw addition (ADR-0010). Two upstream doors are closed here.
//
// 1. `iframe` and `embeddable` elements. Upstream rendered an `iframe`
//    element's `customData.generationData.html` as the srcdoc of a scripted
//    iframe, and made an `embeddable` from any pasted or dropped video URL.
//    The producer (magic frame) is gone, so every such element is data from
//    a stranger. The editor refuses them wherever a scene comes in, and
//    renders none that reach the scene anyway.
// 2. Scene files. A dropped `.excalidraw` file, or a PNG/SVG that carries a
//    scene, replaced the open drawing and its camera. The editor now hands
//    the file to the host (`onSceneFileDrop`) and loads nothing itself.

const { h } = window;

const SCRIPT_HTML =
  "<form action='https://evil.example'><input name=p></form><script>1</script>";

const iframeElement = () =>
  ({
    ...API.createElement({
      type: "iframe",
      x: 10,
      y: 10,
      width: 300,
      height: 200,
    } as any),
    customData: { generationData: { status: "done", html: SCRIPT_HTML } },
  } as unknown as ExcalidrawElement);

const embeddableElement = () =>
  API.createElement({
    type: "embeddable",
    x: 400,
    y: 10,
    width: 300,
    height: 200,
    link: "https://www.youtube.com/watch?v=gkGMXY0wekg",
  } as any);

const settle = () =>
  act(async () => {
    await new Promise((r) => setTimeout(r, 50));
  });

const sendPaste = (text: string) => {
  Keyboard.withModifierKeys({ ctrl: true }, () => {
    Keyboard.keyPress(KEYS.V);
    document.dispatchEvent(createPasteEvent({ types: { "text/plain": text } }));
  });
};

const sceneJSON = (elements: ExcalidrawElement[]) =>
  JSON.stringify({
    type: EXPORT_DATA_TYPES.excalidraw,
    appState: { viewBackgroundColor: "#000" },
    elements,
  });

describe("iframe and embeddable elements are refused", () => {
  beforeEach(() => {
    unmountComponent();
  });

  it("restoreElements drops them and keeps the rest", () => {
    const rect = API.createElement({ type: "rectangle", id: "R" });
    const restored = restoreElements(
      [iframeElement(), embeddableElement(), rect],
      null,
    );
    expect(restored.map((e) => e.type)).toEqual(["rectangle"]);
  });

  it("a scene that carries them opens without them, and no iframe renders", async () => {
    const rect = API.createElement({ type: "rectangle", id: "R" });
    const { container } = await render(
      <Excalidraw
        initialData={{ elements: [iframeElement(), embeddableElement(), rect] }}
      />,
    );
    act(() => {
      API.setAppState({ width: 1000, height: 800, scrollX: 0, scrollY: 0 });
    });
    await settle();
    expect(h.elements.map((e) => e.type)).toEqual(["rectangle"]);
    expect(container.querySelector("iframe")).toBe(null);
    expect(document.querySelector("iframe")).toBe(null);
  });

  it("an element put straight into the scene renders no iframe", async () => {
    const { container } = await render(<Excalidraw />);
    act(() => {
      API.setAppState({ width: 1000, height: 800, scrollX: 0, scrollY: 0 });
      // updateScene does not restore: this is the renderer's own guard.
      h.app.updateScene({ elements: [iframeElement(), embeddableElement()] });
    });
    await settle();
    expect(container.querySelector("iframe")).toBe(null);
    expect(container.innerHTML).not.toContain("evil.example");
  });

  describe("paste and drop", () => {
    beforeEach(async () => {
      await render(<Excalidraw autoFocus handleKeyboardGlobally />);
      Object.assign(document, {
        elementFromPoint: () => GlobalTestState.canvas,
      });
    });

    it("pasted elements arrive without them", async () => {
      const rect = API.createElement({ type: "rectangle" });
      const json = await serializeAsClipboardJSON({
        elements: [iframeElement(), rect],
        files: null,
      });
      sendPaste(json);
      await waitFor(() => expect(h.elements.length).toBe(1));
      expect(h.elements[0].type).toBe("rectangle");
    });

    it("a pasted video URL becomes text, not an embeddable", async () => {
      sendPaste("https://www.youtube.com/watch?v=gkGMXY0wekg");
      await waitFor(() => expect(h.elements.length).toBe(1));
      expect(h.elements[0].type).toBe("text");
    });

    it("a dropped video URL makes no element", async () => {
      await API.drop([
        {
          kind: "string",
          value: "https://www.youtube.com/watch?v=gkGMXY0wekg",
          type: MIME_TYPES.text,
        },
      ]);
      await settle();
      expect(h.elements.filter((e) => e.type === "embeddable")).toEqual([]);
      expect(document.querySelector("iframe")).toBe(null);
    });
  });
});

describe("a dropped scene file goes to the host", () => {
  const drawing = () => [API.createElement({ type: "rectangle", id: "OWN" })];

  beforeEach(() => {
    unmountComponent();
  });

  it("an .excalidraw file is handed over, and the drawing and camera stay", async () => {
    const onSceneFileDrop = vi.fn();
    await render(
      <Excalidraw
        initialData={{ elements: drawing() }}
        onSceneFileDrop={onSceneFileDrop}
      />,
    );
    const zoom = h.state.zoom.value;
    const file = new File(
      [sceneJSON([API.createElement({ type: "rectangle", id: "B" })])],
      "other.excalidraw",
      { type: MIME_TYPES.json },
    );
    await API.drop([{ kind: "file", file }]);
    await waitFor(() => expect(onSceneFileDrop).toHaveBeenCalledTimes(1));
    expect(onSceneFileDrop.mock.calls[0][0].name).toBe(file.name);
    expect(h.elements.map((e) => e.id)).toEqual(["OWN"]);
    expect(h.state.zoom.value).toBe(zoom);
    expect(h.state.viewBackgroundColor).not.toBe("#000");
  });

  it("a PNG that carries a scene is handed over, not loaded", async () => {
    const onSceneFileDrop = vi.fn();
    await render(
      <Excalidraw
        initialData={{ elements: drawing() }}
        onSceneFileDrop={onSceneFileDrop}
      />,
    );
    const png = await encodePngMetadata({
      blob: await API.loadFile("./fixtures/smiley.png"),
      metadata: serializeAsJSON(
        [API.createElement({ type: "rectangle", id: "B" })],
        h.state,
        {},
        "local",
      ),
    });
    await API.drop([{ kind: "file", file: png }]);
    await waitFor(() => expect(onSceneFileDrop).toHaveBeenCalledTimes(1));
    expect(h.elements.map((e) => e.id)).toEqual(["OWN"]);
  });

  it("without a host handler, nothing loads", async () => {
    await render(<Excalidraw initialData={{ elements: drawing() }} />);
    await API.drop([
      {
        kind: "file",
        file: new File([sceneJSON([])], "x.excalidraw", {
          type: MIME_TYPES.json,
        }),
      },
    ]);
    await settle();
    expect(h.elements.map((e) => e.id)).toEqual(["OWN"]);
  });
});
