// SPDX-License-Identifier: MPL-2.0
// FU-14 / RT-0.
//
// The point of these tests is the *asymmetry*: rotation goes off, pan and
// zoom stay on. `touchZoomRotate.disable()` and `keyboard.disable()` would
// both pass a naive "rotation is off" assertion while silently removing
// pinch-zoom and arrow-key panning, so each is asserted as not-called.
import { describe, expect, it, vi } from "vitest";

import {
  applyRotationPolicy,
  disableCameraRotation,
  enableCameraRotation,
  setCameraRotation,
} from "../cameraRotation";

import type { Map as MapLibreMap } from "maplibre-gl";

const makeMap = () => ({
  dragRotate: { disable: vi.fn(), enable: vi.fn() },
  touchZoomRotate: {
    disable: vi.fn(),
    enable: vi.fn(),
    disableRotation: vi.fn(),
    enableRotation: vi.fn(),
  },
  keyboard: {
    disable: vi.fn(),
    enable: vi.fn(),
    disableRotation: vi.fn(),
    enableRotation: vi.fn(),
  },
  dragPan: { disable: vi.fn() },
  scrollZoom: { disable: vi.fn() },
  setBearing: vi.fn(),
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

// RT-3. The asymmetry here runs the other way, and matters more: enabling is
// what a reviewer would expect to be the plain inverse of disabling, and it
// deliberately is not. `dragRotate` stays off because right-drag is
// Excalidraw's context menu across the whole plate.
describe("enableCameraRotation", () => {
  it("turns on the twist and shift+arrow gestures", () => {
    const map = makeMap();

    enableCameraRotation(map as unknown as MapLibreMap);

    expect(map.touchZoomRotate.enableRotation).toHaveBeenCalledOnce();
    expect(map.keyboard.enableRotation).toHaveBeenCalledOnce();
  });

  it("leaves right-drag to Excalidraw's context menu", () => {
    const map = makeMap();

    enableCameraRotation(map as unknown as MapLibreMap);

    expect(map.dragRotate.enable).not.toHaveBeenCalled();
  });

  it("does not blanket-enable the handlers it narrows", () => {
    // `touchZoomRotate.enable()` / `keyboard.enable()` would also undo an
    // unrelated disable — EmbedView's ?lock=1 turns those handlers off whole.
    const map = makeMap();

    enableCameraRotation(map as unknown as MapLibreMap);

    expect(map.touchZoomRotate.enable).not.toHaveBeenCalled();
    expect(map.keyboard.enable).not.toHaveBeenCalled();
  });

  it("tolerates a map whose handlers are absent", () => {
    expect(() =>
      enableCameraRotation({} as unknown as MapLibreMap),
    ).not.toThrow();
  });

  it("round-trips with disableCameraRotation in either order", () => {
    const map = makeMap();

    expect(() => {
      disableCameraRotation(map as unknown as MapLibreMap);
      enableCameraRotation(map as unknown as MapLibreMap);
      enableCameraRotation(map as unknown as MapLibreMap);
      disableCameraRotation(map as unknown as MapLibreMap);
    }).not.toThrow();
  });
});

// RT-3. What MapCanvas does at construction, extracted so the decision is
// testable in the node environment this package's suite runs in.
describe("applyRotationPolicy", () => {
  it("leaves rotation off when the view did not ask for it", () => {
    const map = makeMap();

    applyRotationPolicy(map as unknown as MapLibreMap, false);

    expect(map.dragRotate.disable).toHaveBeenCalledOnce();
    expect(map.touchZoomRotate.disableRotation).toHaveBeenCalledOnce();
    expect(map.keyboard.disableRotation).toHaveBeenCalledOnce();
    expect(map.touchZoomRotate.enableRotation).not.toHaveBeenCalled();
    expect(map.keyboard.enableRotation).not.toHaveBeenCalled();
  });

  it("hands back twist and shift+arrows when it did", () => {
    const map = makeMap();

    applyRotationPolicy(map as unknown as MapLibreMap, true);

    expect(map.touchZoomRotate.enableRotation).toHaveBeenCalledOnce();
    expect(map.keyboard.enableRotation).toHaveBeenCalledOnce();
  });

  it("never hands back right-drag, even when rotation is allowed", () => {
    const map = makeMap();

    applyRotationPolicy(map as unknown as MapLibreMap, true);

    expect(map.dragRotate.enable).not.toHaveBeenCalled();
    expect(map.dragRotate.disable).toHaveBeenCalledOnce();
  });
});

// RT-3. The single site in the app that converts between "screen rotation of
// geographic east" (what everything else measures) and MapLibre's bearing.
describe("setCameraRotation", () => {
  it("negates: bearing is the compass direction that is up, east-angle is not", () => {
    const map = makeMap();

    setCameraRotation(map as unknown as MapLibreMap, 30);

    expect(map.setBearing).toHaveBeenCalledWith(-30);
  });

  it("sends 0 to bearing 0 — north-up is north-up under any convention", () => {
    const map = makeMap();

    setCameraRotation(map as unknown as MapLibreMap, 0);

    // `-0`, and MapLibre reads it as 0. Compared numerically rather than with
    // Object.is, because the sign of zero is not the claim being made.
    expect(map.setBearing.mock.calls[0]?.[0]).toBeCloseTo(0, 10);
  });

  it("agrees with the RT-2 anchor angle, which is the whole point", () => {
    // RT-2 writes `angle = -bearing` on bbox anchors, derived independently
    // from this. If the two ever disagree, the compass needle points one way
    // and the annotations turn the other. Asserting the identity here is
    // cheaper than discovering it on screen.
    const map = makeMap();
    const eastAngleDeg = 137;

    setCameraRotation(map as unknown as MapLibreMap, eastAngleDeg);

    const bearing = map.setBearing.mock.calls[0]?.[0] as number;
    expect(-bearing).toBe(eastAngleDeg);
  });
});
