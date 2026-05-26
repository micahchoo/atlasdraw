// apps/atlas-app/src/hooks/useAtlasdrawTool.test.ts
// SPDX-License-Identifier: AGPL-3.0-only
// Phase 2 Wave 1a (T-W1a-UPDATEEL) — unit tests for the buildToolContext
// factory's `updateElement` impl. Tests are colocated with the hook (matches
// the PinTool.test.ts pattern).
//
// We test the factory rather than the React hook so we can mock the deps
// directly without a renderer (no @testing-library/react dep added).

import { describe, it, expect, vi, beforeEach } from "vitest";

import type { ExcalidrawImperativeAPI } from "@excalidraw/excalidraw";

import { buildToolContext } from "./useAtlasdrawTool";

import type maplibregl from "maplibre-gl";

// ---------------------------------------------------------------------------
// Test fixtures
// ---------------------------------------------------------------------------
//
// Shared across tests in this file. If a test needs a different shape,
// construct a NEW fixture (per project rule: never mutate fixtures to fix
// one test).

interface SceneElement {
  id: string;
  x: number;
  y: number;
  width?: number;
  height?: number;
  points?: ReadonlyArray<readonly [number, number]>;
  strokeColor?: string;
  backgroundColor?: string;
  strokeWidth?: number;
  opacity?: number;
  customData?: Record<string, unknown>;
}

function makeMockMap(opts?: {
  projectImpl?: (lngLat: [number, number]) => { x: number; y: number };
}): maplibregl.Map {
  const project = vi.fn(
    opts?.projectImpl ??
      // Default: scale lng→x by 100 and lat→y by 100 (deterministic, easy to assert).
      (([lng, lat]: [number, number]) => ({ x: lng * 100, y: lat * 100 })),
  );
  // Cast to maplibregl.Map — only `.project` and `.unproject` are exercised
  // by the code under test, so a partial mock is sufficient. We expose the
  // spy DIRECTLY (not via a wrapping closure) so tests can call
  // `expect(map.project).toHaveBeenCalled()` against it.
  return {
    project,
    unproject: vi.fn(() => ({ lng: 0, lat: 0 })),
    getZoom: vi.fn(() => 12),
    getBounds: vi.fn(() => ({
      getNorth: () => 1,
      getSouth: () => 0,
      getEast: () => 1,
      getWest: () => 0,
    })),
  } as unknown as maplibregl.Map;
}

function makeMockExcalidrawAPI(initialElements: SceneElement[]): {
  api: ExcalidrawImperativeAPI;
  updateScene: ReturnType<typeof vi.fn>;
  getSceneElements: ReturnType<typeof vi.fn>;
} {
  let elements: SceneElement[] = [...initialElements];
  const getSceneElements = vi.fn(() => elements);
  const updateScene = vi.fn(
    (sceneData: { elements?: ReadonlyArray<SceneElement> }) => {
      if (sceneData.elements) {
        elements = [...sceneData.elements];
      }
    },
  );
  const api = {
    getSceneElements,
    updateScene,
    getAppState: vi.fn(() => ({ activeTool: { type: "selection" } })),
  } as unknown as ExcalidrawImperativeAPI;
  return { api, updateScene, getSceneElements };
}

function makeGeoCustomData(
  overrides: Partial<Record<string, unknown>> = {},
): Record<string, unknown> {
  return {
    geo: {
      kind: "point" as const,
      lng: 1,
      lat: 2,
      zRef: 12,
    },
    scaleMode: "screen" as const,
    projection: "mercator" as const,
    schemaVersion: 1,
    ...overrides,
  };
}

// ---------------------------------------------------------------------------
// Tests
// ---------------------------------------------------------------------------

describe("buildToolContext().excalidraw.updateElement", () => {
  let warnSpy: ReturnType<typeof vi.spyOn>;

  beforeEach(() => {
    warnSpy = vi.spyOn(console, "warn").mockImplementation(() => {
      /* swallow */
    });
  });

  it("re-projects to new scene coords when patch.geo is supplied", () => {
    // Existing element: pin-style 16×16 ellipse centered on (100, 200).
    const existing: SceneElement = {
      id: "el-1",
      x: 100 - 8,
      y: 200 - 8,
      width: 16,
      height: 16,
      customData: makeGeoCustomData({
        geo: { kind: "point", lng: 1, lat: 2, zRef: 12 },
      }),
    };
    const map = makeMockMap();
    const { api, updateScene } = makeMockExcalidrawAPI([existing]);

    const ctx = buildToolContext(map, api);
    ctx.excalidraw.updateElement("el-1", {
      geo: { kind: "point", lng: 5, lat: 7, zRef: 12 },
    });

    expect(updateScene).toHaveBeenCalledTimes(1);
    const passedElements = updateScene.mock.calls[0][0]
      .elements as SceneElement[];
    expect(passedElements).toHaveLength(1);
    const patched = passedElements[0];
    // Default mock projects (lng, lat) → (lng*100, lat*100) → (500, 700).
    // Element is 16×16; expected top-left = (500-8, 700-8) = (492, 692).
    expect(patched.id).toBe("el-1");
    expect(patched.x).toBe(492);
    expect(patched.y).toBe(692);
    // customData.geo updated; projection + schemaVersion preserved.
    expect(patched.customData).toMatchObject({
      geo: { kind: "point", lng: 5, lat: 7, zRef: 12 },
      projection: "mercator",
      schemaVersion: 1,
      scaleMode: "screen",
    });
  });

  it("re-projects bbox patches into x/y/width/height", () => {
    const existing: SceneElement = {
      id: "el-bbox",
      x: 0,
      y: 0,
      width: 10,
      height: 10,
      customData: makeGeoCustomData({
        scaleMode: "geographic",
        geo: {
          kind: "bbox",
          west: 0,
          south: 0,
          east: 1,
          north: 1,
          zRef: 12,
        },
      }),
    };
    const map = makeMockMap();
    const { api, updateScene } = makeMockExcalidrawAPI([existing]);

    const ctx = buildToolContext(map, api);
    ctx.excalidraw.updateElement("el-bbox", {
      geo: {
        kind: "bbox",
        west: 1,
        south: 2,
        east: 4,
        north: 5,
        zRef: 12,
      },
    });

    const patched = updateScene.mock.calls[0][0].elements[0] as SceneElement;
    // Project NW (west=1, north=5) → (100, 500); SE (east=4, south=2) → (400, 200).
    // x = min(100, 400) = 100; y = min(500, 200) = 200; w = 300; h = 300.
    expect(patched.x).toBe(100);
    expect(patched.y).toBe(200);
    expect(patched.width).toBe(300);
    expect(patched.height).toBe(300);
  });

  it("re-projects polyline patches into x/y/points (LocalPoint relative)", () => {
    const existing: SceneElement = {
      id: "el-line",
      x: 0,
      y: 0,
      points: [[0, 0]],
      customData: makeGeoCustomData({
        scaleMode: "geographic",
        geo: {
          kind: "polyline",
          coordinates: [[0, 0]],
          zRef: 12,
        },
      }),
    };
    const map = makeMockMap();
    const { api, updateScene } = makeMockExcalidrawAPI([existing]);

    const ctx = buildToolContext(map, api);
    ctx.excalidraw.updateElement("el-line", {
      geo: {
        kind: "polyline",
        coordinates: [
          [1, 2],
          [3, 4],
          [5, 6],
        ],
        zRef: 12,
      },
    });

    const patched = updateScene.mock.calls[0][0].elements[0] as SceneElement;
    // First vertex projects to (100, 200) — becomes element origin.
    // Subsequent points are LocalPoint = projected - origin.
    expect(patched.x).toBe(100);
    expect(patched.y).toBe(200);
    expect(patched.points).toEqual([
      [0, 0],
      [200, 200], // (300-100, 400-200)
      [400, 400], // (500-100, 600-200)
    ]);
  });

  it("updates non-geo patch fields without re-projecting", () => {
    const existing: SceneElement = {
      id: "el-style",
      x: 50,
      y: 60,
      width: 16,
      height: 16,
      strokeColor: "#000000",
      backgroundColor: "#ffffff",
      strokeWidth: 1,
      opacity: 100,
      customData: makeGeoCustomData(),
    };
    const map = makeMockMap();
    const project = map.project as unknown as ReturnType<typeof vi.fn>;
    const { api, updateScene } = makeMockExcalidrawAPI([existing]);

    const ctx = buildToolContext(map, api);
    ctx.excalidraw.updateElement("el-style", {
      style: {
        strokeColor: "#ff0000",
        fillColor: "#00ff00",
        strokeWidth: 3,
        opacity: 0.5,
      },
      data: { label: "marker A" },
    });

    // No geo patch → projectPoint should NOT have been called.
    expect(project).not.toHaveBeenCalled();
    const patched = updateScene.mock.calls[0][0].elements[0] as SceneElement;
    // Spatial fields untouched.
    expect(patched.x).toBe(50);
    expect(patched.y).toBe(60);
    // Style applied; opacity scaled 0-1 → 0-100.
    expect(patched.strokeColor).toBe("#ff0000");
    expect(patched.backgroundColor).toBe("#00ff00");
    expect(patched.strokeWidth).toBe(3);
    expect(patched.opacity).toBe(50);
    // data lifted under customData._data (escape per seedToElement convention).
    expect(patched.customData).toMatchObject({
      _data: { label: "marker A" },
      // Existing GeoCustomData preserved.
      projection: "mercator",
      schemaVersion: 1,
    });
  });

  it("no-ops with a console.warn (no throw) when id is not in scene", () => {
    const map = makeMockMap();
    const { api, updateScene } = makeMockExcalidrawAPI([
      {
        id: "el-existing",
        x: 0,
        y: 0,
        width: 16,
        height: 16,
        customData: makeGeoCustomData(),
      },
    ]);

    const ctx = buildToolContext(map, api);
    expect(() =>
      ctx.excalidraw.updateElement("missing-id", {
        geo: { kind: "point", lng: 9, lat: 9, zRef: 12 },
      }),
    ).not.toThrow();

    expect(updateScene).not.toHaveBeenCalled();
    expect(warnSpy).toHaveBeenCalledTimes(1);
    expect(warnSpy.mock.calls[0][0]).toMatch(/missing-id/);
  });

  it("preserves untouched scene elements when patching one", () => {
    const a: SceneElement = {
      id: "a",
      x: 1,
      y: 1,
      width: 0,
      height: 0,
      customData: makeGeoCustomData(),
    };
    const b: SceneElement = {
      id: "b",
      x: 2,
      y: 2,
      width: 0,
      height: 0,
      customData: makeGeoCustomData(),
    };
    const map = makeMockMap();
    const { api, updateScene } = makeMockExcalidrawAPI([a, b]);

    const ctx = buildToolContext(map, api);
    ctx.excalidraw.updateElement("b", {
      geo: { kind: "point", lng: 0, lat: 0, zRef: 12 },
    });

    const passed = updateScene.mock.calls[0][0].elements as SceneElement[];
    expect(passed).toHaveLength(2);
    // Element "a" reference is preserved verbatim.
    expect(passed[0]).toBe(a);
    // Element "b" is a NEW object (not mutated in place).
    expect(passed[1]).not.toBe(b);
    expect(passed[1].id).toBe("b");
  });
});
