// SPDX-License-Identifier: MIT
//
// A version 1 element without an anchor is placed where v1 drew it when the
// file was saved, not left in screen pixels beside the frame's origin.
//
// v1 kept an unanchored element in screen pixels. fixtures/v1-delhi.atlasdraw
// was saved with every element anchored, and its screen geometry is what v1
// drew at the save camera (migrate-world.test.ts). So an element stripped of
// its anchor must land where its anchor puts it: the anchored migration is
// the oracle.

import { readFileSync } from "fs";
import { resolve } from "path";

import JSZip from "jszip";
import { describe, expect, it } from "vitest";

import { toScene, type WorldFrame } from "@atlasdraw/geo";

import { migrate } from "../migrations.js";

type Raw = Record<string, unknown> & {
  id: string;
  x: number;
  y: number;
  width: number;
  height: number;
  angle?: number;
  strokeWidth?: number;
  points?: [number, number][];
  customData?: Record<string, unknown>;
};

const FIXTURE = resolve(__dirname, "fixtures/v1-delhi.atlasdraw");

async function stored() {
  const zip = await JSZip.loadAsync(readFileSync(FIXTURE));
  const text = async (name: string) => {
    const file = zip.file(name);
    if (!file) {
      throw new Error(`fixture has no ${name}`);
    }
    return file.async("string");
  };
  const manifest = JSON.parse(await text("manifest.json"));
  const scene = JSON.parse(await text("scene.excalidraw.json"));
  return {
    manifest: manifest as Record<string, unknown>,
    scene: (Array.isArray(scene) ? scene : scene.elements) as Raw[],
  };
}

/** The element without its v1 anchor and sync baselines. */
function unanchored(el: Raw): Raw {
  const { geo: _g, _lastSync: _s, ...rest } = el.customData ?? {};
  return { ...el, customData: rest };
}

const close = (a: number, b: number, scale: number) =>
  Math.abs(a - b) <= 1e-6 * Math.max(1, Math.abs(scale));

describe("v1 → v2: an element without an anchor", () => {
  // id1: a box with its own turn; id4: a line; id6: a freehand stroke.
  it.each(["id1", "id4", "id6"])(
    "%s lands where its anchor puts it",
    async (id) => {
      const doc = await stored();
      const want = migrate(doc).scene.find((e) => (e as Raw).id === id) as Raw;
      const got = migrate({
        ...doc,
        scene: doc.scene.map((e) => (e.id === id ? unanchored(e) : e)),
      }).scene.find((e) => (e as Raw).id === id) as Raw;

      // A scene unit is about 1/1000 px at the save zoom; compare in units
      // scaled to the element's size.
      const size = Math.max(want.width, want.height);
      expect(close(got.x, want.x, size), "x").toBe(true);
      expect(close(got.y, want.y, size), "y").toBe(true);
      expect(close(got.width, want.width, size), "width").toBe(true);
      expect(close(got.height, want.height, size), "height").toBe(true);
      expect(got.angle ?? 0).toBeCloseTo(want.angle ?? 0, 9);
      expect(close(got.strokeWidth!, want.strokeWidth!, 1)).toBe(true);
      (want.points ?? []).forEach(([px, py], i) => {
        expect(close(got.points![i][0], px, size), `point ${i}`).toBe(true);
        expect(close(got.points![i][1], py, size), `point ${i}`).toBe(true);
      });
      expect(
        (got.customData as { atlas?: { unit?: number } }).atlas?.unit,
      ).toBeCloseTo(Math.pow(2, 22 - 13.3), 6);
    },
  );

  it("with no anchored box, lands at the saved camera's centre and zoom", () => {
    const camera = { center: [77.2, 28.6], zoom: 12, bearing: 0, pitch: 0 };
    const out = migrate({
      manifest: { version: 1, camera, layers: [] },
      scene: [
        {
          id: "a",
          type: "rectangle",
          x: 0,
          y: 0,
          width: 100,
          height: 50,
          angle: 0,
          strokeWidth: 2,
        },
      ],
    });
    const world = out.manifest.world as WorldFrame;
    const [a] = out.scene as Raw[];
    const s = Math.pow(2, 22 - 12);
    // The screen's top-left corner lands on the camera's centre.
    const c = toScene(world, 77.2, 28.6);
    expect(world.z0).toBe(22);
    expect(a.x).toBeCloseTo(c.x, 6);
    expect(a.y).toBeCloseTo(c.y, 6);
    expect([a.width, a.height, a.strokeWidth]).toEqual([
      100 * s,
      50 * s,
      2 * s,
    ]);
    expect((a.customData as { atlas: { unit: number } }).atlas.unit).toBe(s);
  });
});
