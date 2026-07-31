import { describe, it, expect, vi, beforeEach, afterEach } from "vitest";

// jsdom 22 has no OffscreenCanvas / convertToBlob; stub them.
// Also stub the package-level `exportToCanvas` from @atlasdraw/excalidraw
// so we don't pull in the entire renderer.

const exportToCanvasMock = vi.fn();
vi.mock("@atlasdraw/excalidraw", () => ({
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
/** Bytes the next `convertToBlob` resolves with. Empty when undefined. */
let nextBlobPayload: Uint8Array<ArrayBuffer> | undefined;

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
    this.convertToBlob = vi.fn(async ({ type }: { type: string }) =>
      nextBlobPayload === undefined
        ? new Blob([], { type })
        : new Blob([nextBlobPayload], { type }),
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
    } as unknown as import("@atlasdraw/excalidraw").ExcalidrawImperativeAPI,
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

// FU-12 — the PDF export drew `map.getCanvas()` directly, so every Excalidraw
// shape was missing from the document while the export still reported success.
// These pin the composite that fix depends on: the encoded image the PDF path
// consumes must contain BOTH layers. Delete the `drawImage(excalidrawCanvas)`
// line in export.ts and the first assertion here goes red.
describe("exportCompositeDataURL", () => {
  beforeEach(() => {
    lastOffscreen = null;
    nextContextOverride = undefined;
    nextBlobPayload = undefined;
    exportToCanvasMock.mockReset();
    vi.stubGlobal("OffscreenCanvas", StubOffscreenCanvas);
  });

  afterEach(() => {
    vi.unstubAllGlobals();
  });

  it("composites the Excalidraw scene over the map, like exportPNG", async () => {
    const { exportCompositeDataURL } = await import("../export");
    const map = makeMap({
      width: 800,
      height: 600,
      clientWidth: 800,
      clientHeight: 600,
    });
    const { api, fakeExcalidrawCanvas } = makeExcalidrawAPI();

    await exportCompositeDataURL(map, api);

    const ctx = lastOffscreen!.ctx!;
    expect(ctx.drawImage).toHaveBeenCalledTimes(2);
    expect(ctx.drawImage.mock.calls[0][0]).toBe(map.canvas);
    expect(ctx.drawImage.mock.calls[1][0]).toBe(fakeExcalidrawCanvas);
  });

  it("encodes JPEG at 0.85 by default", async () => {
    const { exportCompositeDataURL } = await import("../export");
    const map = makeMap({
      width: 800,
      height: 600,
      clientWidth: 800,
      clientHeight: 600,
    });
    const { api } = makeExcalidrawAPI();

    const dataUrl = await exportCompositeDataURL(map, api);

    expect(lastOffscreen!.convertToBlob).toHaveBeenCalledWith({
      type: "image/jpeg",
      quality: 0.85,
    });
    expect(dataUrl.startsWith("data:image/jpeg;base64,")).toBe(true);
  });

  it("encodes a full-size payload without truncating or mis-padding", async () => {
    const { exportCompositeDataURL } = await import("../export");
    const map = makeMap({
      width: 800,
      height: 600,
      clientWidth: 800,
      clientHeight: 600,
    });
    const { api } = makeExcalidrawAPI();
    // ~40KB, the order of a real export's JPEG. Guards the encode path
    // against truncation regardless of how it is implemented. Size is a
    // multiple of 3 so correct base64 carries no padding at all — any "="
    // in the output means bytes went missing.
    nextBlobPayload = new Uint8Array(39_999).fill(0x41);

    const dataUrl = await exportCompositeDataURL(map, api);

    const b64 = dataUrl.slice("data:image/jpeg;base64,".length);
    // 39999 bytes / 3 * 4 = 53332 base64 chars, no padding.
    expect(b64).toHaveLength(53332);
    // "AAA" (0x41 x3) encodes to "QUFB".
    expect(b64.startsWith("QUFBQUFB")).toBe(true);
    expect(b64.includes("=")).toBe(false);
  });
});
