// SPDX-License-Identifier: AGPL-3.0-only
// MapView: one plain value for "the map as the user sees it", read by every
// surface that draws the map outside the live editor.
//
// The drawing test checks geometry, not calls. The fake 2D context below
// keeps a real affine matrix, so the test can ask where a scene point lands
// in the output and compare that with an independent answer: the point's
// lng/lat, projected the way MapLibre projects it at that bearing.

import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

import { documentFrame, toScene, viewportFor } from "@atlasdraw/geo";

import type { OverlayEntry } from "../../state/document";
import type { MapView } from "../mapView";

interface FakeSource {
  width: number;
  height: number;
  label: string;
  viewport: {
    width: number;
    height: number;
    scrollX: number;
    scrollY: number;
    zoom: { value: number };
  };
  scale: number;
}

vi.mock("@atlasdraw/excalidraw", () => ({
  exportToCanvas: async (opts: {
    viewport: FakeSource["viewport"];
    getDimensions: (
      w: number,
      h: number,
    ) => { width: number; height: number; scale: number };
  }): Promise<FakeSource> => {
    const dims = opts.getDimensions(opts.viewport.width, opts.viewport.height);
    return {
      width: dims.width,
      height: dims.height,
      scale: dims.scale,
      label: "drawing",
      viewport: opts.viewport,
    };
  },
}));

type Matrix = [number, number, number, number, number, number];
const IDENTITY: Matrix = [1, 0, 0, 1, 0, 0];

function multiply(m: Matrix, n: Matrix): Matrix {
  const [a, b, c, d, e, f] = m;
  const [a2, b2, c2, d2, e2, f2] = n;
  return [
    a * a2 + c * b2,
    b * a2 + d * b2,
    a * c2 + c * d2,
    b * c2 + d * d2,
    a * e2 + c * f2 + e,
    b * e2 + d * f2 + f,
  ];
}

function apply(m: Matrix, x: number, y: number): { x: number; y: number } {
  return { x: m[0] * x + m[2] * y + m[4], y: m[1] * x + m[3] * y + m[5] };
}

/** An image drawn into the output, with the transform it was drawn under. */
interface Drawn {
  source: FakeSource;
  matrix: Matrix;
}

class FakeOffscreenCanvas {
  static last: FakeOffscreenCanvas | null = null;
  drawn: Drawn[] = [];
  constructor(public width: number, public height: number) {
    FakeOffscreenCanvas.last = this;
  }
  getContext() {
    let matrix: Matrix = IDENTITY;
    const stack: Matrix[] = [];
    return {
      save: () => stack.push(matrix),
      restore: () => {
        matrix = stack.pop() ?? IDENTITY;
      },
      translate: (x: number, y: number) => {
        matrix = multiply(matrix, [1, 0, 0, 1, x, y]);
      },
      rotate: (rad: number) => {
        const cos = Math.cos(rad);
        const sin = Math.sin(rad);
        matrix = multiply(matrix, [cos, sin, -sin, cos, 0, 0]);
      },
      drawImage: (source: FakeSource, x: number, y: number) => {
        this.drawn.push({
          source,
          matrix: multiply(matrix, [1, 0, 0, 1, x, y]),
        });
      },
    };
  }
}

beforeEach(() => {
  FakeOffscreenCanvas.last = null;
  vi.stubGlobal("OffscreenCanvas", FakeOffscreenCanvas);
});

afterEach(() => {
  vi.unstubAllGlobals();
});

const tile = (
  id: string,
  attribution: string | undefined,
  visible = true,
  order = 0,
): OverlayEntry => ({
  kind: "tile",
  id,
  label: id,
  visible,
  order,
  opacity: 1,
  url: "https://t.example.org/{z}/{x}/{y}.png",
  ...(attribution !== undefined ? { attribution } : {}),
});

describe("mapCredits", () => {
  it("is the basemap's credit when there are no tile layers", async () => {
    const { mapCredits } = await import("../mapView");
    expect(mapCredits("© OpenStreetMap", [])).toEqual(["© OpenStreetMap"]);
  });

  it("adds the credit of each visible tile layer, top first, once each", async () => {
    const { mapCredits } = await import("../mapView");
    expect(
      mapCredits("© OpenStreetMap", [
        tile("tl:a", "© Aerial Co", true, 0),
        tile("tl:b", "© Old Maps", true, 1),
        tile("tl:c", "© Aerial Co", true, 2),
        tile("tl:d", "© Hidden", false, 3),
        tile("tl:e", undefined, true, 4),
        tile("tl:f", "  ", true, 5),
      ]),
    ).toEqual(["© OpenStreetMap", "© Aerial Co", "© Old Maps"]);
  });

  it("drops a credit the basemap already gives", async () => {
    const { mapCredits } = await import("../mapView");
    expect(
      mapCredits("© OpenStreetMap", [tile("tl:a", "© OpenStreetMap")]),
    ).toEqual(["© OpenStreetMap"]);
  });

  it("works with no basemap credit", async () => {
    const { mapCredits } = await import("../mapView");
    expect(mapCredits(undefined, [tile("tl:a", "© Aerial Co")])).toEqual([
      "© Aerial Co",
    ]);
  });

  it("prints as one line, each credit separated by a dot", async () => {
    const { creditText } = await import("../mapView");
    expect(creditText(["© OpenStreetMap", "© Aerial Co"])).toBe(
      "© OpenStreetMap · © Aerial Co",
    );
    expect(creditText([])).toBe("");
  });
});

describe("captureView", () => {
  it("reads the camera and size off the map, and the frame and credits off the document", async () => {
    const { captureView } = await import("../mapView");
    const world = documentFrame(88.6, 29.3);
    const view = captureView(
      {
        getCenter: () => ({ lng: 88.6, lat: 29.3 }),
        getZoom: () => 9.5,
        getBearing: () => 30,
        getCanvas: () => ({ clientWidth: 1280, clientHeight: 720 }),
      },
      {
        world,
        basemap: "protomaps-light",
        overlays: [tile("tl:a", "© Aerial Co")],
      },
    );
    expect(view).toEqual<MapView>({
      center: { lng: 88.6, lat: 29.3 },
      zoom: 9.5,
      bearing: 30,
      size: { width: 1280, height: 720 },
      frame: world,
      credits: ["© Protomaps © OpenStreetMap", "© Aerial Co"],
    });
  });

  it("is a plain value: a later camera move does not change it", async () => {
    const { captureView } = await import("../mapView");
    const center = { lng: 1, lat: 2 };
    const view = captureView(
      {
        getCenter: () => center,
        getZoom: () => 3,
        getBearing: () => 0,
        getCanvas: () => ({ clientWidth: 10, clientHeight: 10 }),
      },
      { world: documentFrame(0, 0), basemap: "blank", overlays: [] },
    );
    center.lng = 50;
    expect(view.center.lng).toBe(1);
    expect(view.credits).toEqual([]);
  });
});

describe("groundResolution", () => {
  it("is MapLibre's metres per CSS pixel at the view's centre", async () => {
    const { groundResolution } = await import("../mapView");
    const base = {
      bearing: 0,
      size: { width: 100, height: 100 },
      frame: documentFrame(0, 0),
      credits: [],
    };
    // 512-px tiles: the equator is 40,075,016.686 m over 512 px at zoom 0.
    expect(
      groundResolution({ ...base, center: { lng: 0, lat: 0 }, zoom: 0 }),
    ).toBeCloseTo(40075016.686 / 512, 3);
    // cos(60°) = 0.5, and each zoom level halves it again.
    expect(
      groundResolution({ ...base, center: { lng: 0, lat: 60 }, zoom: 3 }),
    ).toBeCloseTo(40075016.686 / 512 / 2 / 8, 3);
  });
});

describe("drawingCover", () => {
  it("is the view itself when the map points north", async () => {
    const { drawingCover } = await import("../mapView");
    expect(drawingCover({ width: 1280, height: 720 }, 0)).toEqual({
      width: 1280,
      height: 720,
    });
  });

  it("is the box around the turned view, so no corner is left empty", async () => {
    const { drawingCover } = await import("../mapView");
    expect(drawingCover({ width: 1280, height: 720 }, 90)).toEqual({
      width: 720,
      height: 1280,
    });
    const c = 1280 * Math.cos(Math.PI / 6) + 720 * 0.5;
    const s = 1280 * 0.5 + 720 * Math.cos(Math.PI / 6);
    expect(drawingCover({ width: 1280, height: 720 }, -30)).toEqual({
      width: Math.ceil(c),
      height: Math.ceil(s),
    });
  });
});

describe("renderDrawing", () => {
  const frame = documentFrame(88.6, 29.3);
  const view = (bearing: number): MapView => ({
    center: { lng: 88.6, lat: 29.3 },
    zoom: 8,
    bearing,
    size: { width: 1280, height: 720 },
    frame,
    credits: [],
  });

  /**
   * Where MapLibre puts (lng, lat) on screen, in CSS px: the Mercator offset
   * from the centre, turned by -bearing (a bearing of 90 puts east up).
   */
  function liveScreen(v: MapView, lng: number, lat: number) {
    const p = toScene(v.frame, lng, lat);
    const c = toScene(v.frame, v.center.lng, v.center.lat);
    const k = Math.pow(2, v.zoom - v.frame.z0);
    const dx = (p.x - c.x) * k;
    const dy = (p.y - c.y) * k;
    const t = (-v.bearing * Math.PI) / 180;
    return {
      x: v.size.width / 2 + dx * Math.cos(t) - dy * Math.sin(t),
      y: v.size.height / 2 + dx * Math.sin(t) + dy * Math.cos(t),
    };
  }

  /** Where the export puts a scene point, in output px. */
  function exported(out: FakeOffscreenCanvas, scene: { x: number; y: number }) {
    expect(out.drawn).toHaveLength(1);
    const [{ source, matrix }] = out.drawn;
    const vp = source.viewport;
    // Excalidraw draws p at (p + scroll) * zoom, in its own CSS px, times the
    // canvas scale.
    const inner = {
      x: (scene.x + vp.scrollX) * vp.zoom.value * source.scale,
      y: (scene.y + vp.scrollY) * vp.zoom.value * source.scale,
    };
    return apply(matrix, inner.x, inner.y);
  }

  for (const bearing of [0, 30, 90, -45]) {
    it(`registers the drawing on the map at bearing ${bearing}`, async () => {
      const { renderDrawing } = await import("../mapView");
      const v = view(bearing);
      const pixelRatio = 2;
      const canvas = await renderDrawing(v, { elements: [], files: {} }, 2);
      const out = FakeOffscreenCanvas.last!;
      expect(canvas).toBe(out as unknown as OffscreenCanvas);
      expect([out.width, out.height]).toEqual([2560, 1440]);

      // A box over Shigatse, 300 px and more from the centre at this zoom.
      for (const [lng, lat] of [
        [88.88, 29.27],
        [90.0, 30.0],
        [87.5, 28.6],
      ]) {
        const got = exported(out, toScene(frame, lng, lat));
        const want = liveScreen(v, lng, lat);
        expect(got.x).toBeCloseTo(want.x * pixelRatio, 3);
        expect(got.y).toBeCloseTo(want.y * pixelRatio, 3);
      }
    });
  }

  it("asks Excalidraw for the box around the turned view, centred on the camera", async () => {
    const { renderDrawing, drawingCover } = await import("../mapView");
    const v = view(30);
    await renderDrawing(v, { elements: [], files: {} }, 3);
    const [{ source }] = FakeOffscreenCanvas.last!.drawn;
    const cover = drawingCover(v.size, 30);
    const want = viewportFor(frame, {
      center: v.center,
      zoom: v.zoom,
      ...cover,
    });
    expect(source.viewport).toEqual({
      width: cover.width,
      height: cover.height,
      scrollX: want.scrollX,
      scrollY: want.scrollY,
      zoom: { value: want.zoom },
    });
    expect(source.scale).toBe(3);
    expect([source.width, source.height]).toEqual([
      Math.round(cover.width * 3),
      Math.round(cover.height * 3),
    ]);
  });
});
