/**
 * useCameraRotation — how far the camera is turned, as React state.
 *
 * RT-3/RT-9. Nothing in the app read the live camera rotation before this: the
 * only `getBearing()` calls in the tree were two test mocks returning 0. The
 * compass needs it to draw, and RT-9's drawing gate needs it to decide.
 *
 * It reports `cameraRotation(map)` — the *measured* screen rotation of
 * geographic east — rather than `map.getBearing()`, for the reason RT-2
 * established: nobody has run this app, and measuring means no code has to be
 * right about MapLibre's bearing sign convention. The compass, the annotation
 * anchors and the printed north arrow then all turn off the same number, so
 * they cannot disagree with each other even if that convention is the opposite
 * of what we assume.
 *
 * Subscribed to `rotate` alone. Pitch is impossible (`maxPitch: 0`), and pan
 * and zoom cannot change the rotation of east on screen under Mercator, so the
 * broader `move` this could have piggybacked on would only add re-renders.
 */

import { useEffect, useState } from "react";

import { cameraRotation } from "@atlasdraw/geo";

import type maplibregl from "maplibre-gl";

/**
 * Rotations closer to north than this read as north.
 *
 * Two things need the tolerance. `cameraRotation` measures rather than reads,
 * so it returns float noise rather than a clean 0 even for a camera sitting at
 * bearing 0. And `resetNorth` animates: the last frames before it settles are
 * a hair off, and a drawing gate that flickers back on a frame early is worse
 * than one that rounds. 0.01° is far below anything a user can see or aim at.
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
  const degrees = (cameraRotation(map) * 180) / Math.PI;
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
