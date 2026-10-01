// SPDX-License-Identifier: AGPL-3.0-only
//
// With the selection tool, Excalidraw takes every press on the plate. A
// press that hits no drawing and does not drag is a click on the map below.

import { describe, expect, it } from "vitest";

import { isClickOnEmptyCanvas } from "./useCanvasClickThrough";

const state = (over: {
  element?: unknown;
  allHitElements?: unknown[];
  inBox?: boolean;
  dragged?: boolean;
  boxSelect?: boolean;
}) =>
  ({
    hit: {
      element: over.element ?? null,
      allHitElements: over.allHitElements ?? [],
      hasHitCommonBoundingBoxOfSelectedElements: over.inBox ?? false,
    },
    drag: { hasOccurred: over.dragged ?? false },
    boxSelection: { hasOccurred: over.boxSelect ?? false },
  } as unknown as Parameters<typeof isClickOnEmptyCanvas>[1]);

describe("isClickOnEmptyCanvas", () => {
  it("is true for a selection-tool click on no drawing", () => {
    expect(isClickOnEmptyCanvas({ type: "selection" }, state({}))).toBe(true);
  });

  it("is false when the click hits a drawing", () => {
    expect(
      isClickOnEmptyCanvas({ type: "selection" }, state({ element: {} })),
    ).toBe(false);
    expect(
      isClickOnEmptyCanvas(
        { type: "selection" },
        state({ allHitElements: [{}] }),
      ),
    ).toBe(false);
    expect(
      isClickOnEmptyCanvas({ type: "selection" }, state({ inBox: true })),
    ).toBe(false);
  });

  it("is false for a drag or a box selection", () => {
    expect(
      isClickOnEmptyCanvas({ type: "selection" }, state({ dragged: true })),
    ).toBe(false);
    expect(
      isClickOnEmptyCanvas({ type: "selection" }, state({ boxSelect: true })),
    ).toBe(false);
  });

  it("is false for any other tool", () => {
    expect(isClickOnEmptyCanvas({ type: "rectangle" }, state({}))).toBe(false);
    expect(isClickOnEmptyCanvas({ type: "hand" }, state({}))).toBe(false);
  });
});
