// SPDX-License-Identifier: MIT
// Phase 6 A11 — asset-library reader tests.

import { describe, it, expect } from "vitest";

import {
  parseLibraryFile,
  getBuiltInLibraries,
  type ExcalidrawLibrary,
  type LibraryParseError,
} from "../asset-library";

const VALID_FIXTURE = JSON.stringify({
  type: "excalidrawlib",
  version: 2,
  source: "atlasdraw:test",
  libraryItems: [
    {
      id: "test-item-1",
      status: "published",
      created: 1700000000000,
      name: "Fire",
      elements: [
        {
          type: "rectangle",
          x: 0,
          y: 0,
          width: 24,
          height: 24,
          strokeColor: "#d92020",
          backgroundColor: "transparent",
        },
      ],
    },
  ],
});

describe("parseLibraryFile", () => {
  it("parses valid .excalidrawlib JSON into ExcalidrawLibrary", () => {
    const result = parseLibraryFile(VALID_FIXTURE);
    expect("error" in result).toBe(false);
    const lib = result as ExcalidrawLibrary;
    expect(lib.type).toBe("excalidrawlib");
    expect(lib.version).toBe(2);
    expect(lib.libraryItems).toHaveLength(1);
    expect(lib.libraryItems[0].id).toBe("test-item-1");
    expect(lib.source).toBe("atlasdraw:test");
  });

  it("returns LibraryParseError on invalid JSON", () => {
    const result = parseLibraryFile("{not json");
    expect("error" in result).toBe(true);
    const err = result as LibraryParseError;
    expect(err.error).toMatch(/parse error/);
    expect(err.raw).toBe("{not json");
  });

  it("returns LibraryParseError when libraryItems field is missing", () => {
    const noItems = JSON.stringify({ type: "excalidrawlib", version: 2 });
    const result = parseLibraryFile(noItems);
    expect("error" in result).toBe(true);
    const err = result as LibraryParseError;
    expect(err.error).toMatch(/libraryItems/);
  });

  it("returns LibraryParseError when libraryItems is not an array", () => {
    const wrongShape = JSON.stringify({
      type: "excalidrawlib",
      version: 2,
      libraryItems: { not: "an array" },
    });
    const result = parseLibraryFile(wrongShape);
    expect("error" in result).toBe(true);
  });

  it("returns LibraryParseError when type field is wrong", () => {
    const wrongType = JSON.stringify({
      type: "excalidraw",
      version: 2,
      libraryItems: [],
    });
    const result = parseLibraryFile(wrongType);
    expect("error" in result).toBe(true);
    const err = result as LibraryParseError;
    expect(err.error).toMatch(/type field/);
  });

  it("returns LibraryParseError on non-object payload", () => {
    const result = parseLibraryFile("null");
    expect("error" in result).toBe(true);
  });
});

describe("getBuiltInLibraries", () => {
  it("returns at least 3 libraries from the bundled fixtures", () => {
    const libs = getBuiltInLibraries();
    expect(libs.length).toBeGreaterThanOrEqual(3);
  });

  it("every built-in library has type='excalidrawlib' and at least one item", () => {
    const libs = getBuiltInLibraries();
    for (const lib of libs) {
      expect(lib.type).toBe("excalidrawlib");
      expect(Array.isArray(lib.libraryItems)).toBe(true);
      expect(lib.libraryItems.length).toBeGreaterThan(0);
    }
  });

  it("every library item has the required v2 LibraryItem fields", () => {
    const libs = getBuiltInLibraries();
    for (const lib of libs) {
      for (const item of lib.libraryItems) {
        expect(typeof item.id).toBe("string");
        expect(["published", "unpublished"]).toContain(item.status);
        expect(Array.isArray(item.elements)).toBe(true);
        expect(item.elements.length).toBeGreaterThan(0);
        expect(typeof item.created).toBe("number");
      }
    }
  });

  it("includes the three named atlas-curated libraries", () => {
    const libs = getBuiltInLibraries();
    const sources = libs.map((l) => l.source ?? "").filter(Boolean);
    expect(sources).toContain("atlasdraw:wildfire-icons");
    expect(sources).toContain("atlasdraw:transit-symbols");
    expect(sources).toContain("atlasdraw:hazard-markers");
  });
});
