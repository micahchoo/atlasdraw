// SPDX-License-Identifier: AGPL-3.0-only
//
// Annotations are scene elements. These tests run the row selector and the
// commands against a stateful scene stand-in, and read the scene back.

import { afterEach, describe, expect, it } from "vitest";

import { documentFrame, toScene } from "@atlasdraw/geo";

import {
  annotationRows,
  generateLayerLabel,
  deleteAnnotation,
  moveAnnotation,
  renameAnnotation,
  setAnnotationVisible,
} from "../annotations";
import { bindScene, useSceneStore } from "../scene";

import { makeFakeExcalidraw } from "./fixtures/documentWorld";

import type { FakeSceneElement } from "./fixtures/documentWorld";

const frame = documentFrame(13.4, 52.5);

/**
 * A 100 × 80 rectangle in world coordinates, centred on (lng, lat), with
 * customData the panel does not own.
 */
function worldRect(id: string, lng = 13.4, lat = 52.5): FakeSceneElement {
  const c = toScene(frame, lng, lat);
  return {
    id,
    type: "rectangle",
    version: 3,
    versionNonce: 1,
    index: "a0",
    x: c.x - 50,
    y: c.y - 40,
    width: 100,
    height: 80,
    opacity: 100,
    isDeleted: false,
    customData: { _data: { source: "survey" } },
  };
}

const plain = (id: string, index: string): FakeSceneElement => ({
  id,
  type: "rectangle",
  version: 1,
  versionNonce: 1,
  index,
  isDeleted: false,
});

describe("annotationRows", () => {
  it("gives one row per live element, in scene order, with a generated label", () => {
    const rows = annotationRows(
      [
        worldRect("a"),
        { ...plain("gone", "a1"), isDeleted: true },
        { ...plain("b", "a2"), type: "ellipse" },
      ],
      frame,
    );

    expect(rows.map((r) => [r.id, r.label, r.order])).toEqual([
      ["a", "Rectangle near 52.5°N, 13.4°E", 0],
      ["b", "Ellipse", 1],
    ]);
    expect(rows[0]).toMatchObject({ visible: true, renamedByUser: false });
  });

  it("leaves out text bound to a container: it belongs to its container's row", () => {
    const rows = annotationRows(
      [
        plain("box", "a0"),
        { ...plain("label", "a1"), type: "text", containerId: "box" },
      ],
      frame,
    );

    expect(rows.map((r) => r.id)).toEqual(["box"]);
  });

  it("reads the user's label and the hidden flag from customData.atlas", () => {
    const el = {
      ...worldRect("a"),
      customData: {
        ...worldRect("a").customData,
        atlas: { label: "Ward 3", hidden: true },
      },
    };

    expect(annotationRows([el], frame)[0]).toMatchObject({
      label: "Ward 3",
      renamedByUser: true,
      visible: false,
    });
  });
});

describe("annotation commands write the element", () => {
  it("rename sets customData.atlas.label, keeps the rest of customData, and raises the version", () => {
    const fx = makeFakeExcalidraw([worldRect("a")]);

    renameAnnotation(fx.api, "a", "Ward 3");

    const el = fx.all()[0];
    expect(el.customData?.atlas).toEqual({ label: "Ward 3" });
    expect(el.customData?._data).toEqual(worldRect("a").customData?._data);
    expect(el.version).toBe(4);
  });

  it("hide sets the flag and leaves opacity alone; show removes the flag", () => {
    const fx = makeFakeExcalidraw([worldRect("a")]);

    setAnnotationVisible(fx.api, "a", false);
    expect(fx.all()[0].customData?.atlas).toEqual({ hidden: true });
    expect(fx.all()[0].opacity).toBe(100);

    setAnnotationVisible(fx.api, "a", true);
    expect(fx.all()[0].customData?.atlas).toEqual({});
    expect(annotationRows(fx.all(), frame)[0].visible).toBe(true);
  });

  it("delete marks the element and its bound text deleted", () => {
    const fx = makeFakeExcalidraw([
      plain("box", "a0"),
      { ...plain("label", "a1"), type: "text", containerId: "box" },
      plain("other", "a2"),
    ]);

    deleteAnnotation(fx.api, "box");

    expect(fx.api.getSceneElements().map((e) => e.id)).toEqual(["other"]);
  });

  it("move puts the element at the row position and keeps the indices ascending", () => {
    const fx = makeFakeExcalidraw([
      plain("a", "a0"),
      plain("b", "a1"),
      plain("c", "a2"),
    ]);

    moveAnnotation(fx.api, "a", 2);

    expect(annotationRows(fx.all(), frame).map((r) => r.id)).toEqual([
      "b",
      "c",
      "a",
    ]);
    const indices = fx.all().map((e) => e.index as string);
    expect([...indices].sort()).toEqual(indices);
  });

  it("an undo that puts the old element back brings back its label and hidden flag", () => {
    const fx = makeFakeExcalidraw([worldRect("a")]);
    renameAnnotation(fx.api, "a", "Ward 3");
    setAnnotationVisible(fx.api, "a", false);
    const before = fx.all()[0];

    fx.setElements([{ ...before, isDeleted: true }]);
    fx.setElements([before]);

    expect(annotationRows(fx.all(), frame)[0]).toMatchObject({
      label: "Ward 3",
      visible: false,
    });
  });
});

describe("the scene store", () => {
  let unbind: () => void = () => {};
  afterEach(() => unbind());

  it("publishes a new elements list when the drawing changes, and not for a pan", () => {
    const fx = makeFakeExcalidraw([worldRect("a")]);
    unbind = bindScene(fx.api);
    let published = 0;
    const unsub = useSceneStore.subscribe(() => {
      published += 1;
    });

    // A viewport change: onChange with the same elements.
    fx.setElements([...fx.all()]);
    expect(published).toBe(0);

    renameAnnotation(fx.api, "a", "Ward 3");
    expect(published).toBe(1);
    expect(
      annotationRows(useSceneStore.getState().elements, frame)[0].label,
    ).toBe("Ward 3");
    unsub();
  });
});

describe("generateLayerLabel", () => {
  it('formats "Type near lat, lng" from the element\'s centre', () => {
    expect(generateLayerLabel(worldRect("x", -74.006, 40.7128), frame)).toBe(
      "Rectangle near 40.7°N, 74.0°W",
    );
  });

  it("uses only the type name when the element has no position", () => {
    expect(generateLayerLabel({ id: "x", type: "freedraw" }, frame)).toBe(
      "Freehand",
    );
  });

  it("falls back to id when type is missing", () => {
    expect(generateLayerLabel({ id: "abc-123" }, frame)).toBe("abc-123");
  });

  it("reads a linear element's centre from its points", () => {
    const a = toScene(frame, -0.2, 51.6);
    const b = toScene(frame, 0.0, 51.4);
    expect(
      generateLayerLabel(
        {
          id: "x",
          type: "line",
          x: a.x,
          y: a.y,
          points: [
            [0, 0],
            [b.x - a.x, b.y - a.y],
          ],
        },
        frame,
      ),
    ).toBe("Line near 51.5°N, 0.1°W");
  });

  it("follows the element when it moves", () => {
    const el = worldRect("x", 76.6, 24.3);
    expect(generateLayerLabel(el, frame)).toBe("Rectangle near 24.3°N, 76.6°E");
    const to = toScene(frame, 77.2, 28.6);
    expect(
      generateLayerLabel({ ...el, x: to.x - 50, y: to.y - 40 }, frame),
    ).toBe("Rectangle near 28.6°N, 77.2°E");
  });
});
