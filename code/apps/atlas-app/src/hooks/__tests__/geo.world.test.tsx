// SPDX-License-Identifier: AGPL-3.0-only
//
// ADR-0015 spike — the KNOWN-RED cases of geo.known-red.test.tsx, ported to
// the world-coordinates path (flag on). Same real editor (store, history,
// keyboard undo), same FakeMercatorMap; what changes is what a camera `move`
// runs: the CameraBridge instead of CoordinateSync, with no useGeoAnchor and
// the change handler's scroll lock off.
//
// The pin case is not ported: PinTool still writes a v1 screen-pixel element
// with an anchor, and moving it onto the frame is production work (see the
// ADR's Outcome).

import "vitest-canvas-mock";

import React, { useState } from "react";
import { afterEach, beforeAll, describe, expect, it } from "vitest";
import {
  act,
  cleanup,
  fireEvent,
  render,
  waitFor,
} from "@testing-library/react";

import {
  CaptureUpdateAction,
  newElement,
  newElementWith,
} from "@atlasdraw/element";
import { Excalidraw } from "@atlasdraw/excalidraw";
import { CameraBridge } from "@atlasdraw/basemap";
import { frameAt, toLngLat, toScene } from "@atlasdraw/geo";

import type { ExcalidrawImperativeAPI } from "@atlasdraw/excalidraw";
import type { NormalizedZoomValue } from "@atlasdraw/excalidraw/types";
import type { WorldFrame } from "@atlasdraw/geo";

import type { ExcalidrawElement } from "@atlasdraw/element/types";

import { usePersistenceStore } from "../../state/usePersistenceStore";
import { FakeMercatorMap } from "../geoOpFuzz.harness";
import { useExcalidrawChangeHandler } from "../useExcalidrawChangeHandler";

import type maplibregl from "maplibre-gl";

beforeAll(() => {
  if (!window.matchMedia) {
    Object.defineProperty(window, "matchMedia", {
      writable: true,
      value: (query: string) => ({
        matches: false,
        media: query,
        onchange: null,
        addListener: () => {},
        removeListener: () => {},
        addEventListener: () => {},
        removeEventListener: () => {},
        dispatchEvent: () => false,
      }),
    });
  }
  if (!HTMLElement.prototype.setPointerCapture) {
    HTMLElement.prototype.setPointerCapture = () => {};
  }
  if (!("FontFace" in window)) {
    Object.defineProperty(window, "FontFace", {
      value: class {
        load() {}
      },
    });
  }
  if (!document.fonts) {
    Object.defineProperty(document, "fonts", {
      value: {
        load: () => Promise.resolve([]),
        check: () => true,
        has: () => true,
        add: () => {},
      },
    });
  }
});

afterEach(() => {
  cleanup();
});

/** FakeMercatorMap plus what the bridge needs: `move` listeners and jumpTo. */
class TestMap extends FakeMercatorMap {
  private readonly listeners = new Set<() => void>();
  jumps = 0;
  panBy(): void {}
  on(_: "move", fn: () => void): void {
    this.listeners.add(fn);
  }
  off(_: "move", fn: () => void): void {
    this.listeners.delete(fn);
  }
  jumpTo(o: { center: { lng: number; lat: number }; zoom: number }): void {
    this.jumps++;
    this.center = o.center;
    this.zoom = o.zoom;
    this.fire();
  }
  fire(): void {
    for (const fn of this.listeners) {
      fn();
    }
  }
}

interface World {
  readonly api: ExcalidrawImperativeAPI;
  readonly map: TestMap;
  readonly frame: WorldFrame;
  readonly bridge: CameraBridge;
  readonly pan: (dx: number, dy: number) => void;
  readonly el: (id: string) => ExcalidrawElement;
}

function Harness({
  map,
  bridgeRef,
  onApi,
}: {
  map: TestMap;
  bridgeRef: { current: CameraBridge | null };
  onApi: (api: ExcalidrawImperativeAPI) => void;
}) {
  const [api, setApi] = useState<ExcalidrawImperativeAPI | null>(null);
  const onChange = useExcalidrawChangeHandler({
    excalidrawAPI: api,
    map: map as unknown as maplibregl.Map,
    syncNow: undefined,
    expectedOrigin: undefined,
    announceMapEditor: () => {},
    setMapBg: () => {},
    spaceHeldRef: { current: false },
    worldCoords: true,
  });
  return (
    <div style={{ width: 1024, height: 768 }}>
      <Excalidraw
        handleKeyboardGlobally={true}
        initialData={{ appState: { viewBackgroundColor: "transparent" } }}
        onExcalidrawAPI={(a) => {
          setApi(a);
          if (a) {
            onApi(a);
          }
        }}
        onChange={onChange}
        onScrollChange={(x, y, z) => bridgeRef.current?.onScrollChange(x, y, z)}
      />
    </div>
  );
}

async function mount(zoom = 10): Promise<World> {
  const map = new TestMap(zoom, { lng: 0, lat: 0 });
  const bridgeRef: { current: CameraBridge | null } = { current: null };
  let api: ExcalidrawImperativeAPI | null = null;
  const result = render(
    <Harness map={map} bridgeRef={bridgeRef} onApi={(a) => (api = a)} />,
  );
  await waitFor(() => {
    expect(api).not.toBe(null);
    expect(result.container.querySelector("canvas.static")).not.toBe(null);
  });
  if (!api) {
    throw new Error("Excalidraw did not hand over its API");
  }
  const a = api as ExcalidrawImperativeAPI;
  const frame = frameAt(0, 0, zoom);
  const bridge = new CameraBridge({
    map,
    scene: {
      updateScene: ({ appState }) =>
        a.updateScene({
          appState: {
            ...appState,
            zoom: { value: appState.zoom.value as NormalizedZoomValue },
          },
        }),
    },
    frame,
    viewportSize: () => ({ width: map.containerW, height: map.containerH }),
  });
  bridgeRef.current = bridge;
  act(() => bridge.attach());
  return {
    api: a,
    map,
    frame,
    bridge,
    pan: (dx, dy) => {
      map.panByScreen(dx, dy);
      act(() => map.fire());
    },
    el: (id) => {
      const found = a
        .getSceneElementsIncludingDeleted()
        .find((e) => e.id === id);
      if (!found) {
        throw new Error(`no element ${id}`);
      }
      return found;
    },
  };
}

/** Where on Earth an element is: its x/y through the frame. */
function placeOf(w: World, el: ExcalidrawElement) {
  return toLngLat(w.frame, { x: el.x, y: el.y });
}

function draw(world: World, el: ExcalidrawElement): void {
  act(() =>
    world.api.updateScene({
      elements: [...world.api.getSceneElementsIncludingDeleted(), el],
      captureUpdate: CaptureUpdateAction.IMMEDIATELY,
    }),
  );
}

function drag(world: World, id: string, dx: number, dy: number): void {
  act(() =>
    world.api.updateScene({
      elements: world.api
        .getSceneElementsIncludingDeleted()
        .map((e) =>
          e.id === id ? newElementWith(e, { x: e.x + dx, y: e.y + dy }) : e,
        ),
      captureUpdate: CaptureUpdateAction.IMMEDIATELY,
    }),
  );
}

function undo(): void {
  act(() => {
    fireEvent.keyDown(document, { key: "z", code: "KeyZ", ctrlKey: true });
  });
}

function screenDistance(
  map: FakeMercatorMap,
  a: { lng: number; lat: number },
  b: { lng: number; lat: number },
): number {
  const pa = map.project([a.lng, a.lat]);
  const pb = map.project([b.lng, b.lat]);
  return Math.hypot(pa.x - pb.x, pa.y - pb.y);
}

/** A 100-px rectangle at screen (300, 300), placed in world coordinates. */
function rectangle(w: World) {
  const ll = w.map.unproject([300, 300]);
  const p = toScene(w.frame, ll.lng, ll.lat);
  const scale = Math.pow(2, w.map.zoom - w.frame.z0);
  return newElement({
    type: "rectangle",
    x: p.x,
    y: p.y,
    width: 100 / scale,
    height: 100 / scale,
  });
}

describe("world coordinates: the geo known-red cases (ADR-0015 spike)", () => {
  it("the bridge puts a scene point on the pixel the map projects it to", async () => {
    const w = await mount(10);
    w.pan(137, -42);
    const s = w.api.getAppState();
    const ll = w.map.unproject([700, 200]);
    const p = toScene(w.frame, ll.lng, ll.lat);
    expect((p.x + s.scrollX) * s.zoom.value).toBeCloseTo(700, 6);
    expect((p.y + s.scrollY) * s.zoom.value).toBeCloseTo(200, 6);
  });

  it("undo of a drag returns the shape to its pre-drag geography, even after a pan", async () => {
    const w = await mount(10);
    const rect = rectangle(w);
    draw(w, rect);
    const beforeDrag = placeOf(w, w.el(rect.id));

    drag(w, rect.id, 50, 0);
    w.pan(200, 0);
    undo();
    w.pan(0, 0);

    expect(
      screenDistance(w.map, placeOf(w, w.el(rect.id)), beforeDrag),
    ).toBeLessThan(0.5);
  });

  it("a pure pan does not mark the document dirty", async () => {
    const w = await mount(10);
    draw(w, rectangle(w));
    w.pan(0, 0);
    act(() => usePersistenceStore.getState().clearDirty());

    w.pan(200, 0);

    expect(usePersistenceStore.getState().isDirty).toBe(false);
  });

  it("a pure pan leaves every element's scene geometry and version alone", async () => {
    const w = await mount(10);
    const rect = rectangle(w);
    draw(w, rect);
    w.pan(0, 0);
    const before = w.el(rect.id);

    w.pan(200, 0);
    act(() => {
      w.map.setZoom(12.5);
      w.map.fire();
    });

    const after = w.el(rect.id);
    expect(after).toBe(before);
  });

  it("one map move is one scene write; the echo is dropped (real onScrollChange)", async () => {
    const w = await mount(10);
    w.bridge.resetStats();
    w.pan(120, 40);
    expect(w.bridge.stats).toEqual({
      mapToScene: 1,
      sceneToMap: 0,
      suppressed: 1,
    });
    expect(w.map.jumps).toBe(0);
  });

  it("an Excalidraw-originated viewport change reaches the map once and settles", async () => {
    const w = await mount(10);
    w.bridge.resetStats();
    const s = w.api.getAppState();
    const before = { ...w.map.center };
    // Excalidraw moving its own viewport, as space-drag does.
    act(() => w.api.updateScene({ appState: { scrollX: s.scrollX - 100 } }));
    expect(w.map.jumps).toBe(1);
    expect(w.bridge.stats.sceneToMap).toBe(1);
    expect(w.bridge.stats.mapToScene).toBe(1);
    expect(w.bridge.stats.suppressed).toBeLessThanOrEqual(1);
    expect(w.map.center.lng).toBeGreaterThan(before.lng);
    // And the scene agrees with the map afterwards.
    const after = w.api.getAppState();
    const ll = w.map.unproject([512, 384]);
    const p = toScene(w.frame, ll.lng, ll.lat);
    expect((p.x + after.scrollX) * after.zoom.value).toBeCloseTo(512, 6);
  });
});
