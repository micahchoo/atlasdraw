// SPDX-License-Identifier: AGPL-3.0-only
//
// Annotations are scene elements. These tests run the row selector and the
// commands against a stateful scene stand-in, and read the scene back.

import { afterEach, describe, expect, it } from "vitest";

import {
  annotationRows,
  generateLayerLabel,
  deleteAnnotation,
  moveAnnotation,
  renameAnnotation,
  setAnnotationVisible,
} from "../annotations";
import { bindScene, useSceneStore } from "../scene";

import { geoRect, makeFakeExcalidraw } from "./fixtures/documentWorld";

import type { FakeSceneElement } from "./fixtures/documentWorld";

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
    const rows = annotationRows([
      geoRect("a"),
      { ...plain("gone", "a1"), isDeleted: true },
      { ...plain("b", "a2"), type: "ellipse" },
    ]);

    expect(rows.map((r) => [r.id, r.label, r.order])).toEqual([
      ["a", "Rectangle near 52.5°N, 13.4°E", 0],
      ["b", "Ellipse", 1],
    ]);
    expect(rows[0]).toMatchObject({ visible: true, renamedByUser: false });
  });

  it("leaves out text bound to a container: it belongs to its container's row", () => {
    const rows = annotationRows([
      plain("box", "a0"),
      { ...plain("label", "a1"), type: "text", containerId: "box" },
    ]);

    expect(rows.map((r) => r.id)).toEqual(["box"]);
  });

  it("reads the user's label and the hidden flag from customData.atlas", () => {
    const el = {
      ...geoRect("a"),
      customData: {
        ...geoRect("a").customData,
        atlas: { label: "Ward 3", hidden: true },
      },
    };

    expect(annotationRows([el])[0]).toMatchObject({
      label: "Ward 3",
      renamedByUser: true,
      visible: false,
    });
  });
});

describe("annotation commands write the element", () => {
  it("rename sets customData.atlas.label, keeps the geo anchor, and raises the version", () => {
    const fx = makeFakeExcalidraw([geoRect("a")]);

    renameAnnotation(fx.api, "a", "Ward 3");

    const el = fx.all()[0];
    expect(el.customData?.atlas).toEqual({ label: "Ward 3" });
    expect(el.customData?.geo).toEqual(geoRect("a").customData?.geo);
    expect(el.version).toBe(4);
  });

  it("hide sets the flag and leaves opacity alone; show removes the flag", () => {
    const fx = makeFakeExcalidraw([geoRect("a")]);

    setAnnotationVisible(fx.api, "a", false);
    expect(fx.all()[0].customData?.atlas).toEqual({ hidden: true });
    expect(fx.all()[0].opacity).toBe(100);

    setAnnotationVisible(fx.api, "a", true);
    expect(fx.all()[0].customData?.atlas).toEqual({});
    expect(annotationRows(fx.all())[0].visible).toBe(true);
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

    expect(annotationRows(fx.all()).map((r) => r.id)).toEqual(["b", "c", "a"]);
    const indices = fx.all().map((e) => e.index as string);
    expect([...indices].sort()).toEqual(indices);
  });

  it("an undo that puts the old element back brings back its label and hidden flag", () => {
    const fx = makeFakeExcalidraw([geoRect("a")]);
    renameAnnotation(fx.api, "a", "Ward 3");
    setAnnotationVisible(fx.api, "a", false);
    const before = fx.all()[0];

    fx.setElements([{ ...before, isDeleted: true }]);
    fx.setElements([before]);

    expect(annotationRows(fx.all())[0]).toMatchObject({
      label: "Ward 3",
      visible: false,
    });
  });
});

describe("the scene store", () => {
  let unbind: () => void = () => {};
  afterEach(() => unbind());

  it("publishes a new elements list when the drawing changes, and not for a pan", () => {
    const fx = makeFakeExcalidraw([geoRect("a")]);
    unbind = bindScene(fx.api);
    let published = 0;
    const unsub = useSceneStore.subscribe(() => {
      published += 1;
    });

    // A pan: new array, new x, same versions.
    fx.setElements(fx.all().map((e) => ({ ...e, x: (e.x ?? 0) + 200 })));
    expect(published).toBe(0);

    renameAnnotation(fx.api, "a", "Ward 3");
    expect(published).toBe(1);
    expect(annotationRows(useSceneStore.getState().elements)[0].label).toBe(
      "Ward 3",
    );
    unsub();
  });
});

describe("generateLayerLabel", () => {
  const geo = (anchor: Record<string, unknown>) => ({
    schemaVersion: 1,
    projection: "mercator",
    scaleMode: "geographic",
    geo: anchor,
  });

  it('formats "Type near lat, lng" when geo data is present', () => {
    expect(
      generateLayerLabel({
        id: "x",
        type: "rectangle",
        customData: geo({
          kind: "point",
          lng: -74.006,
          lat: 40.7128,
          zRef: 10,
        }),
      }),
    ).toBe("Rectangle near 40.7°N, 74.0°W");
  });

  it("uses only the type name when geo data is absent", () => {
    expect(generateLayerLabel({ id: "x", type: "freedraw" })).toBe("Freehand");
  });

  it("falls back to id when type is missing", () => {
    expect(generateLayerLabel({ id: "abc-123" })).toBe("abc-123");
  });

  it("extracts the center of a bbox anchor", () => {
    expect(
      generateLayerLabel({
        id: "x",
        type: "ellipse",
        customData: geo({
          kind: "bbox",
          west: -0.2,
          south: 51.4,
          east: 0.0,
          north: 51.6,
          zRef: 10,
        }),
      }),
    ).toBe("Ellipse near 51.5°N, 0.1°W");
  });
});
