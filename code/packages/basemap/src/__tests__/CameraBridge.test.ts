// SPDX-License-Identifier: MIT
// ADR-0015 spike — the camera bridge pushes the map camera into Excalidraw's
// viewport and routes Excalidraw's own viewport changes back to the map,
// without a loop.

import { describe, expect, it } from "vitest";

import { frameAt, toScene } from "@atlasdraw/geo";

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
