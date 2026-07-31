// packages/basemap/src/cameraRotation.ts
// SPDX-License-Identifier: MIT
// FU-14 / RT-0 — close the "rotated with no way back to north" defect.
//
// MapLibre enables every rotation gesture by default. Atlasdraw ships no
// compass, no NavigationControl and no resetNorth, and `bearing` round-trips
// through save/load (round-trip.test.ts) — so a user who twists the map
// cannot straighten it, and persists the twist. Until RT-3 lands a compass,
// rotation is off.
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
// RT-3 reverts this behind the compass it builds.

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
