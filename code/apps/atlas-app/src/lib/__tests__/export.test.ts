import { describe, it, expect, vi, beforeEach, afterEach } from "vitest";

// jsdom 22 has no OffscreenCanvas / convertToBlob; stub them.
// Also stub the package-level `exportToCanvas` from @excalidraw/excalidraw
// so we don't pull in the entire renderer.

const exportToCanvasMock = vi.fn();
vi.mock("@excalidraw/excalidraw", () => ({
  exportToCanvas: (opts: unknown) => exportToCanvasMock(opts),
}));

// Capture the most recently-constructed OffscreenCanvas so tests can assert
// on its width/height and the captured 2D context.
type FakeCtx = {
  scale: ReturnType<typeof vi.fn>;
  drawImage: ReturnType<typeof vi.fn>;
  fillRect: ReturnType<typeof vi.fn>;
  fillStyle?: string;
};
type FakeOffscreen = {
  width: number;
  height: number;
  ctx: FakeCtx | null;
  getContext: ReturnType<typeof vi.fn>;
  convertToBlob: ReturnType<typeof vi.fn>;
};

let lastOffscreen: FakeOffscreen | null = null;
let nextContextOverride: FakeCtx | null | undefined;

class StubOffscreenCanvas {
  width: number;
  height: number;
  ctx: FakeCtx | null;
  getContext: ReturnType<typeof vi.fn>;
  convertToBlob: ReturnType<typeof vi.fn>;
  constructor(width: number, height: number) {
    this.width = width;
    this.height = height;
    const ctx: FakeCtx = {
      scale: vi.fn(),
      drawImage: vi.fn(),
      fillRect: vi.fn(),
    };
    this.ctx = nextContextOverride === undefined ? ctx : nextContextOverride;
    this.getContext = vi.fn(() => this.ctx);
    this.convertToBlob = vi.fn(
      async ({ type }: { type: string }) => new Blob([], { type }),
    );
    lastOffscreen = this as unknown as FakeOffscreen;
  }
}

// Build a mock MapLibre Map exposing only what exportPNG touches.
function makeMap(opts: {
  width: number;
  height: number;
  clientWidth: number;
  clientHeight: number;
}) {
  const canvas = {
    width: opts.width,
    height: opts.height,
    clientWidth: opts.clientWidth,
    clientHeight: opts.clientHeight,
    // Marker so we can identify this object came from the map layer.
    __isMapCanvas: true,
  };
  return {
    getCanvas: () => canvas,
    canvas,
    // unused by exportPNG but typed by maplibregl.Map
  } as unknown as import("maplibre-gl").Map & {
    canvas: typeof canvas;
  };
}

function makeExcalidrawAPI(appStateOverrides: Record<string, unknown> = {}) {
  // exportToCanvas mock returns this; tests use it to identify the
  // second drawImage argument.
  const fakeExcalidrawCanvas = { __isExcalidrawCanvas: true };
  exportToCanvasMock.mockResolvedValue(fakeExcalidrawCanvas);
  const appState = {
    viewBackgroundColor: "#fff",
    scrollX: 0,
    scrollY: 0,
    zoom: { value: 1 as const },
    ...appStateOverrides,
  };
  return {
    api: {
      getSceneElements: () => [{ id: "el-1" }],
      getAppState: () => appState,
      getFiles: () => ({}),
    } as unknown as import("@excalidraw/excalidraw").ExcalidrawImperativeAPI,
    fakeExcalidrawCanvas,
    appState,
  };
}

describe("exportPNG", () => {
  beforeEach(() => {
    lastOffscreen = null;
    nextContextOverride = undefined;
    exportToCanvasMock.mockReset();
    vi.stubGlobal("OffscreenCanvas", StubOffscreenCanvas);
  });

  afterEach(() => {
    vi.unstubAllGlobals();
  });

  it("draws map first, then Excalidraw annotations on top", async () => {
    const { exportPNG } = await import("../export");
    const map = makeMap({
      width: 800,
      height: 600,
      clientWidth: 800,
      clientHeight: 600,
    });
    const { api, fakeExcalidrawCanvas } = makeExcalidrawAPI();

    await exportPNG(map, api);

    expect(lastOffscreen).not.toBeNull();
    const ctx = lastOffscreen!.ctx!;
    expect(ctx.drawImage).toHaveBeenCalledTimes(2);
    // First drawImage gets the map canvas; second gets the excalidraw canvas.
    expect(ctx.drawImage.mock.calls[0][0]).toBe(map.canvas);
    expect(ctx.drawImage.mock.calls[1][0]).toBe(fakeExcalidrawCanvas);
  });

  it("returns a Blob with type image/png", async () => {
    const { exportPNG } = await import("../export");
    const map = makeMap({
      width: 800,
      height: 600,
      clientWidth: 800,
      clientHeight: 600,
    });
    const { api } = makeExcalidrawAPI();

    const blob = await exportPNG(map, api);

    expect(blob).toBeInstanceOf(Blob);
    expect(blob.type).toBe("image/png");
  });

  it("defaults scale to 2x of CSS pixels", async () => {
    const { exportPNG } = await import("../export");
    const map = makeMap({
      width: 800,
      height: 600,
      clientWidth: 800,
      clientHeight: 600,
    });
    const { api } = makeExcalidrawAPI();

    await exportPNG(map, api);

    expect(lastOffscreen!.width).toBe(1600);
    expect(lastOffscreen!.height).toBe(1200);
    expect(lastOffscreen!.ctx!.scale).toHaveBeenCalledWith(2, 2);
  });

  it("respects custom scale", async () => {
    const { exportPNG } = await import("../export");
    const map = makeMap({
      width: 800,
      height: 600,
      clientWidth: 800,
      clientHeight: 600,
    });
    const { api } = makeExcalidrawAPI();

    await exportPNG(map, api, { scale: 1 });

    expect(lastOffscreen!.width).toBe(800);
    expect(lastOffscreen!.height).toBe(600);
    expect(lastOffscreen!.ctx!.scale).toHaveBeenCalledWith(1, 1);
  });

  it("uses CSS logical pixels (clientWidth/Height), not physical pixels", async () => {
    const { exportPNG } = await import("../export");
    // DPR=2 retina: physical canvas 1600x1200, CSS box 800x600.
    const map = makeMap({
      width: 1600,
      height: 1200,
      clientWidth: 800,
      clientHeight: 600,
    });
    const { api } = makeExcalidrawAPI();

    await exportPNG(map, api);

    // Default scale 2 x CSS 800/600 = 1600/1200, NOT 3200/2400 (which would
    // be physical * scale, a 4x logical-resolution bug).
    expect(lastOffscreen!.width).toBe(1600);
    expect(lastOffscreen!.height).toBe(1200);
  });

  it("passes live viewport (scroll + zoom) to exportToCanvas", async () => {
    const { exportPNG } = await import("../export");
    const map = makeMap({
      width: 800,
      height: 600,
      clientWidth: 800,
      clientHeight: 600,
    });
    const { api, appState } = makeExcalidrawAPI({
      scrollX: 123,
      scrollY: -45,
      zoom: { value: 1.5 as const },
    });

    await exportPNG(map, api);

    const opts = exportToCanvasMock.mock.calls[0][0] as {
      viewport?: {
        scrollX: number;
        scrollY: number;
        zoom: { value: number };
        width: number;
        height: number;
      };
    };
    expect(opts.viewport).toMatchObject({
      width: 800,
      height: 600,
      scrollX: appState.scrollX,
      scrollY: appState.scrollY,
      zoom: appState.zoom,
    });
  });

  it("fills backgroundColor before map layer when not transparent", async () => {
    const { exportPNG } = await import("../export");
    const map = makeMap({
      width: 800,
      height: 600,
      clientWidth: 800,
      clientHeight: 600,
    });
    const { api } = makeExcalidrawAPI();

    await exportPNG(map, api, { backgroundColor: "#000000" });

    const ctx = lastOffscreen!.ctx!;
    expect(ctx.fillRect).toHaveBeenCalledTimes(1);
    expect(ctx.fillRect).toHaveBeenCalledWith(0, 0, 800, 600);
    // Map and Excalidraw layers still composited on top.
    expect(ctx.drawImage).toHaveBeenCalledTimes(2);
  });

  it("skips fillRect when backgroundColor is transparent (default)", async () => {
    const { exportPNG } = await import("../export");
    const map = makeMap({
      width: 800,
      height: 600,
      clientWidth: 800,
      clientHeight: 600,
    });
    const { api } = makeExcalidrawAPI();

    await exportPNG(map, api);

    expect(lastOffscreen!.ctx!.fillRect).not.toHaveBeenCalled();
  });

  it("throws a clear error when the 2D context is unavailable", async () => {
    nextContextOverride = null;
    const { exportPNG } = await import("../export");
    const map = makeMap({
      width: 800,
      height: 600,
      clientWidth: 800,
      clientHeight: 600,
    });
    const { api } = makeExcalidrawAPI();

    await expect(exportPNG(map, api)).rejects.toThrow(/context unavailable/i);
  });
});
