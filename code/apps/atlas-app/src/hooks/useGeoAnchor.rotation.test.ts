/**
 * RT-1 + RT-2 — bbox anchors under a rotated camera.
 *
 * Runs the real `CoordinateSync` and the real geo-anchor onChange handler
 * against `FakeMercatorMap`, which now models bearing with a genuine rotation
 * matrix over real Web Mercator math. Table-driven `project` mocks can't
 * express a rotated camera; this harness can.
 *
 * What these tests are and are not evidence for: the pipeline never reads
 * `getBearing()` for geometry — it *measures* the screen direction of
 * geographic east via `cameraRotation`. So these tests prove the projection
 * and the re-anchor agree about whatever rotation the map applies, which is
 * the invariant the design rests on. They cannot prove MapLibre's bearing sign
 * convention, and by construction nothing here depends on it.
 */

import { describe, it, expect } from "vitest";

import { makeWorld, settle, type FuzzEl } from "./geoOpFuzz.harness";

const CENTER = { lng: 12.5, lat: 41.9 };
const ZOOM = 12;

/** Geo tolerance: ~1e-9° is well under the 1e-7 the re-anchor logic uses. */
const GEO_EPS = 1e-9;

interface Bbox {
  west: number;
  east: number;
  north: number;
  south: number;
}

function bboxOf(el: FuzzEl): Bbox {
  const geo = (el.customData as { geo: Bbox & { kind: string } }).geo;
  return { west: geo.west, east: geo.east, north: geo.north, south: geo.south };
}

function lastSyncOf(el: FuzzEl): Record<string, number | string> {
  return (el.customData as { _lastSync: Record<string, number | string> })
    ._lastSync;
}

function expectBboxClose(actual: Bbox, expected: Bbox) {
  expect(actual.west).toBeCloseTo(expected.west, 9);
  expect(actual.east).toBeCloseTo(expected.east, 9);
  expect(actual.north).toBeCloseTo(expected.north, 9);
  expect(actual.south).toBeCloseTo(expected.south, 9);
}

/** Create one rectangle at north-up and let the anchor stamp settle. */
function worldWithRect() {
  const w = makeWorld(ZOOM, CENTER);
  const el: FuzzEl = {
    id: "r1",
    type: "rectangle",
    x: 400,
    y: 300,
    width: 200,
    height: 120,
    angle: 0,
    strokeWidth: 2,
  };
  w.store.commitUserOp([el]);
  settle(w, 0, null);
  return w;
}

describe("bbox anchors under a rotated camera (RT-1/RT-2)", () => {
  it("north-up projection is byte-identical to before rotation existed", () => {
    const w = worldWithRect();
    const before = bboxOf(w.store.elements[0]);

    w.sync.syncMapToScene();
    const el = w.store.elements[0];

    expect(el.angle).toBe(0);
    expect(el.x).toBeCloseTo(400, 6);
    expect(el.y).toBeCloseTo(300, 6);
    expect(el.width).toBeCloseTo(200, 6);
    expect(el.height).toBeCloseTo(120, 6);
    expectBboxClose(bboxOf(el), before);
  });

  it("a camera turn writes `angle` and leaves the geographic anchor alone", () => {
    const w = worldWithRect();
    const anchored = bboxOf(w.store.elements[0]);

    w.map.setBearing(30);
    w.sync.syncMapToScene();
    const el = w.store.elements[0];

    // Measured, not assumed: east swings to −30° in y-down screen radians.
    expect(el.angle).toBeCloseTo((-30 * Math.PI) / 180, 12);
    // Conformal: the box keeps its size, it only turns.
    expect(el.width).toBeCloseTo(200, 6);
    expect(el.height).toBeCloseTo(120, 6);
    expectBboxClose(bboxOf(el), anchored);
    expect(lastSyncOf(el).a).toBe(el.angle);
    expect(lastSyncOf(el).a0).toBe(0);
  });

  it("the turned rectangle sits where the geography is", () => {
    const w = worldWithRect();
    const anchor = bboxOf(w.store.elements[0]);

    w.map.setBearing(30);
    w.sync.syncMapToScene();
    const el = w.store.elements[0];

    // The centre of the drawn box must be the projected centre of the anchor.
    const nw = w.map.project([anchor.west, anchor.north]);
    const se = w.map.project([anchor.east, anchor.south]);
    expect(el.x + el.width / 2).toBeCloseTo((nw.x + se.x) / 2, 6);
    expect(el.y + el.height / 2).toBeCloseTo((nw.y + se.y) / 2, 6);
  });

  it("returning to north restores the original placement exactly", () => {
    const w = worldWithRect();
    const before = { ...w.store.elements[0] };

    w.map.setBearing(30);
    w.sync.syncMapToScene();
    settle(w, 1, null);
    w.map.setBearing(0);
    w.sync.syncMapToScene();
    settle(w, 2, null);
    const el = w.store.elements[0];

    expect(el.angle).toBeCloseTo(0, 12);
    expect(el.x).toBeCloseTo(before.x, 6);
    expect(el.y).toBeCloseTo(before.y, 6);
    expect(el.width).toBeCloseTo(before.width, 6);
    expect(el.height).toBeCloseTo(before.height, 6);
    expectBboxClose(bboxOf(el), bboxOf(before));
  });

  it("a camera turn is not mistaken for a user rotation", () => {
    // The RT-1 failure mode: without `_lastSync.a`, the onChange pass that
    // follows a camera turn sees a changed angle, reads it as the user's, and
    // bakes the camera into `a0` — so every turn compounds.
    const w = worldWithRect();
    const anchor = bboxOf(w.store.elements[0]);

    for (const bearing of [15, 40, 95, 200, 0]) {
      w.map.setBearing(bearing);
      w.sync.syncMapToScene();
      settle(w, bearing, null);
      const el = w.store.elements[0];
      expect(lastSyncOf(el).a0).toBeCloseTo(0, 12);
      expectBboxClose(bboxOf(el), anchor);
    }
    expect(w.store.elements[0].angle).toBeCloseTo(0, 12);
  });

  it("a user rotation survives a camera turn and rides on top of it", () => {
    const w = worldWithRect();
    const userAngle = 0.4;
    // One north-up sync first, so the element is on the `_lastSync` protocol
    // rather than the pre-protocol fallback path.
    w.sync.syncMapToScene();
    settle(w, 0, null);

    // User rotates the element: Excalidraw turns it about its centre and
    // leaves x/y/width/height alone.
    const el0 = w.store.elements[0];
    w.store.commitUserOp([{ ...el0, angle: userAngle }]);
    settle(w, 1, null);
    expect(lastSyncOf(w.store.elements[0]).a0).toBeCloseTo(userAngle, 12);

    w.map.setBearing(90);
    w.sync.syncMapToScene();
    settle(w, 2, null);
    const el = w.store.elements[0];

    expect(el.angle).toBeCloseTo(userAngle - Math.PI / 2, 12);
    expect(lastSyncOf(el).a0).toBeCloseTo(userAngle, 12);

    w.map.setBearing(0);
    w.sync.syncMapToScene();
    settle(w, 3, null);
    expect(w.store.elements[0].angle).toBeCloseTo(userAngle, 12);
  });

  it("dragging the element while rotated re-anchors to where it was dropped", () => {
    const w = worldWithRect();
    w.map.setBearing(55);
    w.sync.syncMapToScene();
    settle(w, 1, null);

    const before = w.store.elements[0];
    const moved: FuzzEl = { ...before, x: before.x + 60, y: before.y - 25 };
    w.store.commitUserOp([moved]);
    settle(w, 2, null);

    // The anchor must now describe the element's new position: re-projecting
    // it has to reproduce the screen box the user let go of.
    const after = w.store.elements[0];
    expect(after.x).toBeCloseTo(moved.x, 6);
    expect(after.y).toBeCloseTo(moved.y, 6);
    expect(after.width).toBeCloseTo(before.width, 6);
    expect(after.height).toBeCloseTo(before.height, 6);
    expect(after.angle).toBeCloseTo(before.angle ?? 0, 9);
    // And it must be a real move — the anchor changed.
    expect(Math.abs(bboxOf(after).west - bboxOf(before).west)).toBeGreaterThan(
      GEO_EPS,
    );

    // The re-anchor has to leave the element on the protocol, not just in the
    // right place: `a0` must still be the user's rotation (zero here), or the
    // next sync adopts the camera's rotation as the user's and the element
    // stays crooked when the map comes back to north.
    expect(lastSyncOf(after).a0).toBeCloseTo(0, 12);
    const dropped = bboxOf(after);
    w.sync.syncMapToScene();
    settle(w, 3, null);
    expect(w.store.elements[0].x).toBeCloseTo(moved.x, 6);
    expect(w.store.elements[0].y).toBeCloseTo(moved.y, 6);
    expectBboxClose(bboxOf(w.store.elements[0]), dropped);

    w.map.setBearing(0);
    w.sync.syncMapToScene();
    settle(w, 4, null);
    expect(w.store.elements[0].angle).toBeCloseTo(0, 12);
    expectBboxClose(bboxOf(w.store.elements[0]), dropped);
  });

  it("resizing while rotated re-anchors without drifting the untouched corner", () => {
    const w = worldWithRect();
    w.map.setBearing(-70);
    w.sync.syncMapToScene();
    settle(w, 1, null);

    const before = w.store.elements[0];
    const resized: FuzzEl = {
      ...before,
      width: before.width * 1.5,
      height: before.height * 0.8,
    };
    w.store.commitUserOp([resized]);
    settle(w, 2, null);

    const after = w.store.elements[0];
    expect(after.width).toBeCloseTo(resized.width, 6);
    expect(after.height).toBeCloseTo(resized.height, 6);
    expect(after.x).toBeCloseTo(resized.x, 6);
    expect(after.y).toBeCloseTo(resized.y, 6);
  });

  it("a rotated camera does not disturb polyline or point anchors", () => {
    // These project vertex-wise and were already correct at any bearing —
    // the guard is that RT-2 did not reach into them.
    const w = makeWorld(ZOOM, CENTER);
    const line: FuzzEl = {
      id: "l1",
      type: "freedraw",
      x: 300,
      y: 300,
      width: 100,
      height: 80,
      strokeWidth: 2,
      points: [
        [0, 0],
        [40, 56],
        [100, 80],
      ],
    };
    const text: FuzzEl = {
      id: "t1",
      type: "text",
      x: 500,
      y: 200,
      width: 60,
      height: 20,
      fontSize: 20,
      strokeWidth: 1,
    };
    w.store.commitUserOp([line, text]);
    settle(w, 0, null);
    const anchors = w.store.elements.map((e) => structuredClone(e.customData));

    w.map.setBearing(120);
    w.sync.syncMapToScene();
    settle(w, 1, null);

    for (const [i, el] of w.store.elements.entries()) {
      expect(el.angle).toBeUndefined();
      expect((el.customData as { geo: unknown }).geo).toEqual(
        (anchors[i] as { geo: unknown }).geo,
      );
    }
  });
});
