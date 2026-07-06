/**
 * geoOpFuzz.harness — deterministic sequence fuzzer for the drawing↔map
 * interaction layer. Phase 2b of `.claude/skills/geo-op-idempotency-hunt`.
 *
 * Generates random operation sequences from the real channel set (create,
 * camera zoom/pan, user move/resize/style, paste, undo, scale-mode toggle)
 * and asserts the layer's invariants after every step, against the REAL
 * `buildGeoAnchorHandler` and `CoordinateSync` implementations.
 *
 * Model of the app loop, at the factory level:
 *  - `FakeMercatorMap` — real Web Mercator math so project/unproject are
 *    exact inverses. Table-driven mocks (CoordinateSync.test.ts style) can't
 *    support random sequences.
 *  - `SceneStore` — models `updateScene` + captureUpdate semantics: camera
 *    syncs pass `captureUpdate:"NEVER"` and are invisible to undo; geo-anchor
 *    handler commits are captured. Undo restores the scene at a capture
 *    boundary — which is exactly how "undo lands between a user op and its
 *    re-anchor" happens in the real app.
 *  - `settle()` — re-runs the geo-anchor onChange handler until it stops
 *    writing, simulating cascaded onChange passes.
 *
 * Known approximations vs. the real app (revisit before trusting a finding
 * that smells model-induced): no 16ms camera throttle, onChange passes run
 * sequentially rather than interleaved, and undo restores whole-scene
 * snapshots at capture boundaries rather than Excalidraw's per-field deltas.
 */

import { CoordinateSync } from "@atlasdraw/basemap";

import type { GeoCustomData } from "@atlasdraw/geo";
import type { ExcalidrawImperativeAPI } from "@atlasdraw/excalidraw";

import { buildGeoAnchorHandler } from "./useGeoAnchor";

import type maplibregl from "maplibre-gl";

// ---------------------------------------------------------------------------
// Fake MapLibre map with real Web Mercator math
// ---------------------------------------------------------------------------

const TILE_SIZE = 512;
const MAX_LAT = 84;
const MIN_ZOOM = 0.5;
const MAX_ZOOM = 22;

export class FakeMercatorMap {
  zoom: number;
  center: { lng: number; lat: number };
  readonly containerW = 1024;
  readonly containerH = 768;

  constructor(zoom: number, center: { lng: number; lat: number }) {
    this.zoom = zoom;
    this.center = center;
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
    return {
      x: p.x - c.x + this.containerW / 2,
      y: p.y - c.y + this.containerH / 2,
    };
  }

  unproject(pt: [number, number]): { lng: number; lat: number } {
    const s = this.worldSize();
    const c = this.toWorld(this.center.lng, this.center.lat);
    const wx = pt[0] - this.containerW / 2 + c.x;
    const wy = pt[1] - this.containerH / 2 + c.y;
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

// ---------------------------------------------------------------------------
// Scene store with captureUpdate-aware history
// ---------------------------------------------------------------------------

export interface FuzzEl {
  id: string;
  type: string;
  x: number;
  y: number;
  width: number;
  height: number;
  points?: Array<[number, number]>;
  fontSize?: number;
  strokeWidth?: number;
  isDeleted?: boolean;
  customData?: Record<string, unknown>;
}

function clone<T>(v: T): T {
  return structuredClone(v);
}

export class SceneStore {
  elements: FuzzEl[] = [];
  /** Scene snapshots at capture boundaries (pre-commit states). */
  history: FuzzEl[][] = [];
  dirtyCount = 0;

  readonly api = {
    getSceneElements: (): FuzzEl[] => this.elements,
    updateScene: (opts: {
      elements: unknown;
      captureUpdate?: string;
    }): void => {
      if (opts.captureUpdate !== "NEVER") {
        this.history.push(clone(this.elements));
      }
      this.elements = opts.elements as FuzzEl[];
      this.dirtyCount++;
    },
  };

  /** A user gesture is its own captured commit. */
  commitUserOp(next: FuzzEl[]): void {
    this.history.push(clone(this.elements));
    this.elements = next;
  }

  undo(): boolean {
    const prev = this.history.pop();
    if (!prev) {
      return false;
    }
    this.elements = prev;
    return true;
  }
}

// ---------------------------------------------------------------------------
// World = map + store + the real implementations under test
// ---------------------------------------------------------------------------

export interface FuzzWorld {
  map: FakeMercatorMap;
  store: SceneStore;
  sync: CoordinateSync;
  handler: (
    elements: readonly FuzzEl[],
    appState: { newElement: unknown | null },
  ) => void;
}

export function makeWorld(
  zoom: number,
  center: { lng: number; lat: number },
): FuzzWorld {
  const map = new FakeMercatorMap(zoom, center);
  const store = new SceneStore();
  const sync = new CoordinateSync({
    map: map as unknown as maplibregl.Map,
    // eslint-disable-next-line @typescript-eslint/no-explicit-any
    excalidrawAPI: store.api as any,
  });
  const handler = buildGeoAnchorHandler(
    map as unknown as maplibregl.Map,
    store.api as unknown as ExcalidrawImperativeAPI,
  ) as unknown as FuzzWorld["handler"];
  return { map, store, sync, handler };
}

export class FuzzViolation extends Error {
  constructor(
    readonly invariant: string,
    readonly detail: string,
    readonly opIndex: number,
    readonly op: Op | null,
    readonly elId?: string,
    readonly elKind?: string,
    readonly elScaleMode?: string,
  ) {
    super(
      `[${invariant}] op#${opIndex} ${op ? op.t : "-"} el=${elId ?? "-"} ` +
        `kind=${elKind ?? "-"} mode=${elScaleMode ?? "-"}: ${detail}`,
    );
  }

  get signature(): string {
    return `${this.invariant}|${this.op?.t ?? "-"}|${this.elKind ?? "-"}|${
      this.elScaleMode ?? "-"
    }`;
  }
}

/**
 * Run the geo-anchor onChange handler until it stops writing.
 * Returns the number of dirty passes. Throws CONVERGE when it ping-pongs.
 */
export function settle(w: FuzzWorld, opIndex: number, op: Op | null): number {
  let passes = 0;
  for (let i = 0; i < 6; i++) {
    const before = w.store.dirtyCount;
    w.handler(w.store.elements, { newElement: null });
    if (w.store.dirtyCount === before) {
      return passes;
    }
    passes++;
  }
  throw new FuzzViolation(
    "CONVERGE",
    "onChange handler still dirty after 6 passes (ping-pong)",
    opIndex,
    op,
  );
}

// ---------------------------------------------------------------------------
// Operations
// ---------------------------------------------------------------------------

export type Op =
  | {
      t: "create";
      kind: "rect" | "text" | "freedraw";
      px: number;
      py: number;
      w: number;
      h: number;
    }
  | { t: "zoom"; dz: number }
  | { t: "pan"; dx: number; dy: number }
  | { t: "zoomRT"; dz: number }
  | { t: "move"; i: number; dx: number; dy: number }
  | { t: "resize"; i: number; f: number }
  | { t: "style"; i: number; f: number }
  | { t: "paste"; i: number }
  | { t: "undo" }
  | { t: "toggleScale"; i: number; mode: "geographic" | "screen" | "hybrid" };

const CAMERA_OPS = new Set(["zoom", "pan", "zoomRT"]);

let elSeq = 0;

function makeElement(op: Extract<Op, { t: "create" }>): FuzzEl {
  const id = `el-${++elSeq}`;
  if (op.kind === "text") {
    return {
      id,
      type: "text",
      x: op.px,
      y: op.py,
      width: op.w,
      height: op.h,
      fontSize: 20,
      strokeWidth: 1,
    };
  }
  if (op.kind === "freedraw") {
    return {
      id,
      type: "freedraw",
      x: op.px,
      y: op.py,
      width: op.w,
      height: op.h,
      strokeWidth: 2,
      points: [
        [0, 0],
        [op.w * 0.4, op.h * 0.7],
        [op.w, op.h],
      ],
    };
  }
  return {
    id,
    type: "rectangle",
    x: op.px,
    y: op.py,
    width: op.w,
    height: op.h,
    strokeWidth: 2,
  };
}

function geoOf(el: FuzzEl): GeoCustomData["geo"] | undefined {
  return (el.customData as GeoCustomData | undefined)?.geo;
}

function scaleModeOf(el: FuzzEl): string | undefined {
  return (el.customData as GeoCustomData | undefined)?.scaleMode;
}

function pickAnchored(w: FuzzWorld, i: number): FuzzEl | null {
  const anchored = w.store.elements.filter((el) => geoOf(el) !== undefined);
  if (anchored.length === 0) {
    return null;
  }
  return anchored[Math.abs(i) % anchored.length];
}

function replaceEl(els: FuzzEl[], next: FuzzEl): FuzzEl[] {
  return els.map((e) => (e.id === next.id ? next : e));
}

// ---------------------------------------------------------------------------
// Visual snapshot + comparison
// ---------------------------------------------------------------------------

const VIS_EPS = 1e-3;

interface Vis {
  x: number;
  y: number;
  width: number;
  height: number;
  fontSize?: number;
  strokeWidth?: number;
  points?: Array<[number, number]>;
}

function visOf(el: FuzzEl): Vis {
  return {
    x: el.x,
    y: el.y,
    width: el.width,
    height: el.height,
    fontSize: el.fontSize,
    strokeWidth: el.strokeWidth,
    points: el.points ? el.points.map((p) => [p[0], p[1]]) : undefined,
  };
}

function numDiff(a: number | undefined, b: number | undefined): number {
  if (a === undefined && b === undefined) {
    return 0;
  }
  if (a === undefined || b === undefined) {
    return Infinity;
  }
  return Math.abs(a - b);
}

function visDelta(a: Vis, b: Vis): string | null {
  const fields: Array<[string, number]> = [
    ["x", numDiff(a.x, b.x)],
    ["y", numDiff(a.y, b.y)],
    ["width", numDiff(a.width, b.width)],
    ["height", numDiff(a.height, b.height)],
    ["fontSize", numDiff(a.fontSize, b.fontSize)],
    ["strokeWidth", numDiff(a.strokeWidth, b.strokeWidth)],
  ];
  for (const [name, d] of fields) {
    if (d > VIS_EPS) {
      return `${name} drifted by ${d.toFixed(4)}px`;
    }
  }
  const ap = a.points;
  const bp = b.points;
  if ((ap === undefined) !== (bp === undefined)) {
    return "points presence changed";
  }
  if (ap && bp) {
    if (ap.length !== bp.length) {
      return `points length ${ap.length} → ${bp.length}`;
    }
    for (let i = 0; i < ap.length; i++) {
      const d = Math.max(
        numDiff(ap[i][0], bp[i][0]),
        numDiff(ap[i][1], bp[i][1]),
      );
      if (d > VIS_EPS) {
        return `points[${i}] drifted by ${d.toFixed(4)}px`;
      }
    }
  }
  return null;
}

function approxDeepEqual(a: unknown, b: unknown, eps = 1e-9): boolean {
  if (typeof a === "number" && typeof b === "number") {
    return Math.abs(a - b) <= eps;
  }
  if (
    a === null ||
    b === null ||
    typeof a !== "object" ||
    typeof b !== "object"
  ) {
    return a === b;
  }
  const ka = Object.keys(a as object).filter(
    (k) => (a as Record<string, unknown>)[k] !== undefined,
  );
  const kb = Object.keys(b as object).filter(
    (k) => (b as Record<string, unknown>)[k] !== undefined,
  );
  if (ka.length !== kb.length) {
    return false;
  }
  return ka.every((k) =>
    approxDeepEqual(
      (a as Record<string, unknown>)[k],
      (b as Record<string, unknown>)[k],
      eps,
    ),
  );
}

// ---------------------------------------------------------------------------
// Sequence execution with invariant checks
// ---------------------------------------------------------------------------

/**
 * Execute one op against the world, then check invariants:
 *
 *  GEO-STABLE      camera-only ops never change `customData.geo` (checked by
 *                  object identity — reanchorIfMoved returns the same element
 *                  when it declines, and _projectElement spreads customData).
 *  UNDO-GEO        undo + settle never invents a geo anchor different from
 *                  the restored snapshot's (no spurious re-anchor fight).
 *  ZOOM-RT         zoom +dz then -dz restores screen geometry.
 *  NEUTRAL-VIS     syncMapToScene with an UNCHANGED camera is a visual no-op.
 *  NEUTRAL-REANCHOR a camera-neutral sync never triggers a re-anchor pass.
 *  IDEMPOTENT      a second camera-neutral sync produces a byte-identical
 *                  scene (customData included).
 *  CONVERGE        the onChange handler reaches a fixed point in ≤6 passes.
 */
export function executeOp(w: FuzzWorld, op: Op, opIndex: number): void {
  const geoRefsBefore = new Map<string, unknown>(
    w.store.elements.map((el) => [el.id, geoOf(el)]),
  );

  let undoRestoredGeo: Map<string, unknown> | null = null;
  let zoomRTBefore: Map<string, Vis> | null = null;
  const zoomBefore = w.map.getZoom();

  switch (op.t) {
    case "create": {
      w.store.commitUserOp([...w.store.elements, makeElement(op)]);
      break;
    }
    case "zoom": {
      w.map.setZoom(w.map.getZoom() + op.dz);
      w.sync.syncMapToScene();
      break;
    }
    case "pan": {
      w.map.panByScreen(op.dx, op.dy);
      w.sync.syncMapToScene();
      break;
    }
    case "zoomRT": {
      zoomRTBefore = new Map(w.store.elements.map((el) => [el.id, visOf(el)]));
      w.map.setZoom(zoomBefore + op.dz);
      w.sync.syncMapToScene();
      settle(w, opIndex, op);
      w.map.setZoom(zoomBefore);
      w.sync.syncMapToScene();
      break;
    }
    case "move": {
      const el = pickAnchored(w, op.i);
      if (!el) {
        return;
      }
      w.store.commitUserOp(
        replaceEl(w.store.elements, {
          ...el,
          x: el.x + op.dx,
          y: el.y + op.dy,
        }),
      );
      break;
    }
    case "resize": {
      const el = pickAnchored(w, op.i);
      if (!el) {
        return;
      }
      const next: FuzzEl = {
        ...el,
        width: Math.max(2, el.width * op.f),
        height: Math.max(2, el.height * op.f),
      };
      if (el.points) {
        next.points = el.points.map((p) => [p[0] * op.f, p[1] * op.f]);
      }
      w.store.commitUserOp(replaceEl(w.store.elements, next));
      break;
    }
    case "style": {
      const el = pickAnchored(w, op.i);
      if (!el) {
        return;
      }
      const next: FuzzEl = { ...el };
      if (el.type === "text" && el.fontSize !== undefined) {
        next.fontSize = el.fontSize * op.f;
      } else if (el.strokeWidth !== undefined) {
        next.strokeWidth = el.strokeWidth * op.f;
      } else {
        return;
      }
      w.store.commitUserOp(replaceEl(w.store.elements, next));
      break;
    }
    case "paste": {
      const el = pickAnchored(w, op.i);
      if (!el || w.store.elements.length >= 15) {
        return;
      }
      const copy = clone(el);
      copy.id = `el-${++elSeq}`;
      copy.x += 25;
      copy.y += 25;
      w.store.commitUserOp([...w.store.elements, copy]);
      break;
    }
    case "undo": {
      if (!w.store.undo()) {
        return;
      }
      undoRestoredGeo = new Map(
        w.store.elements
          .filter((el) => geoOf(el) !== undefined)
          .map((el) => [el.id, clone(geoOf(el))]),
      );
      break;
    }
    case "toggleScale": {
      const el = pickAnchored(w, op.i);
      if (!el) {
        return;
      }
      const cd = el.customData as GeoCustomData;
      w.store.commitUserOp(
        replaceEl(w.store.elements, {
          ...el,
          customData: { ...cd, scaleMode: op.mode },
        }),
      );
      break;
    }
  }

  settle(w, opIndex, op);

  const violate = (invariant: string, detail: string, el?: FuzzEl): never => {
    throw new FuzzViolation(
      invariant,
      detail,
      opIndex,
      op,
      el?.id,
      el ? geoOf(el)?.kind ?? el.type : undefined,
      el ? scaleModeOf(el) : undefined,
    );
  };

  // GEO-STABLE: camera ops must not touch anchors (identity check).
  if (CAMERA_OPS.has(op.t)) {
    for (const el of w.store.elements) {
      const before = geoRefsBefore.get(el.id);
      if (before !== undefined && geoOf(el) !== before) {
        violate("GEO-STABLE", "camera-only op rewrote customData.geo", el);
      }
    }
  }

  // UNDO-GEO: settle after undo must not re-anchor away from the snapshot.
  if (undoRestoredGeo) {
    for (const el of w.store.elements) {
      const restored = undoRestoredGeo.get(el.id);
      if (restored !== undefined && !approxDeepEqual(geoOf(el), restored)) {
        violate(
          "UNDO-GEO",
          `restored anchor ${JSON.stringify(restored)} became ${JSON.stringify(
            geoOf(el),
          )}`,
          el,
        );
      }
    }
  }

  // ZOOM-RT: screen geometry restored after zoom out-and-back.
  if (zoomRTBefore) {
    for (const el of w.store.elements) {
      const before = zoomRTBefore.get(el.id);
      if (!before || geoOf(el) === undefined) {
        continue;
      }
      const delta = visDelta(before, visOf(el));
      if (delta) {
        violate("ZOOM-RT", delta, el);
      }
    }
  }

  // Camera-neutral sync: must be a visual no-op, no re-anchor, idempotent.
  const visBefore = new Map(w.store.elements.map((el) => [el.id, visOf(el)]));
  const geoRefsNeutral = new Map(
    w.store.elements.map((el) => [el.id, geoOf(el)]),
  );
  w.sync.syncMapToScene();
  const neutralPasses = settle(w, opIndex, op);
  for (const el of w.store.elements) {
    const before = geoRefsNeutral.get(el.id);
    if (before !== undefined && geoOf(el) !== before) {
      violate(
        "NEUTRAL-REANCHOR",
        "camera-neutral sync triggered a re-anchor",
        el,
      );
    }
  }
  if (neutralPasses > 0) {
    violate(
      "NEUTRAL-REANCHOR",
      `camera-neutral sync needed ${neutralPasses} settle passes`,
    );
  }
  // Undo legitimately leaves stale screen coords for the next sync to fix
  // (camera changes are captureUpdate:"NEVER", invisible to history), so the
  // visual no-op claim only applies to non-undo ops.
  if (op.t !== "undo") {
    for (const el of w.store.elements) {
      const before = visBefore.get(el.id);
      if (!before || geoOf(el) === undefined) {
        continue;
      }
      const delta = visDelta(before, visOf(el));
      if (delta) {
        violate(
          "NEUTRAL-VIS",
          `camera-neutral sync moved the element: ${delta}`,
          el,
        );
      }
    }
  }
  const sceneAfterFirst = clone(w.store.elements);
  w.sync.syncMapToScene();
  settle(w, opIndex, op);
  for (const el of w.store.elements) {
    const prev = sceneAfterFirst.find((e) => e.id === el.id);
    if (!approxDeepEqual(el, prev)) {
      violate("IDEMPOTENT", "second camera-neutral sync changed the scene", el);
    }
  }
}

export interface RunResult {
  violation: FuzzViolation | null;
}

export function runSequence(
  ops: Op[],
  init: { zoom: number; center: { lng: number; lat: number } },
): RunResult {
  const w = makeWorld(init.zoom, init.center);
  for (let i = 0; i < ops.length; i++) {
    try {
      executeOp(w, ops[i], i);
    } catch (e) {
      if (e instanceof FuzzViolation) {
        return { violation: e };
      }
      throw e;
    }
  }
  return { violation: null };
}

/**
 * Greedy shrink: repeatedly drop any single op whose removal preserves the
 * violation's invariant class. Ops resolve element indices modulo the live
 * element count, so removal never breaks well-formedness.
 */
export function shrinkSequence(
  ops: Op[],
  init: { zoom: number; center: { lng: number; lat: number } },
  invariant: string,
): { ops: Op[]; violation: FuzzViolation } {
  let current = ops;
  let violation = runSequence(current, init).violation!;
  let changed = true;
  while (changed) {
    changed = false;
    for (let i = 0; i < current.length; i++) {
      const candidate = [...current.slice(0, i), ...current.slice(i + 1)];
      const r = runSequence(candidate, init);
      if (r.violation && r.violation.invariant === invariant) {
        current = candidate;
        violation = r.violation;
        changed = true;
        break;
      }
    }
  }
  return { ops: current, violation };
}

// ---------------------------------------------------------------------------
// Deterministic generator (mulberry32 — no Math.random, reproducible by seed)
// ---------------------------------------------------------------------------

export function mulberry32(seed: number): () => number {
  let a = seed >>> 0;
  return () => {
    a |= 0;
    a = (a + 0x6d2b79f5) | 0;
    let t = Math.imul(a ^ (a >>> 15), 1 | a);
    t = (t + Math.imul(t ^ (t >>> 7), 61 | t)) ^ t;
    return ((t ^ (t >>> 14)) >>> 0) / 4294967296;
  };
}

export function generateSequence(seed: number): {
  ops: Op[];
  init: { zoom: number; center: { lng: number; lat: number } };
} {
  const rnd = mulberry32(seed);
  const range = (lo: number, hi: number) => lo + rnd() * (hi - lo);
  const int = (n: number) => Math.floor(rnd() * n);
  const sign = () => (rnd() < 0.5 ? -1 : 1);

  const init = {
    zoom: range(3, 17),
    center: { lng: range(-150, 150), lat: range(-60, 60) },
  };

  const kinds = ["rect", "text", "freedraw"] as const;
  const modes = ["geographic", "screen", "hybrid"] as const;
  const create = (): Op => ({
    t: "create",
    kind: kinds[int(3)],
    px: range(100, 800),
    py: range(100, 600),
    w: range(20, 200),
    h: range(20, 160),
  });

  const ops: Op[] = [create()];
  const len = 6 + int(10);
  for (let i = 0; i < len; i++) {
    const r = rnd();
    if (r < 0.18) {
      ops.push(create());
    } else if (r < 0.34) {
      ops.push({ t: "zoom", dz: sign() * range(0.5, 3) });
    } else if (r < 0.5) {
      ops.push({
        t: "pan",
        dx: sign() * range(20, 400),
        dy: sign() * range(20, 300),
      });
    } else if (r < 0.64) {
      ops.push({
        t: "move",
        i: int(16),
        dx: sign() * range(5, 300),
        dy: sign() * range(5, 250),
      });
    } else if (r < 0.74) {
      ops.push({ t: "resize", i: int(16), f: range(0.4, 2.5) });
    } else if (r < 0.8) {
      ops.push({ t: "style", i: int(16), f: range(0.5, 2.2) });
    } else if (r < 0.87) {
      ops.push({ t: "paste", i: int(16) });
    } else if (r < 0.94) {
      ops.push({ t: "undo" });
    } else if (r < 0.98) {
      ops.push({ t: "toggleScale", i: int(16), mode: modes[int(3)] });
    } else {
      ops.push({ t: "zoomRT", dz: range(1, 5) });
    }
  }
  return { ops, init };
}
