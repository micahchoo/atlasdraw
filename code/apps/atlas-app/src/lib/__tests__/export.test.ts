// SPDX-License-Identifier: AGPL-3.0-only
// Composite export tests. jsdom has no canvas, so the fakes below are small
// models of the real contracts, not call recorders:
//
// - FakeOffscreenCanvas keeps the list of layers drawn into it, with each
//   layer's source size and the size it covers. That list IS the output
//   image's make-up: a layer whose source is smaller than what it covers was
//   upscaled.
// - The fake map renderer returns a canvas of the size a real MapLibre map
//   would give at that pixel ratio (or a smaller one, to model the GPU limit).
// - The fake `exportToCanvas` sizes its canvas through `getDimensions`, as
//   the vendored implementation does, and falls back to 1 px per CSS px.

import { describe, it, expect, vi, beforeEach, afterEach } from "vitest";

import type { MapRenderer } from "../export";

type Sized = { width: number; height: number; label: string };

vi.mock("@atlasdraw/excalidraw", () => ({
  exportToCanvas: async (opts: {
    viewport: { width: number; height: number };
    getDimensions?: (
      w: number,
      h: number,
    ) => { width: number; height: number; scale?: number };
  }): Promise<Sized> => {
    const { width, height } = opts.viewport;
    const dims = opts.getDimensions?.(width, height) ?? { width, height };
    return { width: dims.width, height: dims.height, label: "drawings" };
  },
}));

interface Layer {
  label: string;
  sourceWidth: number;
  sourceHeight: number;
  /** Size the layer covers in the output. */
  width: number;
  height: number;
}

class FakeOffscreenCanvas {
  static last: FakeOffscreenCanvas | null = null;
  static contextAvailable = true;
  layers: Layer[] = [];
  fills: { width: number; height: number; color: string }[] = [];
  /** Text drawn into the output, with the font it was drawn in. */
  texts: { text: string; font: string; x: number; y: number }[] = [];
  encoded: { type: string; quality?: number } | null = null;
  constructor(public width: number, public height: number) {
    FakeOffscreenCanvas.last = this;
  }
  getContext() {
    if (!FakeOffscreenCanvas.contextAvailable) {
      return null;
    }
    // Only an untransformed context is modelled: the export draws in output
    // pixels, so a scale() call would be a defect and throws here.
    const ctx = {
      fillStyle: "",
      font: "",
      textAlign: "start",
      textBaseline: "alphabetic",
      // A fixed advance: half the font size per character.
      measureText: (text: string) => ({
        width: text.length * (parseFloat(ctx.font) / 2),
      }),
      fillText: (text: string, x: number, y: number) => {
        this.texts.push({ text, font: ctx.font, x, y });
      },
      fillRect: (_x: number, _y: number, width: number, height: number) => {
        this.fills.push({ width, height, color: ctx.fillStyle });
      },
      drawImage: (src: Sized, _x: number, _y: number, w?: number, h?: number) =>
        this.layers.push({
          label: src.label,
          sourceWidth: src.width,
          sourceHeight: src.height,
          width: w ?? src.width,
          height: h ?? src.height,
        }),
    };
    return ctx;
  }
  async convertToBlob(opts: { type: string; quality?: number }) {
    this.encoded = opts;
    return new Blob([new Uint8Array(30)], { type: opts.type });
  }
}

/** The live map: only its CSS size is read; the renderer does the drawing. */
function liveMap(width: number, height: number) {
  return {
    getCanvas: () => ({ clientWidth: width, clientHeight: height }),
  } as unknown as import("maplibre-gl").Map;
}

const excalidrawAPI = {
  getSceneElements: () => [],
  getAppState: () => ({ scrollX: 0, scrollY: 0, zoom: { value: 1 } }),
  getFiles: () => ({}),
} as unknown as import("@atlasdraw/excalidraw").ExcalidrawImperativeAPI;

let disposed = 0;

/** Renders like MapLibre: floor(css × ratio), capped at `maxPixels` a side. */
function mapRenderer(maxPixels = Infinity): MapRenderer {
  return async (map, pixelRatio) => {
    const { clientWidth, clientHeight } = map.getCanvas();
    const cap = Math.min(
      1,
      maxPixels / (clientWidth * pixelRatio),
      maxPixels / (clientHeight * pixelRatio),
    );
    return {
      canvas: {
        width: Math.floor(clientWidth * pixelRatio * cap),
        height: Math.floor(clientHeight * pixelRatio * cap),
        label: "map",
      } as unknown as HTMLCanvasElement,
      dispose: () => {
        disposed++;
      },
    };
  };
}

beforeEach(() => {
  FakeOffscreenCanvas.last = null;
  FakeOffscreenCanvas.contextAvailable = true;
  disposed = 0;
  vi.stubGlobal("OffscreenCanvas", FakeOffscreenCanvas);
});

afterEach(() => {
  vi.unstubAllGlobals();
});

describe("exportPNG", () => {
  for (const ratio of [1, 2, 3]) {
    it(`at ${ratio}x is the view times ${ratio}, every layer drawn at that size`, async () => {
      const { exportPNG } = await import("../export");
      const blob = await exportPNG(liveMap(1440, 900), excalidrawAPI, {
        pixelRatio: ratio,
        renderMap: mapRenderer(),
      });
      expect(blob.type).toBe("image/png");
      const out = FakeOffscreenCanvas.last!;
      expect(out.width).toBe(1440 * ratio);
      expect(out.height).toBe(900 * ratio);
      expect(out.layers.map((l) => l.label)).toEqual(["map", "drawings"]);
      for (const layer of out.layers) {
        // Not upscaled: the source has as many pixels as it covers.
        expect(layer, layer.label).toMatchObject({
          sourceWidth: out.width,
          sourceHeight: out.height,
          width: out.width,
          height: out.height,
        });
      }
    });
  }

  it("fails, and says why, when the map cannot be drawn that large", async () => {
    const { exportPNG } = await import("../export");
    await expect(
      exportPNG(liveMap(2560, 1440), excalidrawAPI, {
        pixelRatio: 3,
        renderMap: mapRenderer(4096),
      }),
    ).rejects.toThrow(/4096 × 2304 px, not 7680 × 4320 px/);
    // The offscreen map is released on failure too.
    expect(disposed).toBe(1);
  });

  it("releases the offscreen map after a good export", async () => {
    const { exportPNG } = await import("../export");
    await exportPNG(liveMap(800, 600), excalidrawAPI, {
      pixelRatio: 2,
      renderMap: mapRenderer(),
    });
    expect(disposed).toBe(1);
  });

  it("fills the background colour across the whole output", async () => {
    const { exportPNG } = await import("../export");
    await exportPNG(liveMap(800, 600), excalidrawAPI, {
      pixelRatio: 2,
      backgroundColor: "#102030",
      renderMap: mapRenderer(),
    });
    expect(FakeOffscreenCanvas.last!.fills).toEqual([
      { width: 1600, height: 1200, color: "#102030" },
    ]);
  });

  it("prints the credit line in the bottom-right corner, at the export's scale", async () => {
    const { exportPNG } = await import("../export");
    await exportPNG(liveMap(800, 600), excalidrawAPI, {
      pixelRatio: 2,
      renderMap: mapRenderer(),
      credit: "© OpenStreetMap · © Example Aerials",
    });
    const out = FakeOffscreenCanvas.last!;
    expect(out.texts).toHaveLength(1);
    const [t] = out.texts;
    expect(t.text).toBe("© OpenStreetMap · © Example Aerials");
    // 11 px text at 2x.
    expect(parseFloat(t.font)).toBe(22);
    // Right-aligned against the right edge, on the bottom line.
    expect(t.x).toBeGreaterThan(out.width * 0.9);
    expect(t.y).toBeGreaterThan(out.height * 0.9);
  });

  it("prints no credit when it is given none", async () => {
    const { exportPNG } = await import("../export");
    await exportPNG(liveMap(800, 600), excalidrawAPI, {
      renderMap: mapRenderer(),
    });
    expect(FakeOffscreenCanvas.last!.texts).toEqual([]);
  });

  it("leaves a transparent background transparent", async () => {
    const { exportPNG } = await import("../export");
    await exportPNG(liveMap(800, 600), excalidrawAPI, {
      renderMap: mapRenderer(),
    });
    expect(FakeOffscreenCanvas.last!.fills).toEqual([]);
  });

  it("throws a clear error when the 2D context is unavailable", async () => {
    FakeOffscreenCanvas.contextAvailable = false;
    const { exportPNG } = await import("../export");
    await expect(
      exportPNG(liveMap(800, 600), excalidrawAPI, {
        renderMap: mapRenderer(),
      }),
    ).rejects.toThrow(/context unavailable/i);
  });
});

describe("exportSize", () => {
  it("is the CSS view times the ratio, rounded down as MapLibre sizes its canvas", async () => {
    const { exportSize } = await import("../export");
    expect(exportSize({ width: 1441, height: 901 }, 1.5)).toEqual({
      width: 2161,
      height: 1351,
    });
  });
});

describe("exportCompositeDataURL", () => {
  it("is a high-quality JPEG of the same composite", async () => {
    const { exportCompositeDataURL } = await import("../export");
    const url = await exportCompositeDataURL(liveMap(800, 600), excalidrawAPI, {
      pixelRatio: 2.5,
      renderMap: mapRenderer(),
    });
    expect(url.startsWith("data:image/jpeg;base64,")).toBe(true);
    const out = FakeOffscreenCanvas.last!;
    expect(out.encoded).toEqual({ type: "image/jpeg", quality: 0.92 });
    expect([out.width, out.height]).toEqual([2000, 1500]);
    expect(out.layers.map((l) => l.label)).toEqual(["map", "drawings"]);
  });
});

describe("measureView", () => {
  it("measures ground metres per CSS pixel across the centre of the view", async () => {
    const { measureView } = await import("../export");
    // A view at 60° N where each CSS px is 0.0001° of longitude. Along a
    // parallel that is R · cos(lat) · 0.0001° in radians.
    const degPerPx = 0.0001;
    const map = {
      getCanvas: () => ({ clientWidth: 1000, clientHeight: 500 }),
      unproject: ([x]: [number, number]) => ({
        lng: 10 + x * degPerPx,
        lat: 60,
      }),
    } as unknown as import("maplibre-gl").Map;
    const view = measureView(map);
    const expected =
      6371008.8 * Math.cos((60 * Math.PI) / 180) * ((degPerPx * Math.PI) / 180);
    expect(view.width).toBe(1000);
    expect(view.height).toBe(500);
    expect(view.metersPerPixel / expected).toBeCloseTo(1, 4);
  });
});
