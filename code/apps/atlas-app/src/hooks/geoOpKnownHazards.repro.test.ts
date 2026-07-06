/**
 * Minimal repros for the failure classes A–F found by the geo-op sequence
 * fuzzer (geoOpSequence.fuzz.test.ts) on its first run, 2026-07-05 — FIXED
 * the same day by the `_lastSync` protocol overhaul in `reanchorIfMoved` /
 * `CoordinateSync._projectElement`. These are now permanent regression
 * tests; a new open bug class gets an `it.fails` repro here plus a
 * signature in KNOWN_FAILURES until its fix lands.
 *
 * Sequences are minimized fuzzer output with rounded parameters. Root-cause
 * analysis lives in `.claude/skills/geo-op-idempotency-hunt/SKILL.md`
 * (hazard list) and seeds issues atlasdraw-c1d6/720b/311a/e58e/6623/fa09.
 */
import { describe, it, expect } from "vitest";

import { generateSequence, runSequence, type Op } from "./geoOpFuzz.harness";

const INIT = { zoom: 10, center: { lng: -122.4, lat: 37.77 } };

const createRect: Op = {
  t: "create",
  kind: "rect",
  px: 400,
  py: 300,
  w: 120,
  h: 80,
};
const createText: Op = {
  t: "create",
  kind: "text",
  px: 400,
  py: 300,
  w: 100,
  h: 40,
};
const createFreedraw: Op = {
  t: "create",
  kind: "freedraw",
  px: 400,
  py: 300,
  w: 120,
  h: 100,
};

function expectClean(ops: Op[]): void {
  const { violation } = runSequence(ops, INIT);
  expect(violation?.message ?? null).toBeNull();
}

describe("geo-op hazard regression repros (classes A-F, fixed 2026-07-05)", () => {
  it("A: moving a polyline survives the next camera sync (reanchorIfMoved never compares x/y for polylines)", () => {
    expectClean([createFreedraw, { t: "move", i: 0, dx: -20, dy: 200 }]);
  });

  it("A-paste: a pasted polyline keeps its pasted position instead of snapping onto the source", () => {
    expectClean([createFreedraw, { t: "paste", i: 0 }]);
  });

  it("B: undo of a move is not defeated by an immediate re-anchor (re-anchor is a separate history entry)", () => {
    expectClean([
      createRect,
      { t: "move", i: 0, dx: -215, dy: -199 },
      { t: "undo" },
    ]);
  });

  it("C: a user strokeWidth change survives the next camera sync (style fields have no baseline update path)", () => {
    expectClean([createRect, { t: "style", i: 0, f: 0.5 }]);
  });

  it("D: resizing a point-kind (text) element survives the next camera sync (width change invisible to reanchorIfMoved)", () => {
    expectClean([createText, { t: "resize", i: 0, f: 1.5 }]);
  });

  it("D-compound: move after zoom does not re-adopt scaled width as the w0 baseline", () => {
    expectClean([
      createText,
      { t: "zoom", dz: 0.55 },
      { t: "move", i: 0, dx: -127, dy: -47 },
    ]);
  });

  it("E: pure camera zoom never rewrites the anchor of a screen-mode element (partial _lastSync forces geo-space fallback)", () => {
    expectClean([
      createRect,
      { t: "toggleScale", i: 0, mode: "screen" },
      { t: "zoom", dz: -1.16 },
    ]);
  });

  it("C/D user-report: shrinking a shape after zooming does not make the stroke jump on later camera moves", () => {
    // Symptom as reported: "making a drawn object smaller or bigger — the
    // stroke size changes differently than the object size". The NEUTRAL-VIS
    // invariant checks strokeWidth stability after every op.
    expectClean([
      createRect,
      { t: "zoom", dz: 2 },
      { t: "resize", i: 0, f: 0.5 },
      { t: "pan", dx: 120, dy: 60 },
      { t: "zoom", dz: -1 },
    ]);
  });

  it("C/D user-report: growing a freedraw after zooming out keeps stroke proportional to camera, not to stale baselines", () => {
    expectClean([
      createFreedraw,
      { t: "zoom", dz: -2 },
      { t: "resize", i: 0, f: 2 },
      { t: "pan", dx: -200, dy: 40 },
      { t: "zoom", dz: 1.5 },
    ]);
  });

  it("F: toggling to hybrid beyond the clamp range does not pop the size on the next sync", () => {
    expectClean([
      createText,
      { t: "zoom", dz: -2.75 },
      { t: "toggleScale", i: 0, mode: "hybrid" },
    ]);
  });
});

describe("class G — world-wrap at the ±180 seam (OPEN: it.fails until a world-edge policy lands)", () => {
  // renderWorldCopies is false and minZoom is unset, so geometry can sit
  // beyond the world edge; normalizeLng wraps those anchors to the far side
  // and projection jumps by a world width. Sequences reproduced from fuzzer
  // seeds — deterministic via generateSequence.
  it.fails(
    "G: drawing past the world edge does not teleport the anchor (seed 79)",
    () => {
      const { ops, init } = generateSequence(79);
      const { violation } = runSequence(ops, init);
      expect(violation?.message ?? null).toBeNull();
    },
  );

  it.fails(
    "G: polyline resize near the seam at extreme zoom-out stays put (seed 496)",
    () => {
      const { ops, init } = generateSequence(496);
      const { violation } = runSequence(ops, init);
      expect(violation?.message ?? null).toBeNull();
    },
  );
});
