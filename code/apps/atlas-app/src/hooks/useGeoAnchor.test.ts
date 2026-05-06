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
  projectImpl?: ([lng, lat]: [number, number]) => { x: number; y: number };
}): maplibregl.Map {
  const unproject = vi.fn(
    opts?.unprojectImpl ??
      (([x, y]: [number, number]) => ({ lng: x, lat: y })),
  );
  // Identity project: project(unproject([x,y])) = [x,y]. For bbox reanchor tests,
  // use geo fixtures where north < south numerically so seProj.y - nwProj.y > 0
  // (matching real map convention where north → smaller y, south → larger y).
  const project = vi.fn(
    opts?.projectImpl ??
      (([lng, lat]: [number, number]) => ({ x: lng, y: lat })),
  );
  return {
    unproject,
    project,
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

  it("line stamps polyline + geographic with projected coordinates", () => {
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
      scaleMode: "geographic",
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
      scaleMode: "geographic",
    });
  });

  it("freedraw stamps polyline + geographic (multi-point)", () => {
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
      scaleMode: "geographic",
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

  it("already-anchored bbox at its projected position passes through (no re-anchor)", () => {
    const { updateScene, trigger } = setup();
    // Geo uses north=0, south=10 (north < south numerically) so that with the
    // identity project mock project([lng,lat])→{x:lng,y:lat}, the NW corner
    // projects to {x:0,y:0} and SE to {x:10,y:10}, giving positive height diff
    // (se.y - nw.y = 10 > 0). This matches real-map convention where north
    // (larger lat) → smaller screen-y and south → larger screen-y.
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
            west: 0,
            east: 10,
            north: 0,  // north=0, south=10 so seProj.y - nwProj.y = 10 > 0
            south: 10,
            zRef: 10,
          },
          scaleMode: "geographic",
          projection: "mercator",
          schemaVersion: 1,
        },
      },
    ]);
    // Position matches projected anchor → no re-anchor → updateScene not called.
    expect(updateScene).not.toHaveBeenCalled();
  });

  it("already-anchored bbox re-anchors when moved (updates customData.geo)", () => {
    const { updateScene, trigger } = setup();
    // Element moved to x:50, y:50 but geo still reflects old position.
    // Identity project: nwProj=project(0,0)={x:0,y:0}; el.x=50 differs → re-anchor.
    // Identity unproject: (50,50)→{lng:50,lat:50}; (60,60)→{lng:60,lat:60}.
    trigger([
      {
        id: "rect-moved",
        type: "rectangle",
        x: 50,
        y: 50,
        width: 10,
        height: 10,
        customData: {
          geo: {
            kind: "bbox",
            west: 0,
            east: 10,
            north: 0,
            south: 10,
            zRef: 10,
          },
          scaleMode: "geographic",
          projection: "mercator",
          schemaVersion: 1,
        },
      },
    ]);
    expect(updateScene).toHaveBeenCalledTimes(1);
    const reanchored = updateScene.mock.calls[0][0].elements[0] as SceneElement;
    // unproject(50,50)→{lng:50,lat:50}; unproject(60,60)→{lng:60,lat:60}.
    // north=max(50,60)=60; south=min(50,60)=50.
    expect(reanchored.customData).toMatchObject({
      geo: { kind: "bbox", west: 50, east: 60, north: 60, south: 50, zRef: 10 },
      scaleMode: "geographic",
    });
  });

  it("bbox anchor survives two sync-then-onChange cycles at extreme zoom-out (clamped 1px)", () => {
    const { updateScene, trigger } = setup();
    // Simulate a bbox element after _projectElement clamped it to 1×1px at extreme
    // zoom-out. The geo span projects to < 1px so _projectElement writes width=1,
    // height=1. reanchorIfMoved must NOT misinterpret the clamped dimensions as a
    // user resize and corrupt the anchor. Two cycles catch the feedback loop: old
    // code would re-anchor on cycle 1 and compound the error on cycle 2.
    const ORIGINAL_GEO = {
      kind: "bbox" as const,
      west: 100,
      east: 100.001, // 0.001 lng span → << 1px at zoom-out
      north: 100,
      south: 100.001, // north < south so seProj.y - nwProj.y > 0 with identity mock
      zRef: 10,
    };
    // With identity project: nwProj={x:100,y:100}; seProj={x:100.001,y:100.001};
    // expectedW=max(1,0.001)=1; expectedH=max(1,0.001)=1 — matches clamped values.
    const clampedElement: SceneElement = {
      id: "rect-clamped",
      type: "rectangle",
      x: 100,
      y: 100,
      width: 1,  // clamped by _projectElement
      height: 1, // clamped by _projectElement
      customData: {
        geo: ORIGINAL_GEO,
        scaleMode: "geographic",
        projection: "mercator",
        schemaVersion: 1,
      },
    };
    trigger([clampedElement]); // cycle 1 — simulates first onChange after syncMapToScene
    expect(updateScene).not.toHaveBeenCalled();
    trigger([clampedElement]); // cycle 2 — simulates trailing-throttle call at same zoom
    expect(updateScene).not.toHaveBeenCalled();
    // Anchor integrity verified: no updateScene = geo anchor was not rewritten.
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
        id: "embed-1",
        // `embeddable` is a real Excalidraw type but is in none of the three
        // anchor buckets (BBOX_TOOL_TYPES / POLYLINE_TOOL_TYPES / POINT_TOOL_TYPES).
        type: "embeddable",
        x: 0,
        y: 0,
        width: 100,
        height: 100,
      },
    ]);
    expect(updateScene).not.toHaveBeenCalled();
  });

  it("ellipse and diamond stamp bbox + geographic (same bucket as rectangle)", () => {
    const { updateScene, trigger } = setup();
    trigger([
      { id: "ellipse-1", type: "ellipse", x: 0, y: 0, width: 20, height: 10 },
      { id: "diamond-1", type: "diamond", x: 5, y: 5, width: 15, height: 15 },
    ]);
    expect(updateScene).toHaveBeenCalledTimes(1);
    const els = updateScene.mock.calls[0][0].elements as SceneElement[];
    expect(els[0].customData).toMatchObject({ geo: { kind: "bbox" }, scaleMode: "geographic" });
    expect(els[1].customData).toMatchObject({ geo: { kind: "bbox" }, scaleMode: "geographic" });
  });

  it("frame and magicframe stamp bbox + geographic", () => {
    const { updateScene, trigger } = setup();
    trigger([
      { id: "frame-1", type: "frame", x: 0, y: 0, width: 100, height: 50 },
      { id: "mframe-1", type: "magicframe", x: 0, y: 0, width: 100, height: 50 },
    ]);
    expect(updateScene).toHaveBeenCalledTimes(1);
    const els = updateScene.mock.calls[0][0].elements as SceneElement[];
    expect(els[0].customData).toMatchObject({ geo: { kind: "bbox" }, scaleMode: "geographic" });
    expect(els[1].customData).toMatchObject({ geo: { kind: "bbox" }, scaleMode: "geographic" });
  });

  it("polyline element with missing points array is not stamped", () => {
    const { updateScene, trigger } = setup();
    // `line` is in POLYLINE_TOOL_TYPES but buildGeoCustomData requires points
    // to be present and non-empty; absent points → null → element passes through.
    trigger([{ id: "line-nopts", type: "line", x: 0, y: 0, width: 0, height: 0 }]);
    expect(updateScene).not.toHaveBeenCalled();
  });

  it("polyline element with empty points array is not stamped", () => {
    const { updateScene, trigger } = setup();
    trigger([{ id: "line-empty", type: "line", x: 0, y: 0, width: 0, height: 0, points: [] }]);
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
