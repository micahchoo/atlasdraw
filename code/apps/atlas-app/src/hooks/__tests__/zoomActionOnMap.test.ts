// W4b: Excalidraw's "reset zoom" (Ctrl+0) is its 100%, which in world
// coordinates is map zoom 22 (ADR-0015) — not a view anyone wants. On the map
// it frames everything drawn, as zoom-to-fit does.

import { describe, expect, it, vi } from "vitest";

import { zoomActionOnMap } from "../useCameraBridge";

const rect = {
  type: "rectangle",
  x: 1000,
  y: 2000,
  width: 500,
  height: 300,
  angle: 0,
  isDeleted: false,
} as const;

const stubMap = () => ({
  zoomIn: vi.fn(),
  zoomOut: vi.fn(),
  fitBounds: vi.fn(),
});

describe("zoomActionOnMap", () => {
  it("reset zoom frames every drawn element, as zoom-to-fit does", () => {
    const reset = stubMap();
    expect(
      zoomActionOnMap(reset, { type: "resetZoom" }, () => [rect as never]),
    ).toBe(true);
    const fit = stubMap();
    zoomActionOnMap(fit, {
      type: "zoomToFit",
      elements: [rect as never],
      inViewport: true,
    });
    expect(reset.fitBounds).toHaveBeenCalledTimes(1);
    expect(reset.fitBounds.mock.calls[0]).toEqual(fit.fitBounds.mock.calls[0]);
  });

  it("reset zoom with nothing drawn leaves the camera where it is", () => {
    const map = stubMap();
    expect(zoomActionOnMap(map, { type: "resetZoom" }, () => [])).toBe(true);
    expect(map.fitBounds).not.toHaveBeenCalled();
    expect(map.zoomIn).not.toHaveBeenCalled();
    expect(map.zoomOut).not.toHaveBeenCalled();
  });
});
