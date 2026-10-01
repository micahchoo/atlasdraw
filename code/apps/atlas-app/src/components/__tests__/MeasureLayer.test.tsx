// SPDX-License-Identifier: AGPL-3.0-only
//
// MeasureLayer: the selection readout and the Measure tool, driven through
// the DOM on a map with real Web Mercator math. Every number here is a
// ground distance checked against GeographicLib 2.1.

import {
  act,
  cleanup,
  fireEvent,
  render,
  screen,
} from "@testing-library/react";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

import { newElement, newLinearElement } from "@atlasdraw/element";
import { toScene } from "@atlasdraw/geo";
import { pointFrom } from "@atlasdraw/math";

import type { ExcalidrawImperativeAPI } from "@atlasdraw/excalidraw";
import type { ExcalidrawElement } from "@atlasdraw/element/types";
import type { LocalPoint } from "@atlasdraw/math";

import { FakeMercatorMap } from "../../hooks/__tests__/fakeMercatorMap";
import { currentDocument } from "../../state/document";
import { MEASURE_UNITS_KEY } from "../../state/measure";
import {
  testSession,
  withSession,
} from "../../session/__tests__/sessionFixture";
import { MeasureLayer } from "../MeasureLayer";

import type maplibregl from "maplibre-gl";

// jsdom 22 has no PointerEvent, so React would read no clientX.
if (typeof globalThis.PointerEvent === "undefined") {
  class FakePointerEvent extends MouseEvent {
    pointerId: number;
    pointerType: string;
    constructor(type: string, init: PointerEventInit = {}) {
      super(type, init);
      this.pointerId = init.pointerId ?? 1;
      this.pointerType = init.pointerType ?? "mouse";
    }
  }
  globalThis.PointerEvent = FakePointerEvent as unknown as typeof PointerEvent;
}

/** The shared fake, plus what MeasureLayer asks of a map beyond it. */
class MeasureMap extends FakeMercatorMap {
  private readonly container = document.createElement("div");
  private readonly moves = new Set<() => void>();
  getContainer() {
    return this.container;
  }
  on(_type: "move", fn: () => void) {
    this.moves.add(fn);
    return this;
  }
  off(_type: "move", fn: () => void) {
    this.moves.delete(fn);
    return this;
  }
  panBy([dx, dy]: [number, number]) {
    this.panByScreen(dx, dy);
    this.moves.forEach((fn) => fn());
  }
  getBounds() {
    return {
      getNorth: () => 90,
      getSouth: () => -90,
      getEast: () => 180,
      getWest: () => -180,
    };
  }
}

/** An editor with a scene and a selection, and nothing else. */
function fakeEditor(initial: ExcalidrawElement[], selected: string[] = []) {
  let elements = initial;
  let appState: Record<string, unknown> = {
    selectedElementIds: Object.fromEntries(selected.map((id) => [id, true])),
  };
  const listeners = new Set<(...a: unknown[]) => void>();
  const api = {
    getSceneElements: () => elements.filter((e) => !e.isDeleted),
    getSceneElementsIncludingDeleted: () => elements,
    getAppState: () => appState,
    onChange: (fn: (...a: unknown[]) => void) => {
      listeners.add(fn);
      return () => listeners.delete(fn);
    },
    updateScene: (u: {
      elements?: ExcalidrawElement[];
      appState?: Record<string, unknown>;
    }) => {
      elements = u.elements ?? elements;
      appState = u.appState ? { ...appState, ...u.appState } : appState;
      listeners.forEach((fn) => fn(elements, appState, {}));
    },
  };
  return {
    api: api as unknown as ExcalidrawImperativeAPI,
    elements: () => elements,
    selected: () =>
      Object.keys(appState.selectedElementIds as Record<string, boolean>),
  };
}

const frame = () => currentDocument().snapshot().world;

/** A box element on lng/lat corners. */
function boxOn(
  type: "rectangle" | "ellipse",
  west: number,
  north: number,
  east: number,
  south: number,
): ExcalidrawElement {
  const nw = toScene(frame(), west, north);
  const se = toScene(frame(), east, south);
  return newElement({
    type,
    x: nw.x,
    y: nw.y,
    width: se.x - nw.x,
    height: se.y - nw.y,
  });
}

const LONDON = { lng: -0.1278, lat: 51.5074 };
const PARIS = { lng: 2.3522, lat: 48.8566 };

function renderLayer(
  map: MeasureMap,
  api: ExcalidrawImperativeAPI,
  otherToolActive = false,
) {
  return render(
    withSession(
      <MeasureLayer
        map={map as unknown as maplibregl.Map}
        excalidrawAPI={api}
        otherToolActive={otherToolActive}
        onStart={() => {}}
      />,
      session,
    ),
  );
}

/** A click on the overlay at the screen point of `p`. */
function clickAt(map: MeasureMap, p: { lng: number; lat: number }) {
  const { x, y } = map.project([p.lng, p.lat]);
  const overlay = screen.getByTestId("measure-overlay");
  fireEvent.pointerDown(overlay, { clientX: x, clientY: y, button: 0 });
  fireEvent.pointerUp(overlay, { clientX: x, clientY: y, button: 0 });
}

const text = (id: string) => screen.getByTestId(id).textContent;

/** The editor's session: the tool off, metric units. */
let session = testSession();

beforeEach(() => {
  localStorage.clear();
  localStorage.setItem(MEASURE_UNITS_KEY, "metric");
  session = testSession();
});
afterEach(cleanup);

describe("selection readout", () => {
  it("gives a rectangle on a 1° cell its area and perimeter", () => {
    const cell = boxOn("rectangle", 0, 1, 1, 0);
    const ed = fakeEditor([cell], [cell.id]);
    renderLayer(new MeasureMap(6, { lng: 0.5, lat: 0.5 }), ed.api);
    expect(text("measure-area")).toBe("Area 12,308 km²");
    expect(text("measure-perimeter")).toBe("Perimeter 444 km");
  });

  it("switches to imperial units and remembers the switch", () => {
    const cell = boxOn("rectangle", 0, 1, 1, 0);
    const ed = fakeEditor([cell], [cell.id]);
    renderLayer(new MeasureMap(6, { lng: 0.5, lat: 0.5 }), ed.api);
    fireEvent.click(screen.getByTestId("measure-units-button"));
    expect(text("measure-area")).toBe("Area 4,752 mi²");
    expect(text("measure-perimeter")).toBe("Perimeter 276 mi");
    expect(localStorage.getItem(MEASURE_UNITS_KEY)).toBe("imperial");
  });

  it("gives a circle its radius", () => {
    // 1 km east-west at the equator. On the ground it is 0.67% shorter
    // north-south (993.3 m): the map's Mercator is the sphere's, and the
    // ellipsoid's meridian degree is shorter. The radius is the mean.
    const deg = 1000 / 111_319.491;
    const circle = boxOn("ellipse", -deg, deg, deg, -deg);
    const ed = fakeEditor([circle], [circle.id]);
    renderLayer(new MeasureMap(14, { lng: 0, lat: 0 }), ed.api);
    expect(text("measure-radius")).toBe("Radius 997 m");
    expect(text("measure-area")).toBe("Area 3.12 km²");
  });

  it("gives an ellipse both semi-axes", () => {
    const dx = 2000 / 111_319.491;
    const dy = 1000 / 110_574.389;
    const el = boxOn("ellipse", -dx, dy, dx, -dy);
    const ed = fakeEditor([el], [el.id]);
    renderLayer(new MeasureMap(13, { lng: 0, lat: 0 }), ed.api);
    expect(text("measure-radius")).toBe("Semi-axes 2 km × 1 km");
  });

  it("follows the selection and shows nothing for two elements", () => {
    const a = boxOn("rectangle", 0, 1, 1, 0);
    const b = boxOn("rectangle", 2, 1, 3, 0);
    const ed = fakeEditor([a, b], []);
    renderLayer(new MeasureMap(6, { lng: 0.5, lat: 0.5 }), ed.api);
    expect(screen.queryByTestId("measure-readout")).toBeNull();
    act(() =>
      ed.api.updateScene({
        appState: { selectedElementIds: { [a.id]: true } },
      }),
    );
    expect(screen.getByTestId("measure-readout")).toBeTruthy();
    act(() =>
      ed.api.updateScene({
        appState: { selectedElementIds: { [a.id]: true, [b.id]: true } },
      }),
    );
    expect(screen.queryByTestId("measure-readout")).toBeNull();
  });

  it("gives a line its length", () => {
    const s = toScene(frame(), LONDON.lng, LONDON.lat);
    const e = toScene(frame(), PARIS.lng, PARIS.lat);
    const line = newLinearElement({
      type: "line",
      x: s.x,
      y: s.y,
      points: [
        pointFrom<LocalPoint>(0, 0),
        pointFrom<LocalPoint>(e.x - s.x, e.y - s.y),
      ],
    });
    const ed = fakeEditor([line], [line.id]);
    renderLayer(new MeasureMap(6, LONDON), ed.api);
    expect(text("measure-length")).toBe("Length 344 km");
  });
});

describe("Measure tool", () => {
  it("measures London to Paris on a map turned 30°, and keeps it as a line", () => {
    const map = new MeasureMap(7, { lng: 1, lat: 50.2 });
    map.setBearing(30);
    const ed = fakeEditor([]);
    renderLayer(map, ed.api);
    act(() => session.view.getState().setMeasuring(true));
    expect(text("measure-distance")).toBe("Click the map to start");

    clickAt(map, LONDON);
    clickAt(map, PARIS);
    expect(text("measure-distance")).toBe("344 km");
    // The second click of a double-click ends the path.
    clickAt(map, PARIS);
    expect(text("measure-distance")).toBe("344 km");

    fireEvent.click(screen.getByTestId("measure-keep-line"));
    const [line] = ed.elements();
    expect(line.type).toBe("line");
    expect(ed.selected()).toEqual([line.id]);
    expect(session.view.getState().measuring).toBe(false);
    // The kept line measures what the tool measured.
    expect(text("measure-length")).toBe("Length 344 km");
  });

  it("shows the running distance to the pointer", () => {
    const map = new MeasureMap(7, { lng: 1, lat: 50.2 });
    renderLayer(map, fakeEditor([]).api);
    act(() => session.view.getState().setMeasuring(true));
    clickAt(map, LONDON);
    const { x, y } = map.project([PARIS.lng, PARIS.lat]);
    fireEvent.pointerMove(screen.getByTestId("measure-overlay"), {
      clientX: x,
      clientY: y,
    });
    expect(text("measure-distance")).toBe("344 km");
  });

  it("pans the map on a drag and adds no point", () => {
    const map = new MeasureMap(7, { lng: 1, lat: 50.2 });
    renderLayer(map, fakeEditor([]).api);
    act(() => session.view.getState().setMeasuring(true));
    const overlay = screen.getByTestId("measure-overlay");
    fireEvent.pointerDown(overlay, { clientX: 500, clientY: 400, button: 0 });
    fireEvent.pointerMove(overlay, {
      clientX: 600,
      clientY: 400,
      buttons: 1,
    });
    fireEvent.pointerUp(overlay, { clientX: 600, clientY: 400, button: 0 });
    expect(map.center.lng).toBeLessThan(1);
    expect(text("measure-distance")).toBe("Click the map to start");
  });

  it("ends on Enter, removes a point on Backspace, and exits on Escape", () => {
    const map = new MeasureMap(7, { lng: 1, lat: 50.2 });
    renderLayer(map, fakeEditor([]).api);
    act(() => session.view.getState().setMeasuring(true));
    const reachedEditor = vi.fn();
    document.addEventListener("keydown", reachedEditor);
    try {
      clickAt(map, LONDON);
      clickAt(map, PARIS);
      clickAt(map, { lng: 2.3522, lat: 50 });
      fireEvent.keyDown(document.body, { key: "Backspace" });
      expect(text("measure-distance")).toBe("344 km");
      fireEvent.keyDown(document.body, { key: "Enter" });
      expect(screen.getByTestId("measure-keep-line")).toBeTruthy();
      fireEvent.keyDown(document.body, { key: "Escape" });
      expect(screen.queryByTestId("measure-overlay")).toBeNull();
      // The editor never saw them: Backspace would delete its selection.
      expect(reachedEditor).not.toHaveBeenCalled();
    } finally {
      document.removeEventListener("keydown", reachedEditor);
    }
  });

  it("hears no key while a dialog is open above it", () => {
    const map = new MeasureMap(7, { lng: 1, lat: 50.2 });
    renderLayer(map, fakeEditor([]).api);
    act(() => session.view.getState().setMeasuring(true));
    clickAt(map, LONDON);
    clickAt(map, PARIS);
    const pop = session.keys.push({
      name: "confirm",
      layer: "dialog",
      onKey: () => false,
    });
    try {
      const enter = fireEvent.keyDown(document.body, { key: "Enter" });
      fireEvent.keyDown(document.body, { key: "Escape" });
      fireEvent.keyDown(document.body, { key: "Backspace" });

      // Enter is left to the dialog's focused button.
      expect(enter).toBe(true);
      expect(screen.queryByTestId("measure-keep-line")).toBeNull();
      expect(session.view.getState().measuring).toBe(true);
      expect(text("measure-distance")).not.toBe("Click the map to start");
    } finally {
      pop();
    }
  });

  it("turns off when another tool starts", () => {
    const map = new MeasureMap(7, LONDON);
    const ed = fakeEditor([]);
    const view = renderLayer(map, ed.api);
    act(() => session.view.getState().setMeasuring(true));
    view.rerender(
      withSession(
        <MeasureLayer
          map={map as unknown as maplibregl.Map}
          excalidrawAPI={ed.api}
          otherToolActive
          onStart={() => {}}
        />,
        session,
      ),
    );
    expect(session.view.getState().measuring).toBe(false);
    expect(screen.queryByTestId("measure-overlay")).toBeNull();
  });
});
