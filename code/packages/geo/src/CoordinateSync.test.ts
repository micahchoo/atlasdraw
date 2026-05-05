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
    // Invariant: customData.geo not mutated — same ref, same shape.
    expect(passed[0].customData).toBe(pointCustomData);
    expect((passed[0].customData as GeoCustomData).geo).toEqual(pointCustomData.geo);
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
    // Invariant: customData not mutated.
    expect(passed[0].customData).toBe(bboxCustomData);
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
