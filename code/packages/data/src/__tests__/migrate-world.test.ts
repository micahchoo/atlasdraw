// SPDX-License-Identifier: MIT
//
// A version 1 file opens in world coordinates, every element where v1 drew it.
//
// fixtures/v1-delhi.atlasdraw was written by the version 1 build itself
// (branch spike/world-coords, before W3): its elements were drawn in screen
// pixels at zoom 12, stamped by useGeoAnchor's handler, placed by the pin
// tool's seedToElement, projected by CoordinateSync, then saved by data.write
// with the camera at zoom 13.3 and bearing 25. Two rectangles carry the
// legacy `screen` and `hybrid` scale modes.
//
// fixtures/v1-delhi.expected.json is what v1 drew at that save camera, with
// every element geographic: the screen geometry this test compares against.

import { readFileSync } from "fs";
import { resolve } from "path";

import { describe, expect, it } from "vitest";

import { viewportFor } from "@atlasdraw/geo";

import type { WorldFrame } from "@atlasdraw/geo";

import { read } from "../atlasdraw.js";

interface Expected {
  camera: {
    center: { lng: number; lat: number };
    zoom: number;
    bearing: number;
    width: number;
    height: number;
  };
  legacyScaleModes: string[];
  elements: Array<{
    id: string;
    type: string;
    x: number;
    y: number;
    width: number;
    height: number;
    angle: number;
    points: Array<[number, number]> | null;
    strokeWidth: number;
    fontSize: number | null;
  }>;
}

type Pt = { x: number; y: number };
type Shape = {
  x: number;
  y: number;
  width: number;
  height: number;
  angle?: number;
  points?: ReadonlyArray<readonly [number, number]> | null;
};

const FIXTURES = resolve(__dirname, "fixtures");

function fixture(): Blob {
  return new Blob([
    readFileSync(resolve(FIXTURES, "v1-delhi.atlasdraw")) as BlobPart,
  ]);
}

const expected = JSON.parse(
  readFileSync(resolve(FIXTURES, "v1-delhi.expected.json"), "utf8"),
) as Expected;

function rotate(v: Pt, deg: number, cx: number, cy: number): Pt {
  const a = (deg * Math.PI) / 180;
  const cos = Math.cos(a);
  const sin = Math.sin(a);
  return { x: v.x * cos - v.y * sin + cx, y: v.x * sin + v.y * cos + cy };
}

/** The points Excalidraw draws: a linear element's points, or box corners. */
function drawn(el: Shape): Pt[] {
  if (el.points) {
    return el.points.map(([px, py]) => ({ x: el.x + px, y: el.y + py }));
  }
  const cx = el.x + el.width / 2;
  const cy = el.y + el.height / 2;
  const deg = ((el.angle ?? 0) * 180) / Math.PI;
  return [
    { x: el.x, y: el.y },
    { x: el.x + el.width, y: el.y },
    { x: el.x + el.width, y: el.y + el.height },
    { x: el.x, y: el.y + el.height },
  ].map((p) => rotate({ x: p.x - cx, y: p.y - cy }, deg, cx, cy));
}

/** Scene → screen as the editor shows it: the bridge's viewport, then the
 * drawing layer's CSS rotation about the map centre. */
function toScreen(frame: WorldFrame): (p: Pt) => Pt {
  const cam = expected.camera;
  const v = viewportFor(frame, cam);
  return (p) =>
    rotate(
      {
        x: (p.x + v.scrollX) * v.zoom - cam.width / 2,
        y: (p.y + v.scrollY) * v.zoom - cam.height / 2,
      },
      -cam.bearing,
      cam.width / 2,
      cam.height / 2,
    );
}

describe("v1 → v2: world coordinates", () => {
  it("stores a frame with z0 = 22 in the manifest", async () => {
    const doc = await read(fixture());
    expect(doc.manifest.version).toBe(2);
    expect(doc.manifest.world.z0).toBe(22);
    expect(Number.isInteger(doc.manifest.world.origin.x)).toBe(true);
    expect(Number.isInteger(doc.manifest.world.origin.y)).toBe(true);
  });

  it("removes every v1 key from customData and keeps the rest", async () => {
    const doc = await read(fixture());
    for (const el of doc.scene) {
      const cd = (el.customData ?? {}) as Record<string, unknown>;
      for (const key of [
        "geo",
        "_lastSync",
        "scaleMode",
        "projection",
        "schemaVersion",
      ]) {
        expect(cd).not.toHaveProperty(key);
      }
    }
    // Drawn at zoom 12: one screen pixel was 2^(22 - 12) scene units.
    const unit = Math.pow(2, 22 - 12);
    const [renamed, , hidden] = doc.scene;
    expect(renamed.customData).toEqual({
      atlas: { label: "Ward 3 boundary", unit },
    });
    expect(hidden.customData).toEqual({ atlas: { hidden: true, unit } });
  });

  it("records each element's pixel unit, for its arrowheads and dashes", async () => {
    const doc = await read(fixture());
    for (const el of doc.scene) {
      const atlas = (el.customData as { atlas?: { unit?: number } }).atlas;
      expect(atlas?.unit, el.id).toBe(Math.pow(2, 22 - 12));
    }
  });

  it("marks the pin, so export can give it as a point", async () => {
    const doc = await read(fixture());
    const pin = doc.scene[doc.scene.length - 1];
    expect(pin.type).toBe("ellipse");
    expect((pin.customData as Record<string, unknown>).tool).toBe("pin");
    expect((pin.customData as Record<string, unknown>)._data).toEqual({
      label: "Pin",
    });
  });

  it("draws every element within 1e-6 px of where v1 drew it", async () => {
    const doc = await read(fixture());
    const screen = toScreen(doc.manifest.world);
    const zoom = Math.pow(2, expected.camera.zoom - doc.manifest.world.z0);
    expect(doc.scene).toHaveLength(expected.elements.length);

    let worst = 0;
    const geographic = expected.elements.filter(
      (e) => !expected.legacyScaleModes.includes(e.id),
    );
    expect(geographic).toHaveLength(expected.elements.length - 2);
    for (const want of geographic) {
      const got = doc.scene.find((e) => e.id === want.id) as unknown as Shape &
        Record<string, unknown>;
      expect(got, want.id).toBeDefined();
      // v1 drew a point anchor upright under a turned camera (billboarded);
      // world turns it with the layer. Only its anchor corner compares.
      const isPoint = want.type === "text" || want.id === doc.scene.at(-1)?.id;
      const wantPts = isPoint ? [{ x: want.x, y: want.y }] : drawn(want);
      const gotPts = isPoint ? [{ x: got.x, y: got.y }] : drawn(got);
      expect(gotPts).toHaveLength(wantPts.length);
      for (let i = 0; i < gotPts.length; i++) {
        const s = screen(gotPts[i]);
        const err = Math.hypot(s.x - wantPts[i].x, s.y - wantPts[i].y);
        worst = Math.max(worst, err);
        expect(err, `${want.type} ${want.id} point ${i}`).toBeLessThan(1e-6);
      }
      expect(
        Math.abs((got.strokeWidth as number) * zoom - want.strokeWidth),
      ).toBeLessThan(1e-9);
      if (want.fontSize !== null) {
        expect(
          Math.abs((got.fontSize as number) * zoom - want.fontSize),
        ).toBeLessThan(1e-9);
      }
    }
    expect(worst).toBeLessThan(1e-6);
  });

  // v1 kept no `a0` (the user's own turn) for these two modes, so their saved
  // angle holds the camera's turn too. The migration takes it back out, using
  // a box that has both (savedCameraTurn).
  it("migrates screen and hybrid scale modes as geographic", async () => {
    const doc = await read(fixture());
    const screen = toScreen(doc.manifest.world);
    for (const id of expected.legacyScaleModes) {
      const want = expected.elements.find((e) => e.id === id)!;
      const got = doc.scene.find((e) => e.id === id) as unknown as Shape;
      const s = drawn(got).map(screen);
      drawn(want).forEach((p, i) => {
        expect(Math.hypot(s[i].x - p.x, s[i].y - p.y)).toBeLessThan(1e-6);
      });
    }
  });

  it("is idempotent: a migrated file read back is unchanged", async () => {
    const { write } = await import("../atlasdraw.js");
    const once = await read(fixture());
    const twice = await read(await write(once));
    expect(twice.manifest).toEqual(once.manifest);
    expect(twice.scene).toEqual(once.scene);
  });
});
