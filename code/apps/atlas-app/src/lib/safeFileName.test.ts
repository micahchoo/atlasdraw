// SPDX-License-Identifier: AGPL-3.0-only
// safeFileName unit tests — the document title reaches two download paths as
// a filename, so the reduction has to be total: every input produces a stem
// that is safe to hand to `a.download` / `showSaveFilePicker`.

import { describe, expect, it } from "vitest";

import { safeFileName } from "./safeFileName";

describe("safeFileName", () => {
  it("passes through word characters, dashes and spaces", () => {
    expect(safeFileName("Bidar ward-3 survey")).toBe("Bidar ward-3 survey");
  });

  it("replaces path separators so a title can't escape the download dir", () => {
    expect(safeFileName("maps/2026/final")).toBe("maps_2026_final");
    expect(safeFileName("..\\..\\etc")).toBe("etc");
  });

  it("collapses runs of replaced characters into one underscore", () => {
    expect(safeFileName("map: v2 // final")).toBe("map_ v2 _ final");
  });

  it("strips leading and trailing underscores", () => {
    expect(safeFileName("...draft...")).toBe("draft");
  });

  it("falls back when the title reduces to nothing", () => {
    expect(safeFileName("///")).toBe("atlasdraw");
    expect(safeFileName("   ")).toBe("atlasdraw");
    expect(safeFileName("")).toBe("atlasdraw");
  });

  it("does not leave a bare dot that would break the extension", () => {
    expect(safeFileName(".")).toBe("atlasdraw");
  });
});
