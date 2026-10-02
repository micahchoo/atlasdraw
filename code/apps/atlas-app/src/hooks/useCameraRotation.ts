/**
 * useCameraRotation — how far the camera is turned, as React state.
 *
 * The compass draws from it, the drawing gate decides from it, and the
 * drawing layer is turned by the same angle (useCameraBridge), so all three
 * agree.
 *
 * The angle is the screen rotation of geographic east, y-down: MapLibre's
 * bearing is the compass direction at the top of the screen, so east sits at
 * `-bearing`. `cameraRotationRoundTrip.test.ts` checks that sign against a
 * real Mercator projection.
 *
 * Subscribed to `rotate` alone. Pitch is impossible (`maxPitch: 0`), and pan
 * and zoom cannot change the rotation of east on screen under Mercator.
 */

import { useEffect, useState } from "react";

import type * as maplibregl from "maplibre-gl";

/**
 * Rotations closer to north than this read as north. `resetNorth` animates:
 * the last frames before it settles are a hair off, and a drawing gate that
 * flickers back on a frame early is worse than one that rounds. 0.01° is far
 * below anything a user can see or aim at.
 */
const NORTH_EPSILON_DEG = 0.01;

export interface CameraRotation {
  /** Screen rotation of geographic east, degrees, y-down. 0 when north-up. */
  degrees: number;
  /** True when the camera is turned far enough for it to matter. */
  isRotated: boolean;
}

const NORTH_UP: CameraRotation = { degrees: 0, isRotated: false };

/** Read the rotation off a map, snapping near-north to exactly north. */
function read(map: maplibregl.Map): CameraRotation {
  const degrees = -map.getBearing();
  if (Math.abs(degrees) < NORTH_EPSILON_DEG) {
    return NORTH_UP;
  }
  return { degrees, isRotated: true };
}

/**
 * @param map - The MapLibre map, or null before it is ready.
 * @returns The current rotation; north-up while `map` is null.
 */
export function useCameraRotation(map: maplibregl.Map | null): CameraRotation {
  const [rotation, setRotation] = useState<CameraRotation>(NORTH_UP);

  useEffect(() => {
    if (!map) {
      // A map going away leaves the last rotation stuck in state, which would
      // hold the drawing gate shut against a map that no longer exists.
      setRotation(NORTH_UP);
      return;
    }
    const update = () => {
      setRotation((prev) => {
        const next = read(map);
        // `rotate` fires per frame through a drag. Re-rendering the gate and
        // the compass on an unchanged value is pure waste.
        return prev.degrees === next.degrees ? prev : next;
      });
    };
    // Seed synchronously: a map handed over mid-rotation (or an editor
    // remounting over a live map) must not render one frame as north-up and
    // let a click through the drawing gate.
    update();
    map.on("rotate", update);
    return () => {
      map.off("rotate", update);
    };
  }, [map]);

  return rotation;
}
