// packages/basemap/src/cameraRotation.ts
// SPDX-License-Identifier: MIT
// FU-14 / RT-0 — close the "rotated with no way back to north" defect.
//
// MapLibre enables every rotation gesture by default, and Atlasdraw shipped no
// compass and no resetNorth — so a user who twisted the map could not
// straighten it again without reloading the page. (An earlier version of this
// comment said the twist also persisted through save/load. It did not: nothing
// reads `map.getBearing()` and `MapCanvasInitialView` has no bearing field, so
// the format carries a bearing the app never writes or applies. The defect was
// session-scoped.)
//
// So rotation is off by default, and a view turns it back on only if it ships
// a way back to north. The editor does, via RT-3's compass; the embed does not,
// and stays locked.
//
// Three gestures, and only one of them can be turned off at construction:
//
//   dragRotate            right-drag / ctrl-drag    `dragRotate: false`
//   touchZoomRotate       two-finger twist          disableRotation()
//   keyboard              shift + arrow keys        disableRotation()
//
// The two `disableRotation()` calls exist precisely because the blunt
// `disable()` would take pinch-zoom and arrow-key panning down with them.
// Verified against the shipped maplibre-gl 4.7.1 bundle:
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
 * Turn rotation back on for a view that ships a way back to north — RT-0 is a
 * defect about being *stuck*, not about rotation existing.
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
 * defaults off: FU-14 is the defect of being turned with no way back, so a
 * view earns rotation by shipping a compass, and forgetting the argument
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
 * `degrees` is in the same frame `cameraRotation()` reports: the screen angle
 * of geographic east, y-down, 0 when north-up. Passing 0 is exactly north-up.
 *
 * **This is the one place in the app that depends on MapLibre's bearing sign
 * convention, and that is on purpose.** Every *geometry* consumer — the bbox
 * anchors (RT-2), the printed north arrow (RT-4), the compass needle — measures
 * the rotation off the live projection instead of reading `getBearing()`, so
 * being wrong about the convention cannot silently misplace anything. But a
 * control has to speak the setter's language, and `setBearing` is the only
 * setter there is. Confining the conversion here means the convention has one
 * site, and getting it wrong turns the map the wrong way from the drag —
 * visible on the first frame, not silent.
 *
 * The conversion: MapLibre defines bearing as the compass direction that is
 * "up" on screen, so at bearing 90 (east is up) east points along screen
 * (0, -1) and `cameraRotation` reports -90°. Hence `bearing = -degrees`.
 */
export function setCameraRotation(map: MapLibreMap, degrees: number): void {
  map.setBearing(-degrees);
}
