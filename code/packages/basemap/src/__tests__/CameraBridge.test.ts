// SPDX-License-Identifier: MIT
// The camera bridge pushes the map camera into Excalidraw's
// viewport and routes Excalidraw's own viewport changes back to the map,
// without a loop.

import fc from "fast-check";
import { describe, expect, it } from "vitest";

import { WORLD_TILE_SIZE, frameAt, toScene } from "@atlasdraw/geo";

import { CameraBridge } from "../CameraBridge";

import type { BridgeMap, BridgeScene } from "../CameraBridge";

type Listener = () => void;

/** A map whose jumpTo fires `move` synchronously, as MapLibre's does. */
class FakeMap implements BridgeMap {
  center = { lng: 13.4, lat: 52.5 };
  zoom = 12;
  bearing = 0;
  jumps = 0;
  private listeners = new Set<Listener>();
  getCenter() {
    return this.center;
  }
  getZoom() {
    return this.zoom;
  }
  getBearing() {
    return this.bearing;
  }
  jumpTo(o: { center: { lng: number; lat: number }; zoom: number }) {
    this.jumps++;
    this.center = o.center;
    this.zoom = o.zoom;
    this.fire();
  }
  on(_: "move", fn: Listener) {
    this.listeners.add(fn);
  }
  off(_: "move", fn: Listener) {
    this.listeners.delete(fn);
  }
  fire() {
    for (const fn of this.listeners) {
      fn();
    }
  }
}

/** A scene that reports viewport changes the way componentDidUpdate does:
 * after the state lands, only when a value changed. */
class FakeScene implements BridgeScene {
  state = {
    scrollX: 0,
    scrollY: 0,
    zoom: { value: 1 },
    width: 1000,
    height: 800,
  };
  onScroll: ((x: number, y: number, z: { value: number }) => void) | null =
    null;
  writes = 0;
  getAppState() {
    return this.state;
  }
  updateScene({
    appState,
  }: {
    appState: { scrollX: number; scrollY: number; zoom: { value: number } };
  }) {
    this.writes++;
    this.setViewport(appState.scrollX, appState.scrollY, appState.zoom.value);
  }
  /** Excalidraw changing its own viewport (space-drag, zoom action). */
  setViewport(scrollX: number, scrollY: number, zoom: number) {
    const changed =
      scrollX !== this.state.scrollX ||
      scrollY !== this.state.scrollY ||
      zoom !== this.state.zoom.value;
    this.state = { ...this.state, scrollX, scrollY, zoom: { value: zoom } };
    if (changed) {
      this.onScroll?.(scrollX, scrollY, { value: zoom });
    }
  }
}

function setup() {
  const map = new FakeMap();
  const scene = new FakeScene();
  const frame = frameAt(13.4, 52.5, 12);
  const bridge = new CameraBridge({
    map,
    scene,
    frame,
    viewportSize: () => ({
      width: scene.state.width,
      height: scene.state.height,
    }),
  });
  scene.onScroll = (x, y, z) => bridge.onScrollChange(x, y, z);
  bridge.attach();
  return { map, scene, frame, bridge };
}

describe("CameraBridge", () => {
  it("attach pushes the camera: the map centre lands at the layer centre", () => {
    const { scene, frame, map } = setup();
    const c = toScene(frame, map.center.lng, map.center.lat);
    const { scrollX, scrollY, zoom, width, height } = scene.state;
    expect((c.x + scrollX) * zoom.value).toBeCloseTo(width / 2, 9);
    expect((c.y + scrollY) * zoom.value).toBeCloseTo(height / 2, 9);
    expect(zoom.value).toBe(1);
  });

  it("one map move is one scene write and no map write", () => {
    const { map, scene, bridge } = setup();
    bridge.resetStats();
    map.center = { lng: 13.41, lat: 52.49 };
    map.zoom = 13.5;
    map.fire();
    expect(bridge.stats).toEqual({
      mapToScene: 1,
      sceneToMap: 0,
      suppressed: 1,
    });
    expect(map.jumps).toBe(0);
    expect(scene.state.zoom.value).toBeCloseTo(Math.pow(2, 1.5), 12);
  });

  it("an Excalidraw pan reaches the map once and settles", () => {
    const { map, scene, bridge } = setup();
    bridge.resetStats();
    const before = { ...map.center };
    scene.setViewport(scene.state.scrollX - 100, scene.state.scrollY, 1);
    expect(map.jumps).toBe(1);
    // The map's answer is written back once. If the round trip is exact the
    // scene sees no change; if not, the change is the bridge's own echo.
    expect(bridge.stats.sceneToMap).toBe(1);
    expect(bridge.stats.mapToScene).toBe(1);
    expect(bridge.stats.suppressed).toBeLessThanOrEqual(1);
    // Dragging the content left by 100 px moves the camera east.
    expect(map.center.lng).toBeGreaterThan(before.lng);
  });

  it("an echo that Excalidraw normalised is still the echo", () => {
    // Some Excalidraw paths store the zoom through getNormalizedZoom
    // (scene/normalize.ts): clamped to [0.1, 30] and rounded to 6 decimals.
    // This test's frame is at zoom 12, so at map zoom 12.3 the zoom value is
    // 2^0.3, and the rounding changes it by about 3e-7 of itself. That is
    // the bridge's own write, not a move.
    const { map, scene, bridge } = setup();
    const normalize = (z: number) =>
      Math.min(30, Math.max(0.1, Math.round(z * 1e6) / 1e6));
    scene.updateScene = ({ appState }) => {
      scene.writes++;
      scene.setViewport(
        appState.scrollX,
        appState.scrollY,
        normalize(appState.zoom.value),
      );
    };
    bridge.resetStats();
    map.zoom = 12.3;
    map.fire();
    expect(scene.state.zoom.value).toBe(1.231144);
    expect(map.jumps).toBe(0);
    expect(map.zoom).toBe(12.3);
    expect(bridge.stats).toEqual({
      mapToScene: 1,
      sceneToMap: 0,
      suppressed: 1,
    });
  });

  it("a scroll a ten-thousandth of a pixel off is still the echo", () => {
    const { map, scene, bridge } = setup();
    scene.updateScene = ({ appState }) => {
      scene.writes++;
      const z = appState.zoom.value;
      scene.setViewport(
        appState.scrollX + 1e-4 / z,
        appState.scrollY - 1e-4 / z,
        z,
      );
    };
    bridge.resetStats();
    map.center = { lng: 13.41, lat: 52.49 };
    map.fire();
    expect(map.jumps).toBe(0);
    expect(bridge.stats.suppressed).toBe(1);
  });

  it("a move of one pixel is Excalidraw's own and reaches the map", () => {
    const { map, scene, bridge } = setup();
    bridge.resetStats();
    const z = scene.state.zoom.value;
    scene.setViewport(scene.state.scrollX + 1 / z, scene.state.scrollY, z);
    expect(map.jumps).toBe(1);
    expect(bridge.stats.sceneToMap).toBe(1);
  });

  it("a moving map with a stuck scene never loops", () => {
    const { map, bridge } = setup();
    bridge.resetStats();
    for (let i = 0; i < 100; i++) {
      map.center = { lng: 13.4 + i * 1e-3, lat: 52.5 };
      map.fire();
    }
    expect(bridge.stats.mapToScene).toBe(100);
    expect(bridge.stats.sceneToMap).toBe(0);
  });

  it("detach stops both directions", () => {
    const { map, scene, bridge } = setup();
    bridge.detach();
    bridge.resetStats();
    map.fire();
    scene.setViewport(5, 5, 2);
    expect(bridge.stats).toEqual({
      mapToScene: 0,
      sceneToMap: 0,
      suppressed: 0,
    });
    expect(map.jumps).toBe(0);
  });
});

/** Where MapLibre puts lng/lat on screen at pitch 0, bearing 0. */
function mapPixel(
  map: FakeMap,
  size: { width: number; height: number },
  lng: number,
  lat: number,
) {
  const s = WORLD_TILE_SIZE * Math.pow(2, map.zoom);
  const wx = (l: number) => ((l + 180) / 360) * s;
  const wy = (a: number) => {
    const r = (a * Math.PI) / 180;
    return (0.5 - Math.log(Math.tan(Math.PI / 4 + r / 2)) / (2 * Math.PI)) * s;
  };
  return {
    x: wx(lng) - wx(map.center.lng) + size.width / 2,
    y: wy(lat) - wy(map.center.lat) + size.height / 2,
  };
}

const lng = fc.double({ min: -170, max: 170, noNaN: true });
const lat = fc.double({ min: -75, max: 75, noNaN: true });
const zoom = fc.double({ min: 1, max: 22, noNaN: true });

/** One input: the user moves the map, or Excalidraw moves its viewport. */
const input = fc.oneof(
  fc.record({ kind: fc.constant("map" as const), lng, lat, zoom }),
  fc.record({
    kind: fc.constant("scene" as const),
    dx: fc.double({ min: -500, max: 500, noNaN: true }),
    dy: fc.double({ min: -500, max: 500, noNaN: true }),
    factor: fc.double({ min: 0.5, max: 2, noNaN: true }),
  }),
);

describe("CameraBridge (properties)", () => {
  it("after any input sequence, every point draws where the map draws it", () => {
    fc.assert(
      fc.property(
        fc.integer({ min: 0, max: 22 }),
        fc.array(input, { minLength: 1, maxLength: 20 }),
        lng,
        lat,
        (z0, inputs, pLng, pLat) => {
          const map = new FakeMap();
          const scene = new FakeScene();
          const frame = frameAt(map.center.lng, map.center.lat, z0);
          const bridge = new CameraBridge({
            map,
            scene,
            frame,
            viewportSize: () => ({
              width: scene.state.width,
              height: scene.state.height,
            }),
          });
          scene.onScroll = (x, y, zv) => bridge.onScrollChange(x, y, zv);
          bridge.attach();
          for (const step of inputs) {
            bridge.resetStats();
            if (step.kind === "map") {
              map.center = { lng: step.lng, lat: step.lat };
              map.zoom = step.zoom;
              map.fire();
              // One exchange per input: one write in, none back.
              expect(bridge.stats.mapToScene).toBe(1);
              expect(bridge.stats.sceneToMap).toBe(0);
            } else {
              const v = scene.state;
              // MapLibre keeps the camera on the world (zoom >= ~1, latitude
              // inside the Mercator square); the fake map does not, so steps
              // that would leave it are not inputs a real map can see.
              const nextZoom = z0 + Math.log2(v.zoom.value * step.factor);
              if (nextZoom < 2 || nextZoom > 22) {
                continue;
              }
              // A change inside the echo band (ECHO_ZOOM, ECHO_PIXELS) is
              // float noise, and the bridge ignores it on purpose. No gesture
              // makes one: a factor of 0.99999 once failed here by 0.005 px.
              const movedPixels =
                Math.max(Math.abs(step.dx), Math.abs(step.dy)) * v.zoom.value;
              if (Math.abs(step.factor - 1) <= 1e-4 && movedPixels <= 1e-2) {
                continue;
              }
              scene.setViewport(
                v.scrollX + step.dx,
                v.scrollY + step.dy,
                v.zoom.value * step.factor,
              );
              expect(bridge.stats.sceneToMap).toBeLessThanOrEqual(1);
              expect(bridge.stats.mapToScene).toBeLessThanOrEqual(1);
            }
          }
          fc.pre(Math.abs(map.center.lat) < 75);
          // Only points near the camera: what can be on screen.
          const near = {
            lng: map.center.lng + (pLng / 170) * 1e-3,
            lat: Math.max(
              -80,
              Math.min(80, map.center.lat + (pLat / 75) * 1e-3),
            ),
          };
          const p = toScene(frame, near.lng, near.lat);
          const { scrollX, scrollY, zoom: z } = scene.state;
          const want = mapPixel(map, scene.state, near.lng, near.lat);
          expect(Math.abs((p.x + scrollX) * z.value - want.x)).toBeLessThan(
            1e-6,
          );
          expect(Math.abs((p.y + scrollY) * z.value - want.y)).toBeLessThan(
            1e-6,
          );
        },
      ),
      { numRuns: 300 },
    );
  });

  it("reads the frame on every exchange, so a new document's frame applies at once", () => {
    const map = new FakeMap();
    const scene = new FakeScene();
    let frame = frameAt(13.4, 52.5, 22);
    const bridge = new CameraBridge({
      map,
      scene,
      frame: () => frame,
      viewportSize: () => ({
        width: scene.state.width,
        height: scene.state.height,
      }),
    });
    bridge.attach();
    frame = frameAt(77.2, 28.6, 22);
    expect(bridge.frame).toBe(frame);
    bridge.push();
    const c = toScene(frame, map.center.lng, map.center.lat);
    const { scrollX, zoom: z, width } = scene.state;
    expect((c.x + scrollX) * z.value).toBeCloseTo(width / 2, 6);
  });
});
