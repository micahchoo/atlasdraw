// packages/basemap/src/cameraRotation.ts
// SPDX-License-Identifier: MIT
// No view may rotate the map unless it gives a way back to north.
//
// MapLibre enables every rotation gesture by default. A view with no compass
// and no resetNorth lets a user twist the map and then gives no way to
// straighten it without a page reload.
//
// So rotation is off by default, and a view turns it back on only if it ships
// a way back to north. The editor does, with its compass (MapCompass); the
// embed does not, and stays locked.
//
// Three gestures, and only one of them can be turned off at construction:
//
//   dragRotate            right-drag / ctrl-drag    `dragRotate: false`
//   touchZoomRotate       two-finger twist          disableRotation()
//   keyboard              shift + arrow keys        disableRotation()
//
// The two `disableRotation()` calls exist precisely because the blunt
// `disable()` would take pinch-zoom and arrow-key panning down with them.
// Verified against the maplibre-gl 6.11.2 source (src/ui/handler/keyboard.ts,
// src/ui/handler/shim/two_fingers_touch.ts):
//   TwoFingersTouchZoomRotate — `disableRotation()` disables `_touchRotate`
//     only; `_touchZoom` is untouched.
//   Keyboard — `_rotationDisabled` zeroes the bearing and pitch deltas and
//     leaves the pan and zoom deltas alone. (Its docstring claims it disables
//     "keyboard pan/rotate"; the code disagrees with the docstring.)
//
import type { Map as MapLibreMap } from "maplibre-gl";

/**
 * Turn off every rotation gesture, leaving pan and zoom intact.
 *
 * Safe to call more than once, and safe to call after MapLibre handlers have
 * been blanket-re-enabled (EmbedView's `?lock=1` cleanup does exactly that).
 */
export function disableCameraRotation(map: MapLibreMap): void {
  map.dragRotate?.disable?.();
  map.touchZoomRotate?.disableRotation?.();
  map.keyboard?.disableRotation?.();
}

/**
 * Turn rotation back on for a view that ships a way back to north. The hazard
 * is a user *stuck* in a rotated view, not rotation itself.
 *
 * **Two of the three gestures, deliberately.** `dragRotate` stays off. It is
 * bound to right-drag and ctrl-drag, and right-click belongs to Excalidraw's
 * context menu over the whole plate; taking it for the camera would cost a
 * menu to buy a gesture the compass already provides. So the mouse rotates
 * from the compass, the trackpad and touchscreen from a two-finger twist, and
 * the keyboard from shift+arrows.
 *
 * Safe to call more than once, and safe to pair with
 * {@link disableCameraRotation} in either order.
 */
export function enableCameraRotation(map: MapLibreMap): void {
  map.touchZoomRotate?.enableRotation?.();
  map.keyboard?.enableRotation?.();
}

/**
 * Put a freshly constructed map into the rotation state its view asked for.
 *
 * Always disables first, then re-enables if allowed, so the result does not
 * depend on which gestures MapLibre happened to construct enabled. `allow`
 * defaults off: a view earns rotation by shipping a compass, and forgetting
 * the argument
 * cannot accidentally grant it.
 */
export function applyRotationPolicy(map: MapLibreMap, allow: boolean): void {
  disableCameraRotation(map);
  if (allow) {
    enableCameraRotation(map);
  }
}

/**
 * Turn the camera to put a given screen rotation on geographic east.
 *
 * `degrees` is the screen angle of geographic east, y-down, 0 when north-up:
 * the angle the drawing layer is turned by. Passing 0 is exactly north-up.
 *
 * The conversion: MapLibre defines bearing as the compass direction that is
 * "up" on screen, so at bearing 90 (east is up) east points along screen
 * (0, -1), which is -90°. Hence `bearing = -degrees`.
 */
export function setCameraRotation(map: MapLibreMap, degrees: number): void {
  map.setBearing(-degrees);
}
