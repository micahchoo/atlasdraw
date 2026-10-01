// SPDX-License-Identifier: AGPL-3.0-only
//
// ADR-0015 spike — measures criteria 1-5 in a real browser.
//
//   cd code/apps/atlas-app && npx vite --port 5293 --strictPort &
//   node scripts/spike-world-coords.mjs [--json out.json]
//
// Modes (all on the same dev server, chosen by query string):
//   main  — scroll lock + CoordinateSync, the layer-registry gate OFF: main as it is
//   lock  — scroll lock + CoordinateSync, with the registry gate (P0 applied)
//   world — ?world=1: camera bridge, world coordinates
//
// Pan frame time is the requestAnimationFrame delta while every frame moves
// the map by (4, 1) px with `panBy({animate:false})` — the same synchronous
// `move` cascade a drag produces, without input-timing noise.

/* eslint-disable no-console -- a measurement script: its output is the console. */

import fs from "node:fs";

import { chromium } from "playwright";

const BASE = process.env.SPIKE_URL ?? "http://localhost:5293/";
const SIZES = (process.env.SPIKE_SIZES ?? "0,1000,5000").split(",").map(Number);
const FRAMES = Number(process.env.SPIKE_FRAMES ?? 300);
const RUNS = Number(process.env.SPIKE_RUNS ?? 3);
// A run stops early past this budget: main at 5,000 shapes takes seconds a frame.
const BUDGET_MS = Number(process.env.SPIKE_BUDGET_MS ?? 30_000);

const MODES = {
  main: "?registryGate=0",
  lock: "",
  world: "?world=1",
  world22: "?world=1&z0=22",
};

function pct(xs, p) {
  const s = [...xs].sort((a, b) => a - b);
  return s[Math.min(s.length - 1, Math.floor((p / 100) * s.length))];
}
function summary(xs) {
  const mean = xs.reduce((a, b) => a + b, 0) / xs.length;
  return {
    n: xs.length,
    mean: +mean.toFixed(2),
    p50: +pct(xs, 50).toFixed(2),
    p95: +pct(xs, 95).toFixed(2),
    p99: +pct(xs, 99).toFixed(2),
    max: +Math.max(...xs).toFixed(2),
  };
}

async function open(browser, mode, extra = "") {
  const page = await browser.newPage({
    viewport: { width: 1280, height: 800 },
  });
  const errors = [];
  page.on("pageerror", (e) => errors.push(e.message));
  await page.goto(BASE + MODES[mode] + extra);
  await page.waitForFunction(
    (world) =>
      window.__atlasdraw__ &&
      (!world || window.__atlasdraw__.cameraBridge) &&
      window.__atlasdraw__.map.loaded(),
    mode.startsWith("world"),
    { timeout: 90_000 },
  );
  // Let boot-time onChange traffic settle.
  await page.waitForTimeout(1500);
  // The first-run tour lays a scrim over the plate; dismiss it.
  const skip = page.getByRole("button", { name: "Skip" });
  if (await skip.isVisible().catch(() => false)) {
    await skip.click();
    await page.waitForTimeout(300);
  }
  return { page, errors };
}

/** In-page: pan `frames` frames, collect rAF deltas and element-array churn. */
async function pan(page, frames, dx, dy) {
  return page.evaluate(
    async ([frames, dx, dy, budget]) => {
      const started = performance.now();
      const a = window.__atlasdraw__;
      let prev = a.excalidrawAPI.getSceneElementsIncludingDeleted();
      let arrayChanges = 0;
      let onChanges = 0;
      const unsub = a.excalidrawAPI.onChange((els) => {
        onChanges++;
        if (els !== prev) {
          arrayChanges++;
          prev = els;
        }
      });
      const deltas = [];
      await new Promise((resolve) => {
        let i = 0;
        let last = 0;
        const step = () => {
          const now = performance.now();
          if (i > 0) {
            deltas.push(now - last);
          }
          last = now;
          if (i++ >= frames || now - started > budget) {
            resolve();
            return;
          }
          a.map.panBy([dx, dy], { animate: false });
          requestAnimationFrame(step);
        };
        requestAnimationFrame(step);
      });
      // Let throttled trailing work land before counting.
      await new Promise((r) => setTimeout(r, 100));
      unsub();
      return { deltas, arrayChanges, onChanges };
    },
    [frames, dx, dy, BUDGET_MS],
  );
}

function snapshot(page) {
  return page.evaluate(() =>
    Object.fromEntries(
      window.__atlasdraw__.excalidrawAPI
        .getSceneElementsIncludingDeleted()
        .map((e) => [e.id, [e.version, e.x, e.y, e.width, e.height]]),
    ),
  );
}

function changed(before, after) {
  let versions = 0;
  let geometry = 0;
  for (const [id, b] of Object.entries(before)) {
    const a = after[id];
    if (!a) {
      continue;
    }
    if (a[0] !== b[0]) {
      versions++;
    }
    if (a[1] !== b[1] || a[2] !== b[2] || a[3] !== b[3] || a[4] !== b[4]) {
      geometry++;
    }
  }
  return { versions, geometry, total: Object.keys(before).length };
}

/** Criteria 1 and 2 for one mode and size. */
async function panCase(browser, mode, n) {
  const { page, errors } = await open(browser, mode);
  const seeded = n
    ? await page.evaluate((n) => window.__atlasdraw__.seed(n), n)
    : 0;
  await page.waitForTimeout(1000);
  await page.evaluate(() => window.__atlasdraw__.clearDirty());
  const before = await snapshot(page);
  await pan(page, 60, 4, 1); // warm-up
  const all = [];
  let arrayChanges = 0;
  let onChanges = 0;
  for (let r = 0; r < RUNS; r++) {
    const out = await pan(page, FRAMES, r % 2 ? -4 : 4, r % 2 ? -1 : 1);
    all.push(...out.deltas);
    arrayChanges += out.arrayChanges;
    onChanges += out.onChanges;
  }
  // And zoom: four steps in, four out.
  await page.evaluate(async () => {
    const m = window.__atlasdraw__.map;
    for (const dz of [0.5, 0.5, 0.5, 0.5, -0.5, -0.5, -0.5, -0.5]) {
      m.jumpTo({ zoom: m.getZoom() + dz });
      await new Promise((r) => requestAnimationFrame(r));
    }
  });
  await page.waitForTimeout(300);
  const after = await snapshot(page);
  const dirty = await page.evaluate(() => window.__atlasdraw__.isDirty());
  await page.close();
  return {
    mode,
    n: seeded,
    frame: summary(all),
    arrayChanges,
    onChanges,
    writes: changed(before, after),
    dirtyAfterPanAndZoom: dirty,
    errors,
  };
}

/** Criterion 4: how many bridge updates one camera move costs. */
async function bridgeCase(browser) {
  const { page, errors } = await open(browser, "world");
  await page.evaluate(() => window.__atlasdraw__.seed(1000));
  const out = {};
  const measure = async (label, fn) => {
    await page.evaluate(() => window.__atlasdraw__.cameraBridge.resetStats());
    await fn();
    await page.waitForTimeout(400);
    out[label] = await page.evaluate(() => ({
      ...window.__atlasdraw__.cameraBridge.stats,
    }));
  };
  // One synchronous map move.
  await measure("one map.panBy", () =>
    page.evaluate(() =>
      window.__atlasdraw__.map.panBy([120, 40], { animate: false }),
    ),
  );
  // One animated map move: MapLibre fires `move` once per frame.
  await measure("one animated easeTo (move events counted)", () =>
    page.evaluate(async () => {
      const m = window.__atlasdraw__.map;
      let moves = 0;
      const on = () => moves++;
      m.on("move", on);
      await new Promise((r) => {
        m.once("moveend", r);
        m.easeTo({
          center: [m.getCenter().lng + 2, m.getCenter().lat],
          zoom: m.getZoom() + 1,
          duration: 500,
        });
      });
      m.off("move", on);
      window.__moves = moves;
    }),
  );
  out["one animated easeTo (move events counted)"].moveEvents =
    await page.evaluate(() => window.__moves);
  // A real mouse drag on the map.
  await measure("mouse drag on map, 20 steps", async () => {
    await page.getByTestId("toolbar-hand").click({ force: true });
    await page.mouse.move(600, 400);
    await page.mouse.down();
    await page.mouse.move(800, 450, { steps: 20 });
    await page.mouse.up();
  });
  // Excalidraw-originated: scroll to content (Excalidraw's own viewport move).
  await measure("excalidraw scrollToContent", () =>
    page.evaluate(() =>
      window.__atlasdraw__.excalidrawAPI.scrollToContent(undefined, {
        fitToContent: false,
      }),
    ),
  );
  await measure("excalidraw scrollToContent fitToContent", () =>
    page.evaluate(() =>
      window.__atlasdraw__.excalidrawAPI.scrollToContent(undefined, {
        fitToContent: true,
      }),
    ),
  );
  // Excalidraw-originated: space-drag with a drawing tool active.
  await measure("space+drag in Excalidraw, 20 steps", async () => {
    await page.getByTestId("toolbar-rectangle").click({ force: true });
    await page.mouse.move(600, 400);
    await page.keyboard.down("Space");
    await page.mouse.down();
    await page.mouse.move(700, 430, { steps: 20 });
    await page.mouse.up();
    await page.keyboard.up("Space");
    await page.getByTestId("toolbar-hand").click({ force: true });
  });
  // A wheel zoom over the map.
  await measure("wheel zoom, 5 notches", async () => {
    await page.mouse.move(640, 400);
    for (let i = 0; i < 5; i++) {
      await page.mouse.wheel(0, -100);
      await page.waitForTimeout(30);
    }
  });
  // Does the scene agree with the map after all of it?
  out.agreement = await page.evaluate(() => {
    const a = window.__atlasdraw__;
    const s = a.excalidrawAPI.getAppState();
    const f = a.cameraBridge.frame;
    let worst = 0;
    for (const [dx, dy] of [
      [0, 0],
      [300, 200],
      [-400, 150],
    ]) {
      const c = a.map.getContainer();
      const px = c.clientWidth / 2 + dx;
      const py = c.clientHeight / 2 + dy;
      const ll = a.map.unproject([px, py]);
      const p = a.toScene(f, ll.lng, ll.lat);
      const sx = (p.x + s.scrollX) * s.zoom.value;
      const sy = (p.y + s.scrollY) * s.zoom.value;
      worst = Math.max(worst, Math.hypot(sx - px, sy - py));
    }
    return { worstPx: worst };
  });
  out.errors = errors;
  await page.close();
  return out;
}

/** Criterion 3: draw, drag, pan, undo — where is the shape? */
async function undoCase(browser, mode) {
  const { page, errors } = await open(browser, mode);
  const place = () =>
    page.evaluate(() => {
      const a = window.__atlasdraw__;
      const el = a.excalidrawAPI
        .getSceneElements()
        .find((e) => e.type === "rectangle");
      if (!el) {
        return null;
      }
      if (a.worldCoords) {
        return a.toLngLat(a.cameraBridge.frame, { x: el.x, y: el.y });
      }
      const g = el.customData?.geo;
      return g ? { lng: g.west, lat: g.north } : { noAnchor: true };
    });
  // Draw a rectangle with the stock tool.
  await page.getByTestId("toolbar-rectangle").click({ force: true });
  await page.mouse.move(500, 300);
  await page.mouse.down();
  await page.mouse.move(620, 400, { steps: 8 });
  await page.mouse.up();
  await page.waitForTimeout(300);
  const drawn = await place();
  // Drag it 60 px right with the selection tool.
  await page.getByTestId("toolbar-selection").click({ force: true });
  // Grab the left edge: a transparent rectangle is hit on its stroke only.
  await page.mouse.move(500, 350);
  await page.mouse.down();
  await page.mouse.move(560, 350, { steps: 8 });
  await page.mouse.up();
  await page.waitForTimeout(300);
  const dragged = await place();
  // Pan the map 200 px.
  await page.evaluate(() =>
    window.__atlasdraw__.map.panBy([200, 0], { animate: false }),
  );
  await page.waitForTimeout(300);
  // Undo, from the canvas.
  await page.keyboard.press("Control+z");
  await page.waitForTimeout(500);
  const undone = await place();
  const px = await page.evaluate(
    ([a, b]) => {
      if (!a || !b || a.noAnchor || b.noAnchor) {
        return null;
      }
      const m = window.__atlasdraw__.map;
      const pa = m.project([a.lng, a.lat]);
      const pb = m.project([b.lng, b.lat]);
      return Math.hypot(pa.x - pb.x, pa.y - pb.y);
    },
    [drawn, undone],
  );
  await page.close();
  return { mode, drawn, dragged, undone, pxFromDrawnAfterUndo: px, errors };
}

/** Criterion 5: every map zoom 0..22 under the bridge. */
async function zoomCase(browser, z0) {
  const { page, errors } = await open(browser, "world", `&z0=${z0}`);
  const out = await page.evaluate(async () => {
    const a = window.__atlasdraw__;
    const f = a.cameraBridge.frame;
    const rows = [];
    const raf = () =>
      new Promise((r) => requestAnimationFrame(() => requestAnimationFrame(r)));
    const canvas = document.querySelector("canvas.excalidraw__canvas.static");
    const ctx = canvas.getContext("2d");
    const dpr = window.devicePixelRatio || 1;
    for (let z = 0; z <= 22; z++) {
      a.map.jumpTo({ zoom: z, center: [78.5, 22] });
      await raf();
      const s = a.excalidrawAPI.getAppState();
      const want = Math.pow(2, a.map.getZoom() - f.z0);
      // A 200-px solid square at the map centre, made at this zoom.
      const c = a.map.getContainer();
      const cx = c.clientWidth / 2;
      const cy = c.clientHeight / 2;
      const ll = a.map.unproject([cx, cy]);
      const p = a.toScene(f, ll.lng, ll.lat);
      const size = 200 / s.zoom.value;
      // A plain element literal: no constructor is on window.
      const probe = {
        id: `zoom-probe-${z}`,
        type: "rectangle",
        x: p.x - size / 2,
        y: p.y - size / 2,
        width: size,
        height: size,
        angle: 0,
        strokeColor: "#000000",
        backgroundColor: "#ff0000",
        fillStyle: "solid",
        strokeWidth: 1 / s.zoom.value,
        strokeStyle: "solid",
        roughness: 0,
        opacity: 100,
        groupIds: [],
        frameId: null,
        roundness: null,
        seed: 1,
        version: 1,
        versionNonce: 1,
        index: null,
        isDeleted: false,
        boundElements: null,
        updated: 1,
        link: null,
        locked: false,
      };
      a.excalidrawAPI.updateScene({ elements: [probe] });
      await raf();
      await raf();
      const alphaAt = (dx) =>
        ctx.getImageData(
          Math.round((cx + dx) * dpr),
          Math.round(cy * dpr),
          1,
          1,
        ).data[3];
      const px = ctx.getImageData(
        Math.round(cx * dpr),
        Math.round(cy * dpr),
        1,
        1,
      ).data;
      // The square's right edge is at +100 px: sharp means opaque at +97 and
      // clear at +103. A capped element canvas shows as a ramp across it.
      const edge = [90, 97, 103, 110].map(alphaAt);
      rows.push({
        z: +a.map.getZoom().toFixed(3),
        zoomValue: s.zoom.value,
        exact: s.zoom.value === want,
        centreRed: px[0] > 200 && px[1] < 60 && px[3] > 200,
        edgeAlpha: edge,
        sharp: edge[0] > 240 && edge[1] > 240 && edge[2] < 15 && edge[3] < 15,
      });
    }
    return { z0: f.z0, rows };
  });
  out.errors = errors;
  await page.close();
  return out;
}

// The real GPU: SwiftShader puts MapLibre's own frame cost on the CPU and
// drowns the difference being measured.
const browser = await chromium.launch({
  args: [
    "--enable-gpu",
    "--ignore-gpu-blocklist",
    "--use-angle=gl",
    // SPIKE_UNCAPPED=1: no vsync, so a rAF delta is the frame's real cost
    // rather than a multiple of 16.7 ms.
    ...(process.env.SPIKE_UNCAPPED === "1"
      ? ["--disable-gpu-vsync", "--disable-frame-rate-limit"]
      : []),
  ],
});
const results = { when: new Date().toISOString(), frames: FRAMES, runs: RUNS };
const only = process.env.SPIKE_ONLY?.split(",");
const want = (k) => !only || only.includes(k);
if (want("pan")) {
  results.pan = [];
  for (const n of SIZES) {
    for (const mode of (
      process.env.SPIKE_MODES ?? "main,lock,world,world22"
    ).split(",")) {
      const r = await panCase(browser, mode, n);
      console.log(JSON.stringify(r));
      results.pan.push(r);
    }
  }
}
if (want("bridge")) {
  results.bridge = await bridgeCase(browser);
  console.log(JSON.stringify(results.bridge, null, 1));
}
if (want("undo")) {
  results.undo = [];
  for (const mode of ["lock", "world"]) {
    const r = await undoCase(browser, mode);
    console.log(JSON.stringify(r));
    results.undo.push(r);
  }
}
if (want("zoom")) {
  results.zoom = [];
  for (const z0 of (process.env.SPIKE_Z0 ?? "4,12,22").split(",").map(Number)) {
    const r = await zoomCase(browser, z0);
    console.log(
      `z0=${r.z0} sharp at z: ${r.rows
        .filter((x) => x.sharp)
        .map((x) => x.z)
        .join(",")}` +
        ` | NOT sharp at z: ${r.rows
          .filter((x) => !x.sharp)
          .map((x) => `${x.z}${JSON.stringify(x.edgeAlpha)}`)
          .join(" ")}` +
        ` | zoom exact everywhere: ${r.rows.every((x) => x.exact)} errors=${
          r.errors.length
        }`,
    );
    results.zoom.push(r);
  }
}
await browser.close();
const jsonAt = process.argv.indexOf("--json");
if (jsonAt > 0) {
  fs.writeFileSync(process.argv[jsonAt + 1], JSON.stringify(results, null, 1));
}
