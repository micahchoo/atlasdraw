import { describe, it, expect, vi } from "vitest";
import { CoordinateSync, type ExcalidrawAPI, type ExcalidrawElementLike } from "./CoordinateSync.js";
import type { GeoCustomData } from "./types.js";

// MapLibre Map test double — only the methods CoordinateSync touches.
function makeMap(project = vi.fn().mockReturnValue({ x: 100, y: 200 })) {
  return {
    project,
    on: vi.fn(),
    off: vi.fn(),
    getCenter: vi.fn().mockReturnValue({ lng: 0, lat: 0 }),
    getZoom: vi.fn().mockReturnValue(12),
    getPitch: vi.fn().mockReturnValue(0),
    getBearing: vi.fn().mockReturnValue(0),
  };
}

/**
 * Build a `project` mock that returns different `{x,y}` per (lng,lat) input,
 * keyed by tuple JSON. Throws on any unmocked input — surfaces drift in tests
 * when a worker forgets to mock a coordinate the impl actually projects.
 */
function makeProjectByLngLat(
  table: ReadonlyArray<readonly [readonly [number, number], { x: number; y: number }]>,
) {
  return vi.fn((coord: [number, number]) => {
    const key = JSON.stringify(coord);
    const hit = table.find(([k]) => JSON.stringify(k) === key);
    if (!hit) throw new Error(`Unmocked project call: ${key}`);
    return hit[1];
  });
}

function makeApi(elements: ExcalidrawElementLike[]) {
  const updateScene = vi.fn();
  const api: ExcalidrawAPI = {
    getSceneElements: vi.fn().mockReturnValue(elements),
    updateScene,
  };
  return { api, updateScene };
}

const pointCustomData: GeoCustomData = {
  geo: { kind: "point", lng: -122.4194, lat: 37.7749, zRef: 12 },
  scaleMode: "screen",
  projection: "mercator",
  schemaVersion: 1,
};

// west < east, north > south — geographic-correct corners.
const bboxCustomData: GeoCustomData = {
  geo: { kind: "bbox", west: -1, south: -1, east: 1, north: 1, zRef: 12 },
  scaleMode: "geographic",
  projection: "mercator",
  schemaVersion: 1,
};

// scaleMode: "geographic" — these fixtures exercise the geographic-projection
// arm (points relative to projected first coord). Updated from "screen" in
// T17 (was an arbitrary placeholder when scaleMode was unread; now load-bearing
// because polyline+screen preserves el.points instead of projecting).
const polylineTwoPoint: GeoCustomData = {
  geo: { kind: "polyline", coordinates: [[0, 0], [1, 1]], zRef: 12 },
  scaleMode: "geographic",
  projection: "mercator",
  schemaVersion: 1,
};

const polylineThreePoint: GeoCustomData = {
  geo: { kind: "polyline", coordinates: [[0, 0], [1, 0], [-1, 0]], zRef: 12 },
  scaleMode: "geographic",
  projection: "mercator",
  schemaVersion: 1,
};

describe("CoordinateSync.syncMapToScene", () => {
  it("Test A: element without customData.geo is returned unchanged", () => {
    const project = vi.fn().mockReturnValue({ x: 999, y: 999 });
    const map = makeMap(project);
    const plainEl: ExcalidrawElementLike = {
      id: "plain-1",
      x: 10,
      y: 20,
      width: 5,
      height: 5,
      customData: undefined,
    };
    const { api, updateScene } = makeApi([plainEl]);
    // eslint-disable-next-line @typescript-eslint/no-explicit-any
    const sync = new CoordinateSync({ map: map as any, excalidrawAPI: api });

    sync.syncMapToScene();

    expect(updateScene).toHaveBeenCalledOnce();
    expect(project).not.toHaveBeenCalled();
    const passed = updateScene.mock.calls[0][0].elements as ExcalidrawElementLike[];
    expect(passed).toHaveLength(1);
    expect(passed[0]).toBe(plainEl); // same reference, untouched
  });

  it("Test B: element with kind: 'point' anchor gets x/y updated from map.project", () => {
    const project = vi.fn().mockReturnValue({ x: 500, y: 400 });
    const map = makeMap(project);
    const pointEl: ExcalidrawElementLike = {
      id: "p1",
      x: 0,
      y: 0,
      width: 8,
      height: 8,
      customData: pointCustomData,
    };
    const { api, updateScene } = makeApi([pointEl]);
    // eslint-disable-next-line @typescript-eslint/no-explicit-any
    const sync = new CoordinateSync({ map: map as any, excalidrawAPI: api });

    sync.syncMapToScene();

    expect(project).toHaveBeenCalledWith([-122.4194, 37.7749]);
    const passed = updateScene.mock.calls[0][0].elements as ExcalidrawElementLike[];
    expect(passed[0]).toMatchObject({ id: "p1", x: 500, y: 400, width: 8, height: 8 });
    // Invariant: customData.geo value preserved; customData is a NEW object
    // (_projectElement shallow-spreads customData and adds _lastSync for reanchorIfMoved).
    const resultData = passed[0].customData as GeoCustomData & { _lastSync?: unknown };
    expect(resultData.geo).toEqual(pointCustomData.geo);
    expect(resultData._lastSync).toEqual({ x: 500, y: 400 });
  });

  it("Test C: captureUpdate: 'NEVER' is passed to updateScene", () => {
    const map = makeMap();
    const { api, updateScene } = makeApi([]);
    // eslint-disable-next-line @typescript-eslint/no-explicit-any
    const sync = new CoordinateSync({ map: map as any, excalidrawAPI: api });

    sync.syncMapToScene();

    expect(updateScene).toHaveBeenCalledOnce();
    const opts = updateScene.mock.calls[0][0];
    expect(opts.captureUpdate).toBe("NEVER");
  });

  it("Test D (Task 5 addendum): subsequent sync calls re-read map.project — element x/y track camera", () => {
    const project = vi.fn();
    project.mockReturnValueOnce({ x: 100, y: 100 });
    project.mockReturnValueOnce({ x: 250, y: 333 });
    const map = makeMap(project);
    const pointEl: ExcalidrawElementLike = {
      id: "p-zoom",
      x: 0,
      y: 0,
      width: 8,
      height: 8,
      customData: pointCustomData,
    };
    const { api, updateScene } = makeApi([pointEl]);
    // eslint-disable-next-line @typescript-eslint/no-explicit-any
    const sync = new CoordinateSync({ map: map as any, excalidrawAPI: api });

    sync.syncMapToScene();
    sync.syncMapToScene();

    expect(project).toHaveBeenCalledTimes(2);
    const second = updateScene.mock.calls[1][0].elements as ExcalidrawElementLike[];
    expect(second[0]).toMatchObject({ x: 250, y: 333 });
  });
});

describe("CoordinateSync.syncMapToScene — bbox anchor (Task 6)", () => {
  it("projects NW + SE corners → x/y/width/height", () => {
    const project = makeProjectByLngLat([
      [[-1, 1], { x: 100, y: 100 }],   // NW = (west, north)
      [[1, -1], { x: 300, y: 250 }],   // SE = (east, south)
    ]);
    const map = makeMap(project);
    const bboxEl: ExcalidrawElementLike = {
      id: "b1",
      x: 0,
      y: 0,
      width: 0,
      height: 0,
      customData: bboxCustomData,
    };
    const { api, updateScene } = makeApi([bboxEl]);
    // eslint-disable-next-line @typescript-eslint/no-explicit-any
    const sync = new CoordinateSync({ map: map as any, excalidrawAPI: api });

    sync.syncMapToScene();

    const passed = updateScene.mock.calls[0][0].elements as ExcalidrawElementLike[];
    expect(passed[0]).toMatchObject({ id: "b1", x: 100, y: 100, width: 200, height: 150 });
    // Invariant: customData.geo value preserved; customData is a NEW object
    // (_projectElement shallow-spreads customData and adds _lastSync).
    const resultData = passed[0].customData as GeoCustomData & { _lastSync?: unknown };
    expect(resultData.geo).toEqual(bboxCustomData.geo);
    expect(resultData._lastSync).toEqual({ x: 100, y: 100, w: 200, h: 150 });
  });

  it("clamps width/height to >= 1 when projection inverts (rotated/pitched camera)", () => {
    // NW projects to a higher-x/higher-y than SE — would yield negative span.
    const project = makeProjectByLngLat([
      [[-1, 1], { x: 200, y: 200 }],
      [[1, -1], { x: 50, y: 50 }],
    ]);
    const map = makeMap(project);
    const bboxEl: ExcalidrawElementLike = {
      id: "b-rot",
      x: 0,
      y: 0,
      customData: bboxCustomData,
    };
    const { api, updateScene } = makeApi([bboxEl]);
    // eslint-disable-next-line @typescript-eslint/no-explicit-any
    const sync = new CoordinateSync({ map: map as any, excalidrawAPI: api });

    sync.syncMapToScene();

    const passed = updateScene.mock.calls[0][0].elements as ExcalidrawElementLike[];
    expect(passed[0].width).toBe(1);
    expect(passed[0].height).toBe(1);
  });
});

describe("CoordinateSync.syncMapToScene — polyline anchor (Task 7)", () => {
  it("two-point line: x/y = first projected point; points relative to origin", () => {
    const project = makeProjectByLngLat([
      [[0, 0], { x: 10, y: 20 }],
      [[1, 1], { x: 30, y: 50 }],
    ]);
    const map = makeMap(project);
    const lineEl: ExcalidrawElementLike = {
      id: "l1",
      x: 0,
      y: 0,
      points: [],
      customData: polylineTwoPoint,
    };
    const { api, updateScene } = makeApi([lineEl]);
    // eslint-disable-next-line @typescript-eslint/no-explicit-any
    const sync = new CoordinateSync({ map: map as any, excalidrawAPI: api });

    sync.syncMapToScene();

    const passed = updateScene.mock.calls[0][0].elements as ExcalidrawElementLike[];
    expect(passed[0]).toMatchObject({
      id: "l1",
      x: 10,
      y: 20,
      points: [
        [0, 0],
        [20, 30],
      ],
    });
  });

  it("three-point line with later point projecting back past origin yields negative offsets", () => {
    // First point [0,0] is the origin. Third point [-1,0] projects to lower x → negative dx.
    const project = makeProjectByLngLat([
      [[0, 0], { x: 50, y: 50 }],
      [[1, 0], { x: 80, y: 50 }],
      [[-1, 0], { x: 20, y: 50 }],
    ]);
    const map = makeMap(project);
    const lineEl: ExcalidrawElementLike = {
      id: "l3",
      x: 0,
      y: 0,
      points: [],
      customData: polylineThreePoint,
    };
    const { api, updateScene } = makeApi([lineEl]);
    // eslint-disable-next-line @typescript-eslint/no-explicit-any
    const sync = new CoordinateSync({ map: map as any, excalidrawAPI: api });

    sync.syncMapToScene();

    const passed = updateScene.mock.calls[0][0].elements as ExcalidrawElementLike[];
    expect(passed[0]).toMatchObject({
      id: "l3",
      x: 50,
      y: 50,
      points: [
        [0, 0],
        [30, 0],
        [-30, 0],
      ],
    });
  });
});

// ---------------------------------------------------------------------------
// atlasdraw-76b2 — polyline width/height projection (was: stale at create-zoom
// → Excalidraw clipped/misplaced rendered shape when zoomed in past zRef).
//
// Hypothesis A fix: `_projectElement` polyline branch now derives width/height
// from the projected-points bbox on every projection, in all 3 scaleMode arms.
// ---------------------------------------------------------------------------
describe("CoordinateSync — polyline width/height projection (atlasdraw-76b2)", () => {
  it("polyline + geographic — width/height computed from projected points bbox at creation zoom", () => {
    // 3-point line at zoom 12 (== zRef). Projected: x=20, 50, 80 → relative
    // offsets 0, 30, -30. width = max-min = 60. All ys equal → height clamps to 1.
    const project = makeProjectByLngLat([
      [[0, 0], { x: 50, y: 50 }],
      [[1, 0], { x: 80, y: 50 }],
      [[-1, 0], { x: 20, y: 50 }],
    ]);
    const map = makeMap(project);
    map.getZoom.mockReturnValue(12); // == zRef → factor = 1
    const lineEl: ExcalidrawElementLike = {
      id: "l-create",
      x: 0,
      y: 0,
      width: 999, // stale value to prove we OVERWROTE it
      height: 999,
      points: [],
      customData: polylineThreePoint,
    };
    const { api, updateScene } = makeApi([lineEl]);
    // eslint-disable-next-line @typescript-eslint/no-explicit-any
    const sync = new CoordinateSync({ map: map as any, excalidrawAPI: api });

    sync.syncMapToScene();

    const passed = updateScene.mock.calls[0][0].elements as ExcalidrawElementLike[];
    expect(passed[0].width).toBe(60);
    expect(passed[0].height).toBe(1); // clamped from 0
  });

  it("polyline + geographic — width/height grow ~4× when zoomed in 2 levels (factor = 4)", () => {
    // At zoom 14 (delta +2), Mercator projects same lng/lat ~4× farther apart
    // in pixels. We model the post-projection coords directly: 0→200, 1→320,
    // -1→80 (4× creation span). Width = 320-80 = 240 = 4× the 60 at creation.
    const project = makeProjectByLngLat([
      [[0, 0], { x: 200, y: 200 }],
      [[1, 0], { x: 320, y: 200 }],
      [[-1, 0], { x: 80, y: 200 }],
    ]);
    const map = makeMap(project);
    map.getZoom.mockReturnValue(14); // delta +2 → factor = 4
    const lineEl: ExcalidrawElementLike = {
      id: "l-zin",
      x: 0,
      y: 0,
      points: [],
      customData: polylineThreePoint,
    };
    const { api, updateScene } = makeApi([lineEl]);
    // eslint-disable-next-line @typescript-eslint/no-explicit-any
    const sync = new CoordinateSync({ map: map as any, excalidrawAPI: api });

    sync.syncMapToScene();

    const passed = updateScene.mock.calls[0][0].elements as ExcalidrawElementLike[];
    expect(passed[0].width).toBe(240); // 4× the 60 from creation zoom
    expect(passed[0].height).toBe(1);
    // Sanity: x/y match the projected first coord.
    expect(passed[0]).toMatchObject({ x: 200, y: 200 });
  });

  it("polyline + geographic — width/height shrink ~1/4× when zoomed out 2 levels", () => {
    // At zoom 10 (delta -2), Mercator projects same lng/lat ~1/4× as far apart.
    // Modeled: 0→50, 1→57.5, -1→42.5. Width = 15 = 1/4× the 60 at creation.
    const project = makeProjectByLngLat([
      [[0, 0], { x: 50, y: 50 }],
      [[1, 0], { x: 57.5, y: 50 }],
      [[-1, 0], { x: 42.5, y: 50 }],
    ]);
    const map = makeMap(project);
    map.getZoom.mockReturnValue(10); // delta -2 → factor = 0.25
    const lineEl: ExcalidrawElementLike = {
      id: "l-zout",
      x: 0,
      y: 0,
      points: [],
      customData: polylineThreePoint,
    };
    const { api, updateScene } = makeApi([lineEl]);
    // eslint-disable-next-line @typescript-eslint/no-explicit-any
    const sync = new CoordinateSync({ map: map as any, excalidrawAPI: api });

    sync.syncMapToScene();

    const passed = updateScene.mock.calls[0][0].elements as ExcalidrawElementLike[];
    expect(passed[0].width).toBe(15); // 1/4× the 60 from creation zoom
    expect(passed[0].height).toBe(1);
  });

  it("polyline + hybrid — width/height plateau at 4× creation past +2 zoom delta (clamp holds)", () => {
    // zRef=12, currentZoom=16 → factor = 16. Hybrid clamps to MAX=4.
    // Polyline impl scales offsets by `clamp(factor)/factor = 4/16 = 0.25`.
    // Projected pixel span at zoom 16 is 16× creation (= 16 * 60 = 960).
    // After multiplying offsets by 0.25, on-screen width = 960 * 0.25 = 240.
    // That's exactly 4× the creation width of 60 — the clamp ceiling.
    const polylineHybrid: GeoCustomData = {
      geo: { kind: "polyline", coordinates: [[0, 0], [1, 0], [-1, 0]], zRef: 12 },
      scaleMode: "hybrid",
      projection: "mercator",
      schemaVersion: 1,
    };
    // At zoom 16, 1deg-of-lng projects 16× the creation pixel span.
    // Origin at 1000; +1deg → +480px (16 * 30); -1deg → -480px.
    const project = makeProjectByLngLat([
      [[0, 0], { x: 1000, y: 1000 }],
      [[1, 0], { x: 1480, y: 1000 }],
      [[-1, 0], { x: 520, y: 1000 }],
    ]);
    const map = makeMap(project);
    map.getZoom.mockReturnValue(16); // delta +4 → factor=16, clamps to 4
    const lineEl: ExcalidrawElementLike = {
      id: "l-hclamp",
      x: 0,
      y: 0,
      points: [],
      customData: polylineHybrid,
    };
    const { api, updateScene } = makeApi([lineEl]);
    // eslint-disable-next-line @typescript-eslint/no-explicit-any
    const sync = new CoordinateSync({ map: map as any, excalidrawAPI: api });

    sync.syncMapToScene();

    const passed = updateScene.mock.calls[0][0].elements as ExcalidrawElementLike[];
    // Plateaued at 4× the creation width of 60 = 240, regardless of zoom delta.
    expect(passed[0].width).toBeCloseTo(240, 5);
    expect(passed[0].height).toBe(1);
  });

  it("polyline + screen — width/height match the stored screen-space points bbox", () => {
    // screen mode preserves stored el.points unchanged. Width/height derive
    // from THAT bbox, not from re-projected coordinates.
    const polylineScreen: GeoCustomData = {
      geo: { kind: "polyline", coordinates: [[0, 0], [1, 1]], zRef: 12 },
      scaleMode: "screen",
      projection: "mercator",
      schemaVersion: 1,
    };
    // First coord is the only one projected (for x/y origin). Stored points
    // describe the screen-space shape: 0..40 wide, 0..25 tall.
    const project = makeProjectByLngLat([[[0, 0], { x: 200, y: 300 }]]);
    const map = makeMap(project);
    const lineEl: ExcalidrawElementLike = {
      id: "l-screen",
      x: 0,
      y: 0,
      width: 999,
      height: 999,
      points: [
        [0, 0],
        [40, 25],
      ],
      customData: polylineScreen,
    };
    const { api, updateScene } = makeApi([lineEl]);
    // eslint-disable-next-line @typescript-eslint/no-explicit-any
    const sync = new CoordinateSync({ map: map as any, excalidrawAPI: api });

    sync.syncMapToScene();

    const passed = updateScene.mock.calls[0][0].elements as ExcalidrawElementLike[];
    expect(passed[0]).toMatchObject({
      id: "l-screen",
      x: 200,
      y: 300,
      width: 40, // stored-points bbox width
      height: 25, // stored-points bbox height
    });
  });

  it("polyline + screen — width/height clamped to >= 1 for zero-extent stored points", () => {
    // Single-point polyline (or all-coincident points) → degenerate bbox.
    // Must not return width/height = 0; clamp to 1 so Excalidraw's hit-test
    // and selection rect remain non-degenerate.
    const polylineScreen: GeoCustomData = {
      geo: { kind: "polyline", coordinates: [[0, 0]], zRef: 12 },
      scaleMode: "screen",
      projection: "mercator",
      schemaVersion: 1,
    };
    const project = makeProjectByLngLat([[[0, 0], { x: 100, y: 100 }]]);
    const map = makeMap(project);
    const lineEl: ExcalidrawElementLike = {
      id: "l-degen",
      x: 0,
      y: 0,
      points: [[0, 0]], // single point — bbox extent = 0
      customData: polylineScreen,
    };
    const { api, updateScene } = makeApi([lineEl]);
    // eslint-disable-next-line @typescript-eslint/no-explicit-any
    const sync = new CoordinateSync({ map: map as any, excalidrawAPI: api });

    sync.syncMapToScene();

    const passed = updateScene.mock.calls[0][0].elements as ExcalidrawElementLike[];
    expect(passed[0].width).toBeGreaterThanOrEqual(1);
    expect(passed[0].height).toBeGreaterThanOrEqual(1);
  });

  it("polyline + geographic — width/height clamped to >= 1 for zero-extent projected points", () => {
    // Two coords projecting to the same pixel (degenerate / extreme zoom-out).
    // Use integer degrees so normalizeLng maps cleanly to the same value.
    const polylineGeo: GeoCustomData = {
      geo: { kind: "polyline", coordinates: [[0, 0], [1, 1]], zRef: 12 },
      scaleMode: "geographic",
      projection: "mercator",
      schemaVersion: 1,
    };
    const project = makeProjectByLngLat([
      [[0, 0], { x: 500, y: 500 }],
      [[1, 1], { x: 500, y: 500 }], // collapsed to same pixel
    ]);
    const map = makeMap(project);
    const lineEl: ExcalidrawElementLike = {
      id: "l-geo-degen",
      x: 0,
      y: 0,
      points: [],
      customData: polylineGeo,
    };
    const { api, updateScene } = makeApi([lineEl]);
    // eslint-disable-next-line @typescript-eslint/no-explicit-any
    const sync = new CoordinateSync({ map: map as any, excalidrawAPI: api });

    sync.syncMapToScene();

    const passed = updateScene.mock.calls[0][0].elements as ExcalidrawElementLike[];
    expect(passed[0].width).toBe(1);
    expect(passed[0].height).toBe(1);
  });
});
