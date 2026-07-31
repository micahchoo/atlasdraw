// SPDX-License-Identifier: MPL-2.0
// FU-14 / RT-0.
//
// The point of these tests is the *asymmetry*: rotation goes off, pan and
// zoom stay on. `touchZoomRotate.disable()` and `keyboard.disable()` would
// both pass a naive "rotation is off" assertion while silently removing
// pinch-zoom and arrow-key panning, so each is asserted as not-called.
import { describe, expect, it, vi } from "vitest";

import { disableCameraRotation } from "../cameraRotation";

import type { Map as MapLibreMap } from "maplibre-gl";

const makeMap = () => ({
  dragRotate: { disable: vi.fn(), enable: vi.fn() },
  touchZoomRotate: {
    disable: vi.fn(),
    disableRotation: vi.fn(),
    enableRotation: vi.fn(),
  },
  keyboard: { disable: vi.fn(), disableRotation: vi.fn() },
  dragPan: { disable: vi.fn() },
  scrollZoom: { disable: vi.fn() },
});

describe("disableCameraRotation", () => {
  it("turns off all three rotation gestures", () => {
    const map = makeMap();

    disableCameraRotation(map as unknown as MapLibreMap);

    expect(map.dragRotate.disable).toHaveBeenCalledOnce();
    expect(map.touchZoomRotate.disableRotation).toHaveBeenCalledOnce();
    expect(map.keyboard.disableRotation).toHaveBeenCalledOnce();
  });

  it("leaves pinch-zoom and keyboard pan alone", () => {
    const map = makeMap();

    disableCameraRotation(map as unknown as MapLibreMap);

    expect(map.touchZoomRotate.disable).not.toHaveBeenCalled();
    expect(map.keyboard.disable).not.toHaveBeenCalled();
    expect(map.dragPan.disable).not.toHaveBeenCalled();
    expect(map.scrollZoom.disable).not.toHaveBeenCalled();
  });

  it("is idempotent — EmbedView's ?lock=1 cleanup re-applies it", () => {
    const map = makeMap();

    disableCameraRotation(map as unknown as MapLibreMap);
    disableCameraRotation(map as unknown as MapLibreMap);

    expect(map.dragRotate.disable).toHaveBeenCalledTimes(2);
    expect(map.touchZoomRotate.disableRotation).toHaveBeenCalledTimes(2);
  });

  it("tolerates a map whose handlers are absent", () => {
    expect(() =>
      disableCameraRotation({} as unknown as MapLibreMap),
    ).not.toThrow();
  });
});
