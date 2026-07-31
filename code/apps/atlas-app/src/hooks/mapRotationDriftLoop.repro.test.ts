// SPDX-License-Identifier: AGPL-3.0-only
//
// Regression for the crash that shipped with the rotation wave: turning the
// map with a rectangle on it destroyed the user's drawing.
//
// The app has two onChange consumers and this bug lived in the seam between
// them. `buildGeoAnchorHandler` stamps and re-anchors; `useExcalidrawChangeHandler`
// section 3 decides whether the scene has drifted from the camera and calls
// `syncNow()` if so. `geoOpFuzz.harness`'s `settle()` only ever ran the first
// one — so its CONVERGE invariant could not see a loop that needs the second.
// That is why 2878 green tests missed a 100%-reproducible crash on the
// feature's primary path.
//
// So this file wires the REAL drift check to the REAL CoordinateSync over the
// harness's real Mercator map, and counts rounds to convergence the way the
// browser does: check -> syncNow -> onChange -> check. Under the bug the count
// does not converge; in the browser it hit React's nested-update ceiling, the
// ErrorBoundary tore down the tree, and the scene came back empty.
//
// The mechanism, for whoever breaks this next: termination requires the check
// and the sync to agree on where an element belongs. They were two different
// formulas — the check projected a bbox's NW corner, RT-2 made a turned bbox
// the *centred* rotated rect. Both correct, not the same point. The fix makes
// the check ask the projector (`CoordinateSync.expectedOrigin`), so the pair
// cannot diverge again, plus a re-entrancy guard so that if it somehow does,
// it costs one wasted sync instead of the user's work.

import { describe, expect, it, vi } from "vitest";
import { renderHook } from "@testing-library/react";

import type { ExcalidrawImperativeAPI } from "@atlasdraw/excalidraw";
import type { OrderedExcalidrawElement } from "@atlasdraw/element/types";
import type { AppState, BinaryFiles } from "@atlasdraw/excalidraw/types";

import {
  FakeMercatorMap,
  makeWorld,
  settle,
  type FuzzEl,
} from "./geoOpFuzz.harness";

import { useExcalidrawChangeHandler } from "./useExcalidrawChangeHandler";

import type maplibregl from "maplibre-gl";

const NO_FILES = {} as BinaryFiles;

/** Identity scroll/zoom, transparent bg — the state section 3 is reached in. */
const APP_STATE = {
  viewBackgroundColor: "transparent",
  scrollX: 0,
  scrollY: 0,
  zoom: { value: 1 },
  selectedElementIds: {},
} as unknown as AppState;

/** Rounds above which we call it a runaway rather than wait for React to. */
const RUNAWAY = 12;

interface Shape {
  readonly name: string;
  readonly anchor: "bbox" | "polyline";
  readonly el: FuzzEl;
}

/**
 * One element per case, deliberately.
 *
 * Section 3 `break`s after the first geo element, so the crash is a property
 * of whichever element is *first*, not of the scene containing a bbox. A
 * fixture mixing a line and a rectangle would pass even with the bug present —
 * the polyline converges, the loop breaks, the rectangle is never inspected.
 * Keep these single. The ordering case at the bottom of this file is the one
 * place that mixes them, and it asserts the order it depends on.
 */
const SHAPES: readonly Shape[] = [
  {
    name: "rectangle",
    anchor: "bbox",
    el: {
      id: "r1",
      type: "rectangle",
      x: 400,
      y: 300,
      width: 200,
      height: 120,
      angle: 0,
      strokeWidth: 2,
    },
  },
  {
    name: "ellipse",
    anchor: "bbox",
    el: {
      id: "e1",
      type: "ellipse",
      x: 400,
      y: 300,
      width: 200,
      height: 120,
      angle: 0,
      strokeWidth: 2,
    },
  },
  {
    name: "line",
    anchor: "polyline",
    el: {
      id: "l1",
      type: "line",
      x: 400,
      y: 300,
      width: 200,
      height: 120,
      angle: 0,
      strokeWidth: 2,
      points: [
        [0, 0],
        [200, 120],
      ],
    },
  },
  {
    name: "arrow",
    anchor: "polyline",
    el: {
      id: "a1",
      type: "arrow",
      x: 400,
      y: 300,
      width: 200,
      height: 120,
      angle: 0,
      strokeWidth: 2,
      points: [
        [0, 0],
        [200, 120],
      ],
    },
  },
];

/**
 * The app loop, closed. Returns how many corrective syncs the drift check
 * asked for.
 *
 * Each round is one browser onChange: run the change handler, and if it called
 * `syncNow` run the sync it asked for — which in the app is what emits the next
 * onChange.
 *
 * **Callers assert 0, not "eventually stops".** The first draft of this file
 * asserted `<= 1` and stayed green with the bug reinstated, because
 * `driftSyncQueuedRef` bounds the cascade whether or not the reference is
 * right — the containment was masking the correctness. Zero is the property
 * the header comment on section 3 actually claims: after a sync the element
 * *is* where the check expects it, so the follow-up onChange asks for nothing.
 * A reference the sync cannot satisfy asks for one, and fails here.
 */
function correctiveSyncs(world: ReturnType<typeof makeWorld>): number {
  const syncNow = vi.fn(() => {
    world.sync.syncMapToScene();
  });
  const { result } = renderHook(() =>
    useExcalidrawChangeHandler({
      excalidrawAPI: world.store.api as unknown as ExcalidrawImperativeAPI,
      map: world.map as unknown as maplibregl.Map,
      syncNow,
      expectedOrigin: (el) => world.sync.expectedOrigin(el),
      announceMapEditor: vi.fn(),
      setMapBg: vi.fn(),
      spaceHeldRef: { current: false },
    }),
  );

  let syncs = 0;
  for (let round = 0; round < RUNAWAY; round++) {
    const before = syncNow.mock.calls.length;
    result.current(
      world.store.elements as unknown as readonly OrderedExcalidrawElement[],
      APP_STATE,
      NO_FILES,
    );
    const asked = syncNow.mock.calls.length - before;
    if (asked === 0) {
      return syncs;
    }
    syncs += asked;
  }
  return Number.POSITIVE_INFINITY;
}

/** A world with `shape` drawn and anchored, camera still north-up. */
function drawn(el: FuzzEl): ReturnType<typeof makeWorld> {
  const world = makeWorld(12, { lng: 12.5, lat: 41.9 });
  world.store.commitUserOp([structuredClone(el)]);
  settle(world, 0, null);
  return world;
}

describe("map rotation — post-load drift check must not chase its own tail", () => {
  it.each(SHAPES)(
    "$name ($anchor) converges after the camera turns",
    ({ el, anchor }) => {
      const world = drawn(el);
      expect(world.store.elements[0]?.customData).toMatchObject({
        geo: { kind: anchor },
      });

      world.map.setBearing(-45);
      world.sync.syncMapToScene();

      // The element is now exactly where the camera puts it, so a correct
      // check asks for nothing. Under the bug the bbox cases ask forever and
      // the polyline cases never do — which is precisely why the browser
      // matrix split on anchor kind rather than on shape.
      expect(correctiveSyncs(world)).toBe(0);
    },
  );

  it("still calls syncNow once when the scene really is stale (post-load)", () => {
    // The check exists to catch a file loaded at canonical zoom-0 coordinates
    // with no camera event to move it. Guarding against a runaway must not
    // cost the one sync that was the point.
    const world = drawn(SHAPES[0]!.el);
    world.map.setBearing(-45);
    // Displace the element without syncing: this is the post-load state.
    world.store.elements = [{ ...world.store.elements[0]!, x: 0, y: 0 }];

    const syncNow = vi.fn(() => world.sync.syncMapToScene());
    const { result } = renderHook(() =>
      useExcalidrawChangeHandler({
        excalidrawAPI: world.store.api as unknown as ExcalidrawImperativeAPI,
        map: world.map as unknown as maplibregl.Map,
        syncNow,
        expectedOrigin: (el) => world.sync.expectedOrigin(el),
        announceMapEditor: vi.fn(),
        setMapBg: vi.fn(),
        spaceHeldRef: { current: false },
      }),
    );
    result.current(
      world.store.elements as unknown as readonly OrderedExcalidrawElement[],
      APP_STATE,
      NO_FILES,
    );

    expect(syncNow).toHaveBeenCalledTimes(1);
  });

  it("bounds the damage even if the reference is unsatisfiable", () => {
    // Containment, tested independently of the reference being right. A
    // deliberately impossible `expectedOrigin` is the shape the bug had: a
    // position the sync will never write. The guard turns an unbounded
    // cascade into one wasted sync, so the next such divergence is a visual
    // glitch and not a destroyed drawing.
    const world = drawn(SHAPES[0]!.el);
    world.map.setBearing(-45);
    world.sync.syncMapToScene();

    const syncNow = vi.fn(() => world.sync.syncMapToScene());
    const { result } = renderHook(() =>
      useExcalidrawChangeHandler({
        excalidrawAPI: world.store.api as unknown as ExcalidrawImperativeAPI,
        map: world.map as unknown as maplibregl.Map,
        syncNow,
        expectedOrigin: () => ({ x: -99999, y: -99999 }),
        announceMapEditor: vi.fn(),
        setMapBg: vi.fn(),
        spaceHeldRef: { current: false },
      }),
    );
    for (let i = 0; i < RUNAWAY; i++) {
      result.current(
        world.store.elements as unknown as readonly OrderedExcalidrawElement[],
        APP_STATE,
        NO_FILES,
      );
    }

    expect(syncNow).toHaveBeenCalledTimes(1);
  });

  it("a polyline ahead of a bbox hides the bbox from the check (documents the break)", () => {
    // Not a desirable property — a consequence of `break` at section 3. It is
    // recorded here because it is load-bearing for every other fixture in this
    // file: it is the reason each of them holds exactly one element. If the
    // `break` is ever removed, this test is the one that should fail and tell
    // you the single-element fixtures above stopped being sufficient.
    const world = makeWorld(12, { lng: 12.5, lat: 41.9 });
    world.store.commitUserOp([
      structuredClone(SHAPES[2]!.el),
      structuredClone(SHAPES[0]!.el),
    ]);
    settle(world, 0, null);
    expect(
      world.store.elements.map(
        (el) => (el.customData?.geo as { kind: string })?.kind,
      ),
    ).toEqual(["polyline", "bbox"]);

    world.map.setBearing(-45);
    world.sync.syncMapToScene();

    const seen: string[] = [];
    renderHook(() =>
      useExcalidrawChangeHandler({
        excalidrawAPI: world.store.api as unknown as ExcalidrawImperativeAPI,
        map: world.map as unknown as maplibregl.Map,
        syncNow: vi.fn(),
        expectedOrigin: (el) => {
          seen.push((el as unknown as FuzzEl).id);
          return world.sync.expectedOrigin(el);
        },
        announceMapEditor: vi.fn(),
        setMapBg: vi.fn(),
        spaceHeldRef: { current: false },
      }),
    ).result.current(
      world.store.elements as unknown as readonly OrderedExcalidrawElement[],
      APP_STATE,
      NO_FILES,
    );

    expect(seen).toEqual(["l1"]);
  });
});

describe("CoordinateSync.expectedOrigin agrees with what syncMapToScene writes", () => {
  // The invariant the fix rests on, stated where it can be checked directly.
  // A future edit to the bbox arm that forgets this pair is what caused the
  // crash; this fails on that edit without needing a rotation to be involved.
  it.each(SHAPES)("$name ($anchor), north-up and turned", ({ el }) => {
    for (const bearing of [0, -45, -137, 90]) {
      const world = drawn(el);
      world.map.setBearing(bearing);

      const predicted = world.sync.expectedOrigin(
        world.store.elements[0] as never,
      );
      world.sync.syncMapToScene();
      const written = world.store.elements[0]!;

      expect(predicted).not.toBeNull();
      expect(predicted!.x).toBeCloseTo(written.x, 6);
      expect(predicted!.y).toBeCloseTo(written.y, 6);
    }
  });

  it("returns null for an element this sync does not own", () => {
    const world = makeWorld(12, { lng: 12.5, lat: 41.9 });
    expect(
      world.sync.expectedOrigin({
        id: "plain",
        type: "rectangle",
        x: 1,
        y: 2,
        width: 3,
        height: 4,
      } as never),
    ).toBeNull();
  });
});

describe("FakeMercatorMap's bearing convention matches real MapLibre", () => {
  // The harness documented its convention as a reading of MapLibre's docs, so
  // every rotation test built on it was blind to being consistently backwards.
  // Settled 2026-07-31 by driving the real app in Chromium and measuring the
  // screen angle of a due-east vector off the live projection:
  //
  //   case                  bearing   east°   elAngle°  maxCornerErr(px)
  //   north-up                    0       0          0                 0
  //   after 1x Shift+Right      -45      45         45                 0
  //   after 2x Shift+Right      -90      90         90                 0
  //   after 3x Shift+Right     -135     135        135                 0
  //
  // i.e. real MapLibre puts geographic east at screen angle −bearing, y-down.
  // This pins the fake to that measurement, so a future edit to either the
  // fake or `setCameraRotation` cannot quietly drift from the real thing.
  it.each([0, 30, -45, 137])("east projects to −bearing at %i°", (bearing) => {
    const map = new FakeMercatorMap(12, { lng: 12.5, lat: 41.9 });
    map.setBearing(bearing);
    const a = map.project([12.48, 41.9]);
    const b = map.project([12.52, 41.9]);
    const eastDeg = (Math.atan2(b.y - a.y, b.x - a.x) * 180) / Math.PI;
    expect(eastDeg).toBeCloseTo(-bearing, 6);
  });
});
