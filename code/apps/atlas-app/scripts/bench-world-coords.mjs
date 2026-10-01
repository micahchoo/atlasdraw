// SPDX-License-Identifier: AGPL-3.0-only
//
// World coordinates in a real browser (ADR-0015): pan frame time and writes
// at 0, 1,000 and 5,000 shapes, camera-bridge exchanges per input, and undo
// after a pan.
//
//   cd code/apps/atlas-app && npx vite --port 5297 --strictPort &
//   node scripts/bench-world-coords.mjs [--json out.json]
//
// Pan frame time is the requestAnimationFrame delta while every frame moves
// the map by (4, 1) px with `panBy({animate:false})` — the same synchronous
// `move` cascade a drag produces, without input-timing noise. Shapes come
// from the dev-only `__atlasdraw__.seed(n)` hook (lib/devSeedShapes.ts).
//
// Environment: BENCH_URL (default http://localhost:5297/), BENCH_SIZES,
// BENCH_FRAMES, BENCH_RUNS, BENCH_ONLY (pan,bridge,undo), BENCH_UNCAPPED=1
// (no vsync: a rAF delta is the frame's real cost).

/* eslint-disable no-console -- a measurement script: its output is the console. */

import fs from "node:fs";

import { chromium } from "playwright";

const BASE = process.env.BENCH_URL ?? "http://localhost:5297/";
const SIZES = (process.env.BENCH_SIZES ?? "0,1000,5000").split(",").map(Number);
const FRAMES = Number(process.env.BENCH_FRAMES ?? 300);
const RUNS = Number(process.env.BENCH_RUNS ?? 3);
// A run stops early past this budget.
const BUDGET_MS = Number(process.env.BENCH_BUDGET_MS ?? 30_000);

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

async function open(browser) {
  const page = await browser.newPage({
    viewport: { width: 1280, height: 800 },
  });
  const errors = [];
  page.on("pageerror", (e) => errors.push(e.message));
  await page.addInitScript(() =>
    localStorage.setItem("atlasdraw-onboarding-dismissed", "1"),
  );
  await page.goto(BASE);
  await page.waitForFunction(
    () =>
      window.__atlasdraw__ &&
      window.__atlasdraw__.cameraBridge &&
      window.__atlasdraw__.map.loaded(),
    undefined,
    { timeout: 90_000 },
  );
  // Let boot-time onChange traffic settle.
  await page.waitForTimeout(1500);
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

/** Pan and zoom at `n` shapes: frame time, element writes, dirty flag. */
async function panCase(browser, n) {
  const { page, errors } = await open(browser);
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
    n: seeded,
    frame: summary(all),
    arrayChanges,
    onChanges,
    writes: changed(before, after),
    dirtyAfterPanAndZoom: dirty,
    errors,
  };
}

/** How many bridge updates one camera move costs, by input. */
async function bridgeCase(browser) {
  const { page, errors } = await open(browser);
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
    const f = a.frame();
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

/** Draw, drag, pan, undo — where is the shape? */
async function undoCase(browser) {
  const { page, errors } = await open(browser);
  const place = () =>
    page.evaluate(() => {
      const a = window.__atlasdraw__;
      const el = a.excalidrawAPI
        .getSceneElements()
        .find((e) => e.type === "rectangle");
      if (!el) {
        return null;
      }
      return a.toLngLat(a.frame(), { x: el.x, y: el.y });
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
      if (!a || !b) {
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
  return { drawn, dragged, undone, pxFromDrawnAfterUndo: px, errors };
}

// The real GPU: SwiftShader puts MapLibre's own frame cost on the CPU and
// drowns the difference being measured.
const browser = await chromium.launch({
  args: [
    "--enable-gpu",
    "--ignore-gpu-blocklist",
    "--use-angle=gl",
    ...(process.env.BENCH_UNCAPPED === "1"
      ? ["--disable-gpu-vsync", "--disable-frame-rate-limit"]
      : []),
  ],
});
const results = { when: new Date().toISOString(), frames: FRAMES, runs: RUNS };
const only = process.env.BENCH_ONLY?.split(",");
const want = (k) => !only || only.includes(k);
if (want("pan")) {
  results.pan = [];
  for (const n of SIZES) {
    const r = await panCase(browser, n);
    console.log(JSON.stringify(r));
    results.pan.push(r);
  }
}
if (want("bridge")) {
  results.bridge = await bridgeCase(browser);
  console.log(JSON.stringify(results.bridge, null, 1));
}
if (want("undo")) {
  results.undo = await undoCase(browser);
  console.log(JSON.stringify(results.undo));
}
await browser.close();
const jsonAt = process.argv.indexOf("--json");
if (jsonAt > 0) {
  fs.writeFileSync(process.argv[jsonAt + 1], JSON.stringify(results, null, 1));
}
