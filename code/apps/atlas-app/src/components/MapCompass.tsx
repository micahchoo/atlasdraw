// SPDX-License-Identifier: AGPL-3.0-only
//
// MapCompass — RT-3. The way back to north, and the only mouse affordance for
// getting away from it.
//
// This control is why rotation can ship at all. FU-14 / RT-0 was not "the map
// rotates"; it was "the map rotates and nothing brings it back". Click resets
// north, drag rotates, and the needle shows the current angle — so no camera
// state is reachable that the user cannot see and cannot undo.
//
// **Drag, not right-drag.** MapLibre's `dragRotate` (right-drag / ctrl-drag)
// stays disabled: right-click belongs to Excalidraw's context menu across the
// whole plate. The dial is the mouse gesture instead. Two-finger twist and
// shift+arrows come from MapLibre's own handlers, re-enabled by
// `allowRotation` on MapCanvas.
//
// **The needle reads the measurement, not the bearing.** `rotation` comes from
// useCameraRotation, which measures the screen angle of geographic east off
// the live projection. The needle, the bbox anchors (RT-2) and the printed
// north arrow (RT-4) therefore all turn off one number and cannot disagree —
// including if MapLibre's bearing sign convention is the opposite of what we
// assume. Only `setCameraRotation` speaks bearing, and only when the user
// drags.

import { useCallback, useRef } from "react";

import { setCameraRotation } from "@atlasdraw/basemap";

import styles from "../styles/MapCompass.module.css";

import type { CameraRotation } from "../hooks/useCameraRotation";
import type { KeyboardEvent, PointerEvent } from "react";
import type maplibregl from "maplibre-gl";

/** Degrees per arrow-key press while the compass has focus. */
const KEY_STEP_DEG = 5;
/** Degrees per shift+arrow press — the coarse step, for crossing the dial. */
const KEY_STEP_COARSE_DEG = 45;

/**
 * Pointer travel, in pixels, below which a press is a click and not a drag.
 *
 * Without it every click on the dial is also a one-pixel rotation, and the
 * reset-north click gets swallowed by the drag it accidentally started — the
 * control would then have no way back to north, which is the entire defect it
 * exists to close.
 */
const DRAG_SLOP_PX = 3;

/**
 * Wrap to (-180, 180].
 *
 * Applied to each incremental drag delta, where it keeps the accumulator
 * bounded as a drag crosses atan2's branch cut at ±180°. It is NOT what makes
 * the drag correct — an unwrapped delta is off by exactly ±360, and both the
 * accumulator and MapLibre's bearing are read modulo a full turn, so the
 * camera would land in the same place either way. It is here so the number we
 * carry stays the size of the angle it represents.
 */
function wrapDeg(deg: number): number {
  return deg - 360 * Math.round(deg / 360);
}

export interface MapCompassProps {
  map: maplibregl.Map | null;
  rotation: CameraRotation;
}

export function MapCompass({ map, rotation }: MapCompassProps) {
  // Drag state. Refs, not state: these change per pointer event and none of
  // them is rendered — the needle is driven by `rotation` coming back from the
  // map, so the control shows what the camera actually did rather than what we
  // asked it to do.
  const targetRef = useRef(0);
  const lastAngleRef = useRef(0);
  const originRef = useRef({ x: 0, y: 0 });
  const travelRef = useRef(0);
  const draggingRef = useRef(false);

  /** Pointer angle around the dial centre, degrees, y-down — the same frame
   * `rotation.degrees` is in, so a drag delta is a rotation delta directly. */
  const pointerAngle = useCallback(
    (el: HTMLElement, clientX: number, clientY: number): number => {
      const r = el.getBoundingClientRect();
      const dx = clientX - (r.left + r.width / 2);
      const dy = clientY - (r.top + r.height / 2);
      return (Math.atan2(dy, dx) * 180) / Math.PI;
    },
    [],
  );

  const onPointerDown = useCallback(
    (e: PointerEvent<HTMLButtonElement>) => {
      if (!map || e.button !== 0) {
        return;
      }
      const el = e.currentTarget;
      el.setPointerCapture(e.pointerId);
      draggingRef.current = true;
      travelRef.current = 0;
      targetRef.current = rotation.degrees;
      lastAngleRef.current = pointerAngle(el, e.clientX, e.clientY);
      originRef.current = { x: e.clientX, y: e.clientY };
    },
    [map, rotation.degrees, pointerAngle],
  );

  const onPointerMove = useCallback(
    (e: PointerEvent<HTMLButtonElement>) => {
      if (!map || !draggingRef.current) {
        return;
      }
      const { x, y } = originRef.current;
      travelRef.current = Math.max(
        travelRef.current,
        Math.hypot(e.clientX - x, e.clientY - y),
      );
      const angle = pointerAngle(e.currentTarget, e.clientX, e.clientY);
      // Accumulate wrapped increments rather than differencing against the
      // start angle: a single drag can pass ±180° several times.
      targetRef.current += wrapDeg(angle - lastAngleRef.current);
      lastAngleRef.current = angle;
      if (travelRef.current >= DRAG_SLOP_PX) {
        setCameraRotation(map, targetRef.current);
      }
    },
    [map, pointerAngle],
  );

  const endDrag = useCallback((e: PointerEvent<HTMLButtonElement>) => {
    if (e.currentTarget.hasPointerCapture(e.pointerId)) {
      e.currentTarget.releasePointerCapture(e.pointerId);
    }
    draggingRef.current = false;
  }, []);

  const onClick = useCallback(() => {
    // A drag ends with a click on the same element — pointer capture retargets
    // mouseup to the button, so the click lands here even when the pointer is
    // released far outside the 40px dial. Resetting north on it would undo the
    // drag the moment the user finished it.
    //
    // Known residual: if a drag ends WITHOUT a click (a pointercancel, say),
    // the flag survives and the next click is the one that clears it — costing
    // one press. A timer would close that, and is not worth carrying for a
    // path that costs a single click in a case the user has already been
    // interrupted out of.
    if (travelRef.current >= DRAG_SLOP_PX) {
      travelRef.current = 0;
      return;
    }
    map?.resetNorth();
  }, [map]);

  const onKeyDown = useCallback(
    (e: KeyboardEvent<HTMLButtonElement>) => {
      if (!map) {
        return;
      }
      // Rotation from the keyboard without needing the map canvas focused.
      // MapLibre's own shift+arrows work too (allowRotation re-enables them),
      // but they require focus to be on the map, and the plate's top layer is
      // Excalidraw's canvas.
      const step = e.shiftKey ? KEY_STEP_COARSE_DEG : KEY_STEP_DEG;
      if (e.key === "ArrowLeft") {
        e.preventDefault();
        setCameraRotation(map, rotation.degrees - step);
      } else if (e.key === "ArrowRight") {
        e.preventDefault();
        setCameraRotation(map, rotation.degrees + step);
      } else if (e.key === "Home") {
        e.preventDefault();
        map.resetNorth();
      }
    },
    [map, rotation.degrees],
  );

  // Degrees the *map* is turned, spoken the way a person reads a compass:
  // clockwise from north. `rotation.degrees` is the screen angle of east, so
  // the map's clockwise turn is its negation.
  const shownDeg = Math.round(wrapDeg(-rotation.degrees));

  return (
    <button
      type="button"
      className={styles.compass}
      data-testid="map-compass"
      data-rotated={rotation.isRotated ? "true" : undefined}
      disabled={!map}
      aria-label={
        rotation.isRotated
          ? `Map rotated ${shownDeg}° from north. Click to reset north; arrow keys to rotate.`
          : "Map is north-up. Drag or use arrow keys to rotate."
      }
      onPointerDown={onPointerDown}
      onPointerMove={onPointerMove}
      onPointerUp={endDrag}
      onPointerCancel={endDrag}
      onClick={onClick}
      onKeyDown={onKeyDown}
      onContextMenu={(e) => e.preventDefault()}
    >
      {/* The needle points north. `rotate(r)` on an up-pointing needle sends
        it to (sin r, -cos r) in y-down screen space, which is exactly where
        north is — the same frame flip print-pdf's north arrow resolves.

        Filled half north, hollow half south — the map convention, and the
        reason there is no "N" letter: at 40px a legend character would be
        illegible and would need counter-rotating to stay upright. */}
      <svg
        className={styles.dial}
        viewBox="0 0 40 40"
        style={{ transform: `rotate(${rotation.degrees}deg)` }}
        aria-hidden="true"
      >
        <circle className={styles.ring} cx="20" cy="20" r="15.5" />
        {/* North half — filled. South half — hollow. The asymmetry is what
          makes the reading instant at a glance. */}
        <polygon
          className={styles.north}
          points="20,5.5 24.5,20 20,17 15.5,20"
        />
        <polygon
          className={styles.south}
          points="20,34.5 15.5,20 20,23 24.5,20"
        />
      </svg>
    </button>
  );
}

export default MapCompass;
