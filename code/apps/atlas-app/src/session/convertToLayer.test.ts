// SPDX-License-Identifier: AGPL-3.0-only
// Convert selection to data layer: a conversion adds a data layer and deletes
// the shape as one step of the one history, and every failure reaches the
// user as a toast, never as an uncaught exception.
//
// Per .claude/rules/test-fixtures.md: this file owns its own mocks.

import { describe, it, expect, vi, beforeEach } from "vitest";

import {
  annotationToFeatureCollection,
  UnsupportedConvertElementError,
} from "@atlasdraw/tools";
import { defaultLayerStyle } from "@atlasdraw/basemap";
import { CaptureUpdateAction } from "@atlasdraw/element";

import type { ExcalidrawImperativeAPI } from "@atlasdraw/excalidraw";

import { createDocumentStore } from "../state/document";
import { followDocumentHistory } from "../state/documentUndo";
import { editorScene } from "../state/scene";

import { convertibleSelection, convertSelection } from "./convertToLayer";
import { createSession } from "./EditorSession";

vi.mock("@atlasdraw/tools", async (importOriginal) => {
  const actual = await importOriginal<typeof import("@atlasdraw/tools")>();
  return {
    ...actual,
    annotationToFeatureCollection: vi.fn(),
  };
});

vi.mock("@atlasdraw/basemap", async (importOriginal) => {
  const actual = await importOriginal<typeof import("@atlasdraw/basemap")>();
  return { ...actual, defaultLayerStyle: vi.fn(() => ({})) };
});

type Shape = {
  id: string;
  type: string;
  x: number;
  y: number;
  width: number;
  height: number;
  version: number;
  versionNonce: number;
  isDeleted: boolean;
};

const shape = (id: string, type = "rectangle"): Shape => ({
  id,
  type,
  x: 0,
  y: 0,
  width: 100,
  height: 50,
  version: 1,
  versionNonce: 1,
  isDeleted: false,
});

/** A drawing that the fake API's updateScene rewrites, with a selection. */
function drawing(shapes: Shape[], selected: string[]) {
  let elements = shapes;
  const updateScene = vi.fn((opts: { elements?: Shape[] }) => {
    if (opts.elements) {
      elements = opts.elements;
    }
  });
  const api = {
    getSceneElements: () => elements.filter((e) => !e.isDeleted),
    getSceneElementsIncludingDeleted: () => elements,
    getAppState: () => ({
      selectedElementIds: Object.fromEntries(selected.map((id) => [id, true])),
    }),
    updateScene,
  } as unknown as ExcalidrawImperativeAPI;
  return { api, updateScene, elements: () => elements };
}

function sessionWith(api: ExcalidrawImperativeAPI) {
  const store = createDocumentStore();
  const notify = { success: vi.fn(), error: vi.fn() };
  const s = createSession({
    store,
    scene: editorScene,
    transport: null,
    notify,
  });
  s.view.getState().setApi(api);
  followDocumentHistory(store, s.history);
  const overlays = () => store.getState().doc.snapshot().overlays;
  return { s, notify, overlays };
}

beforeEach(() => {
  vi.clearAllMocks();
  vi.mocked(defaultLayerStyle).mockReturnValue({} as never);
  vi.mocked(annotationToFeatureCollection).mockReturnValue({
    type: "FeatureCollection",
    features: [],
  } as never);
});

describe("which selection converts", () => {
  it("one shape with a place on the map", () => {
    const { api } = drawing([shape("a")], ["a"]);
    expect(convertibleSelection(sessionWith(api).s)?.id).toBe("a");
  });

  it("not text, not two shapes, not nothing", () => {
    for (const { api } of [
      drawing([shape("t", "text")], ["t"]),
      drawing([shape("a"), shape("b")], ["a", "b"]),
      drawing([shape("a")], []),
    ]) {
      expect(convertibleSelection(sessionWith(api).s)).toBe(null);
    }
  });
});

describe("a conversion", () => {
  it("adds a named data layer and deletes the shape, out of the drawing's own history", () => {
    const { api, updateScene, elements } = drawing([shape("a")], ["a"]);
    const { s, overlays } = sessionWith(api);

    convertSelection(s);

    expect(overlays()).toEqual([
      expect.objectContaining({
        kind: "data",
        id: expect.stringMatching(/^dl:/),
        label: expect.stringMatching(/^Rectangle/),
      }),
    ]);
    expect(elements()).toEqual([
      expect.objectContaining({ id: "a", isDeleted: true, version: 2 }),
    ]);
    // The step is the one history's (the group), not the drawing's.
    expect(updateScene).toHaveBeenCalledWith(
      expect.objectContaining({ captureUpdate: CaptureUpdateAction.NEVER }),
    );
  });

  it("is one step: undo removes the layer and brings the shape back; redo does both again", () => {
    const { api, elements } = drawing([shape("a")], ["a"]);
    const { s, overlays } = sessionWith(api);

    convertSelection(s);
    s.history.undo();
    expect(overlays()).toHaveLength(0);
    expect(elements()[0].isDeleted).toBe(false);
    expect(s.history.canUndo).toBe(false);

    s.history.redo();
    expect(overlays()).toHaveLength(1);
    expect(elements()[0].isDeleted).toBe(true);
  });
});

describe("a failure", () => {
  it("is a toast, not window.alert, on UnsupportedConvertElementError", () => {
    const thrown = new UnsupportedConvertElementError("text");
    vi.mocked(annotationToFeatureCollection).mockImplementation(() => {
      throw thrown;
    });
    const alertSpy = vi.spyOn(window, "alert").mockImplementation(() => {});
    const { s, notify } = sessionWith(drawing([shape("a")], ["a"]).api);

    convertSelection(s);

    expect(alertSpy).not.toHaveBeenCalled();
    expect(notify.error).toHaveBeenCalledWith(thrown.message);
    alertSpy.mockRestore();
  });

  it("of another kind is logged and a toast, and adds nothing", () => {
    vi.mocked(annotationToFeatureCollection).mockImplementation(() => {
      throw new Error("no geometry");
    });
    const consoleErrorSpy = vi
      .spyOn(console, "error")
      .mockImplementation(() => {});
    const { s, notify, overlays } = sessionWith(
      drawing([shape("a")], ["a"]).api,
    );

    expect(() => convertSelection(s)).not.toThrow();
    expect(consoleErrorSpy).toHaveBeenCalled();
    expect(notify.error).toHaveBeenCalledWith(
      "Couldn't convert to a data layer — no geometry",
    );
    expect(overlays()).toHaveLength(0);
    consoleErrorSpy.mockRestore();
  });
});
