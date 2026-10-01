// SPDX-License-Identifier: MIT
// ADR-0015 spike — the world frame.
//
// A scene coordinate is a Web Mercator world pixel at the reference zoom `z0`
// (512-px tiles, as MapLibre uses), minus the frame's floating origin. The map
// camera becomes Excalidraw's scrollX / scrollY / zoom, and a camera move
// rewrites no element.
//
// Pure functions, no MapLibre: the camera is plain data. Bearing is not part of
// the viewport — it is a display rotation of the drawing layer about the
// viewport centre, and the centre is the same point either way.

/** MapLibre's tile size; world size at zoom z is `WORLD_TILE_SIZE * 2^z`. */
export const WORLD_TILE_SIZE = 512;

/** MapLibre clamps latitude here before it projects. */
export const MAX_MERCATOR_LAT = 85.051129;

export interface WorldFrame {
  /** Reference zoom: one scene unit is one map pixel at this zoom. */
  readonly z0: number;
  /** World pixel at z0 that is scene (0, 0). Integer, so it adds no error. */
  readonly origin: { readonly x: number; readonly y: number };
}

export interface MapCamera {
  readonly center: { readonly lng: number; readonly lat: number };
  readonly zoom: number;
  /** Viewport size in CSS px — the drawing layer's own size. */
  readonly width: number;
  readonly height: number;
}

export interface SceneViewport {
  readonly scrollX: number;
  readonly scrollY: number;
  readonly zoom: number;
}

export interface ScenePoint {
  readonly x: number;
  readonly y: number;
}

function clampLat(lat: number): number {
  return Math.max(-MAX_MERCATOR_LAT, Math.min(MAX_MERCATOR_LAT, lat));
}

/** World x in pixels at zoom z. Longitude is taken literally (no wrap). */
export function mercatorX(lng: number, z: number): number {
  return ((lng + 180) / 360) * WORLD_TILE_SIZE * Math.pow(2, z);
}

/** World y in pixels at zoom z, latitude clamped as MapLibre clamps it. */
export function mercatorY(lat: number, z: number): number {
  const r = (clampLat(lat) * Math.PI) / 180;
  return (
    (0.5 - Math.log(Math.tan(Math.PI / 4 + r / 2)) / (2 * Math.PI)) *
    WORLD_TILE_SIZE *
    Math.pow(2, z)
  );
}

function lngFromWorldX(x: number, z: number): number {
  return (x / (WORLD_TILE_SIZE * Math.pow(2, z))) * 360 - 180;
}

function latFromWorldY(y: number, z: number): number {
  const n = Math.PI * (1 - (2 * y) / (WORLD_TILE_SIZE * Math.pow(2, z)));
  return (Math.atan(Math.sinh(n)) * 180) / Math.PI;
}

/** A frame whose origin is (lng, lat) at the integer zoom nearest z. */
export function frameAt(lng: number, lat: number, z: number): WorldFrame {
  const z0 = Math.round(z);
  return {
    z0,
    origin: {
      x: Math.round(mercatorX(lng, z0)),
      y: Math.round(mercatorY(lat, z0)),
    },
  };
}

export function toScene(f: WorldFrame, lng: number, lat: number): ScenePoint {
  return {
    x: mercatorX(lng, f.z0) - f.origin.x,
    y: mercatorY(lat, f.z0) - f.origin.y,
  };
}

export function toLngLat(
  f: WorldFrame,
  p: ScenePoint,
): { lng: number; lat: number } {
  return {
    lng: lngFromWorldX(p.x + f.origin.x, f.z0),
    lat: latFromWorldY(p.y + f.origin.y, f.z0),
  };
}

/**
 * Excalidraw's viewport for a map camera. Excalidraw draws scene point p at
 * screen `(p + scroll) * zoom`, so the camera centre must land at W/2, H/2.
 */
export function viewportFor(f: WorldFrame, cam: MapCamera): SceneViewport {
  const zoom = Math.pow(2, cam.zoom - f.z0);
  const c = toScene(f, cam.center.lng, cam.center.lat);
  return {
    zoom,
    scrollX: cam.width / (2 * zoom) - c.x,
    scrollY: cam.height / (2 * zoom) - c.y,
  };
}

/** The map camera that shows what an Excalidraw viewport shows. */
export function cameraFor(
  f: WorldFrame,
  v: SceneViewport & { readonly width: number; readonly height: number },
): { center: { lng: number; lat: number }; zoom: number } {
  return {
    zoom: f.z0 + Math.log2(v.zoom),
    center: toLngLat(f, {
      x: v.width / (2 * v.zoom) - v.scrollX,
      y: v.height / (2 * v.zoom) - v.scrollY,
    }),
  };
}
