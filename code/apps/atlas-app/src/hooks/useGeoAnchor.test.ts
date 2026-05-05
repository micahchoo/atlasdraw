// SPDX-License-Identifier: AGPL-3.0-only
// Tests for useGeoAnchor (Phase 2 Wave 4 Task T18 — native auto-anchor extension).
//
// We test the exported handler factory `buildGeoAnchorHandler` directly rather
// than driving the React hook — same approach as useAtlasdrawTool.test.ts (no
// @testing-library/react dep needed).

import { describe, it, expect, vi, beforeEach } from "vitest";
import type maplibregl from "maplibre-gl";
import type { ExcalidrawImperativeAPI } from "@excalidraw/excalidraw";
import { buildGeoAnchorHandler } from "./useGeoAnchor";

// ---------------------------------------------------------------------------
// Test fixtures
// ---------------------------------------------------------------------------
//
// Per project rule (.claude/rules/test-fixtures.md): if a test needs a
// different shape, construct a NEW fixture — never mutate.

interface SceneElement {
  id: string;
  type: string;
  x: number;
  y: number;
  width: number;
  height: number;
  isDeleted?: boolean;
  points?: ReadonlyArray<readonly [number, number]>;
  customData?: Record<string, unknown>;
}

interface AppStateLike {
  newElement: unknown | null;
}

/**
 * Mock map. Default `unproject` is identity-like: `[x, y] → {lng: x, lat: y}`.
 * Deterministic, easy to assert; coordinate math doesn't obscure intent.
 */
function makeMockMap(opts?: {
  zoom?: number;
  unprojectImpl?: ([x, y]: [number, number]) => { lng: number; lat: number };
}): maplibregl.Map {
  const unproject = vi.fn(
    opts?.unprojectImpl ??
      (([x, y]: [number, number]) => ({ lng: x, lat: y })),
  );
  return {
    unproject,
    project: vi.fn(),
    getZoom: vi.fn(() => opts?.zoom ?? 12),
  } as unknown as maplibregl.Map;
}

function makeMockExcalidrawAPI(): {
  api: ExcalidrawImperativeAPI;
  updateScene: ReturnType<typeof vi.fn>;
} {
  const updateScene = vi.fn();
  const api = {
    updateScene,
    onChange: vi.fn(),
  } as unknown as ExcalidrawImperativeAPI;
  return { api, updateScene };
}

function setup() {
  const map = makeMockMap();
  const { api, updateScene } = makeMockExcalidrawAPI();
  const handler = buildGeoAnchorHandler(map, api);
  function trigger(
    elements: readonly SceneElement[],
    appState: Partial<AppStateLike> = {},
  ) {
    handler(elements, { newElement: null, ...appState });
  }
  return { map, api, updateScene, trigger };
}

// ---------------------------------------------------------------------------
// Tests
// ---------------------------------------------------------------------------

describe("useGeoAnchor — native auto-anchor (Wave 4 T18)", () => {
  beforeEach(() => {
    vi.clearAllMocks();
  });

  it("rectangle stamps bbox + geographic", () => {
    const { updateScene, trigger } = setup();
    trigger([
      { id: "rect-1", type: "rectangle", x: 10, y: 20, width: 30, height: 40 },
    ]);
    expect(updateScene).toHaveBeenCalledTimes(1);
    const stamped = updateScene.mock.calls[0][0].elements[0] as SceneElement;
    expect(stamped.customData).toMatchObject({
      geo: {
        kind: "bbox",
        west: 10,
        east: 40,
        // unproject identity: nw=(10,20)→{lng:10,lat:20}; se=(40,60)→{lng:40,lat:60}.
        // north = max(20, 60) = 60; south = min(20, 60) = 20.
        north: 60,
        south: 20,
        zRef: 12,
      },
      scaleMode: "geographic",
      projection: "mercator",
      schemaVersion: 1,
    });
  });

  it("image stamps bbox + geographic (same as rectangle)", () => {
    const { updateScene, trigger } = setup();
    trigger([
      { id: "img-1", type: "image", x: 0, y: 0, width: 100, height: 50 },
    ]);
    expect(updateScene).toHaveBeenCalledTimes(1);
    const stamped = updateScene.mock.calls[0][0].elements[0] as SceneElement;
    expect(stamped.customData).toMatchObject({
      geo: { kind: "bbox", west: 0, east: 100, north: 50, south: 0, zRef: 12 },
      scaleMode: "geographic",
    });
  });

  it("line stamps polyline + hybrid with projected coordinates", () => {
    const { updateScene, trigger } = setup();
    trigger([
      {
        id: "line-1",
        type: "line",
        x: 100,
        y: 200,
        width: 50,
        height: 50,
        points: [
          [0, 0],
          [50, 50],
        ],
      },
    ]);
    expect(updateScene).toHaveBeenCalledTimes(1);
    const stamped = updateScene.mock.calls[0][0].elements[0] as SceneElement;
    expect(stamped.customData).toMatchObject({
      geo: {
        kind: "polyline",
        // Identity unproject: (100+0,200+0)→[100,200]; (100+50,200+50)→[150,250].
        coordinates: [
          [100, 200],
          [150, 250],
        ],
        zRef: 12,
      },
      scaleMode: "hybrid",
      projection: "mercator",
      schemaVersion: 1,
    });
  });

  it("arrow stamps polyline + hybrid", () => {
    const { updateScene, trigger } = setup();
    trigger([
      {
        id: "arrow-1",
        type: "arrow",
        x: 5,
        y: 10,
        width: 20,
        height: 0,
        points: [
          [0, 0],
          [20, 0],
        ],
      },
    ]);
    expect(updateScene).toHaveBeenCalledTimes(1);
    const stamped = updateScene.mock.calls[0][0].elements[0] as SceneElement;
    expect(stamped.customData).toMatchObject({
      geo: {
        kind: "polyline",
        coordinates: [
          [5, 10],
          [25, 10],
        ],
      },
      scaleMode: "hybrid",
    });
  });

  it("freedraw stamps polyline + hybrid (multi-point)", () => {
    const { updateScene, trigger } = setup();
    trigger([
      {
        id: "fd-1",
        type: "freedraw",
        x: 0,
        y: 0,
        width: 30,
        height: 30,
        points: [
          [0, 0],
          [10, 10],
          [20, 20],
          [30, 30],
        ],
      },
    ]);
    expect(updateScene).toHaveBeenCalledTimes(1);
    const stamped = updateScene.mock.calls[0][0].elements[0] as SceneElement;
    expect(stamped.customData).toMatchObject({
      geo: {
        kind: "polyline",
        coordinates: [
          [0, 0],
          [10, 10],
          [20, 20],
          [30, 30],
        ],
      },
      scaleMode: "hybrid",
    });
  });

  it("text stamps point + screen", () => {
    const { updateScene, trigger } = setup();
    trigger([
      { id: "txt-1", type: "text", x: 42, y: 84, width: 100, height: 20 },
    ]);
    expect(updateScene).toHaveBeenCalledTimes(1);
    const stamped = updateScene.mock.calls[0][0].elements[0] as SceneElement;
    expect(stamped.customData).toMatchObject({
      geo: { kind: "point", lng: 42, lat: 84, zRef: 12 },
      scaleMode: "screen",
      projection: "mercator",
      schemaVersion: 1,
    });
  });

  it("already-anchored element passes through (idempotency)", () => {
    const { updateScene, trigger } = setup();
    trigger([
      {
        id: "rect-anchored",
        type: "rectangle",
        x: 0,
        y: 0,
        width: 10,
        height: 10,
        customData: {
          geo: {
            kind: "bbox",
            west: -1,
            east: 1,
            north: 1,
            south: -1,
            zRef: 10,
          },
          scaleMode: "geographic",
          projection: "mercator",
          schemaVersion: 1,
        },
      },
    ]);
    // No element in the scene needs stamping → updateScene must not be called.
    expect(updateScene).not.toHaveBeenCalled();
  });

  it("mid-drag (appState.newElement non-null) passes through", () => {
    const { updateScene, trigger } = setup();
    trigger(
      [
        {
          id: "rect-dragging",
          type: "rectangle",
          x: 0,
          y: 0,
          width: 5,
          height: 5,
        },
      ],
      { newElement: { id: "rect-dragging" } },
    );
    expect(updateScene).not.toHaveBeenCalled();
  });

  it("unsupported element types pass through (no spurious stamping)", () => {
    const { updateScene, trigger } = setup();
    trigger([
      {
        id: "frame-1",
        // `frame` is a real Excalidraw type but not in our auto-anchor matrix.
        type: "frame",
        x: 0,
        y: 0,
        width: 100,
        height: 100,
      },
    ]);
    expect(updateScene).not.toHaveBeenCalled();
  });

  it("deleted elements pass through", () => {
    const { updateScene, trigger } = setup();
    trigger([
      {
        id: "rect-del",
        type: "rectangle",
        x: 0,
        y: 0,
        width: 10,
        height: 10,
        isDeleted: true,
      },
    ]);
    expect(updateScene).not.toHaveBeenCalled();
  });
});
