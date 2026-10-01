// SPDX-License-Identifier: AGPL-3.0-only
//
// A stand-in for MapLibre's map with real Web Mercator math: project,
// unproject, zoom, centre and bearing, at pitch 0. Tests that need a map whose
// pixels mean what MapLibre's mean use it.
//
// Shared by several test files. Per .claude/rules/test-fixtures.md: do not
// change it to fix one test; extend it in a subclass in that test.

const TILE_SIZE = 512;
const MAX_LAT = 84;
const MIN_ZOOM = 0.5;
const MAX_ZOOM = 22;

export class FakeMercatorMap {
  zoom: number;
  center: { lng: number; lat: number };
  /**
   * Compass direction the camera faces, degrees clockwise from north — the
   * same convention as MapLibre's `getBearing()`. At bearing θ the map content
   * appears rotated by −θ on screen, so facing east puts east at the top.
   */
  bearing = 0;
  readonly containerW = 1024;
  readonly containerH = 768;

  constructor(zoom: number, center: { lng: number; lat: number }) {
    this.zoom = zoom;
    this.center = center;
  }

  /** Rotate a screen-space delta by `deg` degrees, y-down. */
  private rotate(
    dx: number,
    dy: number,
    deg: number,
  ): { x: number; y: number } {
    if (deg === 0) {
      return { x: dx, y: dy };
    }
    const a = (deg * Math.PI) / 180;
    const cos = Math.cos(a);
    const sin = Math.sin(a);
    return { x: dx * cos - dy * sin, y: dx * sin + dy * cos };
  }

  private worldSize(): number {
    return TILE_SIZE * Math.pow(2, this.zoom);
  }

  private toWorld(lng: number, lat: number): { x: number; y: number } {
    const s = this.worldSize();
    const x = ((lng + 180) / 360) * s;
    const latRad = (lat * Math.PI) / 180;
    const yMerc = Math.log(Math.tan(Math.PI / 4 + latRad / 2));
    const y = (0.5 - yMerc / (2 * Math.PI)) * s;
    return { x, y };
  }

  project(lngLat: [number, number]): { x: number; y: number } {
    const c = this.toWorld(this.center.lng, this.center.lat);
    const p = this.toWorld(lngLat[0], lngLat[1]);
    const r = this.rotate(p.x - c.x, p.y - c.y, -this.bearing);
    return {
      x: r.x + this.containerW / 2,
      y: r.y + this.containerH / 2,
    };
  }

  unproject(pt: [number, number]): { lng: number; lat: number } {
    const s = this.worldSize();
    const c = this.toWorld(this.center.lng, this.center.lat);
    const r = this.rotate(
      pt[0] - this.containerW / 2,
      pt[1] - this.containerH / 2,
      this.bearing,
    );
    const wx = r.x + c.x;
    const wy = r.y + c.y;
    const lng = (wx / s) * 360 - 180;
    const lat =
      ((2 * Math.atan(Math.exp((0.5 - wy / s) * 2 * Math.PI)) - Math.PI / 2) *
        180) /
      Math.PI;
    return { lng, lat };
  }

  getZoom(): number {
    return this.zoom;
  }

  getCenter(): { lng: number; lat: number } {
    return this.center;
  }

  getBearing(): number {
    return this.bearing;
  }

  setBearing(deg: number): void {
    this.bearing = deg;
  }

  setZoom(z: number): void {
    this.zoom = Math.min(MAX_ZOOM, Math.max(MIN_ZOOM, z));
  }

  panByScreen(dx: number, dy: number): void {
    const next = this.unproject([
      this.containerW / 2 + dx,
      this.containerH / 2 + dy,
    ]);
    this.center = {
      lng: next.lng,
      lat: Math.min(MAX_LAT, Math.max(-MAX_LAT, next.lat)),
    };
  }
}
