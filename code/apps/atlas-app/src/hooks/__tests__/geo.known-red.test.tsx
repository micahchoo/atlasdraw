// SPDX-License-Identifier: AGPL-3.0-only
//
// Geo hazards: undo after a pan, a pin's anchor, a pan that rewrites the
// drawing. Each is a defect of a screen-pixel design, where the camera
// rewrites every element; world coordinates
// (docs/architecture/adr/0015-world-coordinates-gate.md) prevent them by
// construction, and these cases keep it so.
//
// What runs here is real: the vendored Excalidraw editor (its store, its
// history, its keyboard undo), the real `useCameraBridge` and
// `useExcalidrawChangeHandler` hooks and the pin tool's real context, wired
// as MapEditor wires them. Only the map is a stand-in — `FakeMercatorMap`,
// which does real Web Mercator project/unproject.

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
import { shapeCenter, toLngLat } from "@atlasdraw/geo";
import { PinTool } from "@atlasdraw/tools";

import type { ExcalidrawImperativeAPI } from "@atlasdraw/excalidraw";

import type { ExcalidrawElement } from "@atlasdraw/element/types";

import { createPersistenceState } from "../../state/persistenceState";
import {
  createDocument,
  currentDocument,
  openDocument,
} from "../../state/document";
import { buildToolContext } from "../useAtlasdrawTool";
import { useCameraBridge } from "../useCameraBridge";
import { useExcalidrawChangeHandler } from "../useExcalidrawChangeHandler";
import { createViewStore } from "../../session/view";

import { FakeMercatorMap } from "./fakeMercatorMap";

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

/** A map whose camera the test moves by hand, with the events and the
 * container the camera bridge and the tool context read. */
class TestMap extends FakeMercatorMap {
  private readonly container = (() => {
    const div = document.createElement("div");
    Object.defineProperty(div, "clientWidth", { value: this.containerW });
    Object.defineProperty(div, "clientHeight", { value: this.containerH });
    return div;
  })();
  private readonly listeners = new Map<string, Set<() => void>>();
  /** For the tool context's client→container offset; at the page origin. */
  getContainer(): HTMLElement {
    return this.container;
  }
  on(type: string, fn: () => void): void {
    const set = this.listeners.get(type) ?? new Set();
    set.add(fn);
    this.listeners.set(type, set);
  }
  off(type: string, fn: () => void): void {
    this.listeners.get(type)?.delete(fn);
  }
  jumpTo(o: { center: { lng: number; lat: number }; zoom: number }): void {
    this.center = o.center;
    this.zoom = o.zoom;
    this.fire("move");
  }
  fire(type: string): void {
    for (const fn of Array.from(this.listeners.get(type) ?? [])) {
      fn();
    }
  }
}

interface World {
  readonly api: ExcalidrawImperativeAPI;
  readonly map: TestMap;
  /** Move the camera, then fire what MapLibre fires: `move`. */
  readonly pan: (dx: number, dy: number) => void;
  readonly zoomTo: (z: number) => void;
  readonly el: (id: string) => ExcalidrawElement;
}

/** The editor's autosave state; a new one for every mount. */
let persistence = createPersistenceState();

function Harness({
  map,
  onApi,
}: {
  map: TestMap;
  onApi: (api: ExcalidrawImperativeAPI) => void;
}) {
  const [api, setApi] = useState<ExcalidrawImperativeAPI | null>(null);
  const [layer, setLayer] = useState<HTMLDivElement | null>(null);
  const asMap = map as unknown as maplibregl.Map;
  const { bridge, onZoomAction } = useCameraBridge(asMap, api, layer);
  const [view] = useState(() => createViewStore());
  const onChange = useExcalidrawChangeHandler({
    excalidrawAPI: api,
    announceMapEditor: () => {},
    setMapBg: () => {},
    view,
    persistence,
  });
  return (
    <div ref={setLayer} style={{ width: 1024, height: 768 }}>
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
        onScrollChange={bridge?.onScrollChange}
        onZoomAction={onZoomAction}
        screenSizedStyles
      />
    </div>
  );
}

async function mount(zoom = 10): Promise<World> {
  persistence = createPersistenceState();
  openDocument(
    createDocument({ camera: { center: [0, 0], zoom, bearing: 0, pitch: 0 } }),
  );
  const map = new TestMap(zoom, { lng: 0, lat: 0 });
  let api: ExcalidrawImperativeAPI | null = null;
  const result = render(<Harness map={map} onApi={(a) => (api = a)} />);
  await waitFor(() => {
    expect(api).not.toBe(null);
    expect(result.container.querySelector("canvas.static")).not.toBe(null);
  });
  if (!api) {
    throw new Error("Excalidraw did not hand over its API");
  }
  const a = api as ExcalidrawImperativeAPI;
  // The bridge attaches in an effect once the API is in; wait for its first
  // push, which moves the viewport off Excalidraw's default.
  await waitFor(() => expect(a.getAppState().zoom.value).not.toBe(1));
  return {
    api: a,
    map,
    pan: (dx, dy) => {
      map.panByScreen(dx, dy);
      act(() => map.fire("move"));
    },
    zoomTo: (z) => {
      map.setZoom(z);
      act(() => map.fire("move"));
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

/**
 * Where on Earth an element is: the point a pin marks (its centre), a box's
 * NW corner. Derived from scene coordinates through the open document's
 * world frame; no anchor is stored.
 */
function placeOf(el: ExcalidrawElement): { lng: number; lat: number } {
  const frame = currentDocument().snapshot().world;
  if (el.customData?.tool === "pin") {
    return toLngLat(frame, shapeCenter(el));
  }
  if (el.type === "rectangle" && !el.angle) {
    return toLngLat(frame, { x: el.x, y: el.y });
  }
  throw new Error(`placeOf: ${el.type} is not used here`);
}

/** Commit an element the way a finished drawing gesture does: a captured,
 * version-bumping scene update. */
function draw(world: World, el: ExcalidrawElement): void {
  act(() =>
    world.api.updateScene({
      elements: [...world.api.getSceneElementsIncludingDeleted(), el],
      captureUpdate: CaptureUpdateAction.IMMEDIATELY,
    }),
  );
}

/** A user drag: a captured, version-bumping move of one element. */
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

/** Pixels between where `anchor` projects now and where `expected` does. */
function screenDistance(
  map: FakeMercatorMap,
  a: { lng: number; lat: number },
  b: { lng: number; lat: number },
): number {
  const pa = map.project([a.lng, a.lat]);
  const pb = map.project([b.lng, b.lat]);
  return Math.hypot(pa.x - pb.x, pa.y - pb.y);
}

function rectangle() {
  return newElement({
    type: "rectangle",
    x: 300,
    y: 300,
    width: 100,
    height: 100,
  });
}

describe("geography survives undo, pins, pans (audit 01)", () => {
  it("undo of a drag returns the anchor to its pre-drag geography, even after a pan", async () => {
    const w = await mount(10);
    const rect = rectangle();
    draw(w, rect);
    const beforeDrag = placeOf(w.el(rect.id));

    drag(w, rect.id, 50, 0);
    w.pan(200, 0);
    undo();
    // The next camera frame, which also settles any re-anchor undo provoked.
    w.pan(0, 0);

    // Measured in screen pixels at the current camera: under half a pixel.
    expect(
      screenDistance(w.map, placeOf(w.el(rect.id)), beforeDrag),
    ).toBeLessThan(0.5);
  });

  it("a pin stays anchored at the point the user clicked", async () => {
    const w = await mount(10);
    const ctx = buildToolContext(w.map as unknown as maplibregl.Map, w.api);
    const click = { clientX: 500, clientY: 400 };
    const clicked = w.map.unproject([click.clientX, click.clientY]);

    act(() =>
      PinTool.onPointerDown?.(
        {
          ...click,
          pointerId: 1,
          pointerType: "mouse",
          button: 0,
          shiftKey: false,
          altKey: false,
          ctrlKey: false,
          metaKey: false,
        },
        ctx,
      ),
    );
    w.pan(0, 0);

    const pin = w.api.getSceneElements()[0];
    // Measured in screen pixels at the zoom it was placed: under half a pixel.
    expect(screenDistance(w.map, placeOf(pin), clicked)).toBeLessThan(0.5);
  });

  it("a pure pan does not mark the document dirty", async () => {
    const w = await mount(10);
    draw(w, rectangle());
    w.pan(0, 0);
    act(() => persistence.getState().clearDirty());

    w.pan(200, 0);

    expect(persistence.getState().isDirty).toBe(false);
  });

  it("a pure pan leaves every element's scene geometry and version alone", async () => {
    const w = await mount(10);
    const rect = rectangle();
    draw(w, rect);
    w.pan(0, 0);
    const before = w.el(rect.id);

    w.pan(200, 0);

    const after = w.el(rect.id);
    expect({ x: after.x, y: after.y, version: after.version }).toEqual({
      x: before.x,
      y: before.y,
      version: before.version,
    });
  });
});
