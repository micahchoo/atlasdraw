// packages/geo/bench/coord-sync.bench.ts
// SPDX-License-Identifier: MIT
// Phase 1 Wave 3b Task 16 — coord-sync 5k-element baseline benchmark.
//
// Why this is a `test()` not a `bench()`:
//   Vitest's built-in `bench()` API measures aggregate ops/sec but does NOT
//   expose per-iteration timings — and we need per-segment p50/p95/p99
//   (project vs updateScene vs total). So we run a manual sample loop and
//   compute percentiles ourselves. The file is still named `*.bench.ts` and
//   wired through a "bench" script for orchestration.
//
// Why we mock map.project and excalidrawAPI.updateScene:
//   - Pre-spike confirmed JSDOM cannot construct `new maplibregl.Map(...)`
//     (`window.URL.createObjectURL is not a function`). Real WebGL is
//     unreachable in jsdom. We mock `map.project` as a pure-mercator function.
//   - Real Excalidraw `updateScene` runs a diff/render pipeline that's only
//     meaningful in the real app environment. The bench measures coord-sync
//     work *outside* Excalidraw's internals — `updateScene` is a no-op.
//     This is documented in the JSON's `notes` field and means
//     `dominantSegment` will almost certainly be "project".

import { writeFileSync, mkdirSync } from "node:fs";
import { dirname } from "node:path";
import { fileURLToPath } from "node:url";

import { describe, test, expect } from "vitest";

import { CoordinateSync } from "../src/CoordinateSync.js";

import { generateScene } from "./synthetic-scene-gen.js";

import type {
  ExcalidrawElementLike,
  ExcalidrawAPI,
} from "../src/CoordinateSync.js";

// ---------------------------------------------------------------------------
// Mock map: pure Web-Mercator over a virtual 800x600 viewport.
// Signature compatible with what `projection.ts::projectPoint` calls:
//   `map.project([lng, lat]) -> { x, y }`.
// ---------------------------------------------------------------------------

interface MockMap {
  getZoom: () => number;
  getBounds: () => {
    getNorth: () => number;
    getSouth: () => number;
    getEast: () => number;
    getWest: () => number;
  };
  project: (lngLat: [number, number]) => { x: number; y: number };
  unproject: (point: [number, number]) => { lng: number; lat: number };
}

function makeMockMap(
  _centerLng: number,
  _centerLat: number,
  zoom: number,
): MockMap {
  return {
    getZoom: () => zoom,
    getBounds: () => ({
      getNorth: () => 85,
      getSouth: () => -85,
      getEast: () => 180,
      getWest: () => -180,
    }),
    project: (lngLat: [number, number]) => {
      const [lng, lat] = lngLat;
      const scale = 256 * Math.pow(2, zoom);
      const x = ((lng + 180) / 360) * scale;
      // Clamp lat to mercator-safe range to avoid log(0) at poles.
      const clampedLat = Math.max(-85, Math.min(85, lat));
      const sinLat = Math.sin((clampedLat * Math.PI) / 180);
      const y =
        (0.5 - Math.log((1 + sinLat) / (1 - sinLat)) / (4 * Math.PI)) * scale;
      return { x, y };
    },
    unproject: (point: [number, number]) => {
      const scale = 256 * Math.pow(2, zoom);
      const lng = (point[0] / scale) * 360 - 180;
      const n = Math.PI - (2 * Math.PI * point[1]) / scale;
      const lat =
        (180 / Math.PI) * Math.atan(0.5 * (Math.exp(n) - Math.exp(-n)));
      return { lng, lat };
    },
  };
}

function makeMockExcalidrawAPI(scene: ExcalidrawElementLike[]): ExcalidrawAPI {
  return {
    getSceneElements: () => scene,
    updateScene: (_opts) => {
      // No-op. The bench measures coord-sync work, not Excalidraw's internal
      // diff/render. Real-Excalidraw cost is uncovered in jsdom; this is
      // documented in results JSON.
    },
  };
}

// ---------------------------------------------------------------------------
// Percentile helper.
// ---------------------------------------------------------------------------

function percentile(sortedAsc: number[], p: number): number {
  if (sortedAsc.length === 0) {
    return NaN;
  }
  // Nearest-rank method (1-indexed): rank = ceil(p/100 * N).
  const rank = Math.ceil((p / 100) * sortedAsc.length);
  const idx = Math.min(sortedAsc.length - 1, Math.max(0, rank - 1));
  return sortedAsc[idx]!;
}

// ---------------------------------------------------------------------------
// The benchmark.
// ---------------------------------------------------------------------------

const ELEMENT_COUNT = 5000;
const WARMUP_ITERS = 5;
const MEASURE_ITERS = 50;
const BUDGET_P99_TOTAL_MS = 8;

describe("coord-sync 5k-element baseline", () => {
  test(
    "p50/p95/p99 for project, updateScene, total",
    // Vitest 4 signature: test(name, options, fn). Bench (warmup + 50 iters of
    // 5k elements) is CPU-bound; raise the timeout ceiling.
    { timeout: 60_000 },
    () => {
      // Build scene + mocks once.
      const scene = generateScene(ELEMENT_COUNT);
      const baseMap = makeMockMap(0, 0, 4);
      const excalidrawAPI = makeMockExcalidrawAPI(scene);

      // Wrap map.project so we can accumulate per-call time per iteration.
      // Accumulator is reset between iterations.
      let projectAccumMs = 0;
      const baseProject = baseMap.project;
      const wrappedMap: MockMap = {
        ...baseMap,
        project: (lngLat: [number, number]) => {
          const t0 = performance.now();
          const result = baseProject(lngLat);
          projectAccumMs += performance.now() - t0;
          return result;
        },
      };

      // Cast to MapLibreMap — structural shape sufficient for `projectPoint`.
      const sync = new CoordinateSync({
        // eslint-disable-next-line @typescript-eslint/no-explicit-any
        map: wrappedMap as any,
        excalidrawAPI,
      });
      sync.attach();

      // Warmup — JIT, allocate, settle caches.
      for (let i = 0; i < WARMUP_ITERS; i++) {
        projectAccumMs = 0;
        sync.syncMapToScene();
      }

      // Measure.
      const totalSamples: number[] = [];
      const projectSamples: number[] = [];
      const updateSamples: number[] = [];

      for (let i = 0; i < MEASURE_ITERS; i++) {
        projectAccumMs = 0;
        const tStart = performance.now();
        sync.syncMapToScene();
        const tEnd = performance.now();
        const total = tEnd - tStart;
        const projectMs = projectAccumMs;
        // updateScene_ms is "everything else": map allocation, isGeoCustomData
        // checks, the .map() spread, and the no-op updateScene call.
        const updateMs = Math.max(0, total - projectMs);
        totalSamples.push(total);
        projectSamples.push(projectMs);
        updateSamples.push(updateMs);
      }

      const sortAsc = (arr: number[]) => [...arr].sort((a, b) => a - b);
      const totalSorted = sortAsc(totalSamples);
      const projectSorted = sortAsc(projectSamples);
      const updateSorted = sortAsc(updateSamples);

      const project = {
        p50ms: percentile(projectSorted, 50),
        p95ms: percentile(projectSorted, 95),
        p99ms: percentile(projectSorted, 99),
      };
      const updateScene = {
        p50ms: percentile(updateSorted, 50),
        p95ms: percentile(updateSorted, 95),
        p99ms: percentile(updateSorted, 99),
      };
      const total = {
        p50ms: percentile(totalSorted, 50),
        p95ms: percentile(totalSorted, 95),
        p99ms: percentile(totalSorted, 99),
      };

      // Gate decision per plan Step 5.
      const totalP99 = total.p99ms;
      let pass: boolean;
      let warn = false;
      if (totalP99 < BUDGET_P99_TOTAL_MS) {
        pass = true;
      } else if (totalP99 < 2 * BUDGET_P99_TOTAL_MS) {
        pass = true;
        warn = true;
      } else {
        pass = false;
      }

      // Dominant segment: >=60% of total p99.
      let dominantSegment: "project" | "updateScene" | "balanced";
      if (project.p99ms >= 0.6 * total.p99ms) {
        dominantSegment = "project";
      } else if (updateScene.p99ms >= 0.6 * total.p99ms) {
        dominantSegment = "updateScene";
      } else {
        dominantSegment = "balanced";
      }

      // Task 20 variant selection — only when failing.
      // Variant A/B target project segment; C/D target updateScene; E balanced.
      let task20Variant: string | undefined;
      if (!pass) {
        if (dominantSegment === "project") {
          task20Variant = "A-or-B";
        } else if (dominantSegment === "updateScene") {
          task20Variant = "C-or-D";
        } else {
          task20Variant = "E";
        }
      }

      const notes = [
        "jsdom mock map.project (pure Web-Mercator math); no real WebGL",
        "no real Excalidraw updateScene cost (mocked as no-op) — real diff/render unmeasured",
        `samples: warmup=${WARMUP_ITERS}, measure=${MEASURE_ITERS}`,
        warn ? "borderline — monitor in Phase 2" : "",
      ]
        .filter(Boolean)
        .join("; ");

      const result = {
        timestamp: new Date().toISOString(),
        nodeVersion: process.version,
        platform: process.platform,
        elementCount: ELEMENT_COUNT,
        budget: { p99_total: BUDGET_P99_TOTAL_MS },
        project,
        updateScene,
        total,
        dominantSegment,
        pass,
        ...(task20Variant ? { task20Variant } : {}),
        notes,
      };

      // Resolve results path relative to this bench file.
      const here = dirname(fileURLToPath(import.meta.url));
      const outDir = `${here}/results`;
      const outFile = `${outDir}/phase-1-baseline.json`;
      mkdirSync(outDir, { recursive: true });
      writeFileSync(outFile, `${JSON.stringify(result, null, 2)}\n`, "utf8");

      // Echo a one-line summary to stdout for orchestrator log.
      // eslint-disable-next-line no-console
      console.log(
        `[coord-sync bench] n=${ELEMENT_COUNT} ` +
          `total p50/p95/p99 = ${total.p50ms.toFixed(3)}/${total.p95ms.toFixed(
            3,
          )}/${total.p99ms.toFixed(3)} ms ` +
          `dominant=${dominantSegment} pass=${pass}${
            task20Variant ? ` task20=${task20Variant}` : ""
          }`,
      );

      // Sanity: bench must have produced finite numbers.
      expect(Number.isFinite(total.p99ms)).toBe(true);
      expect(Number.isFinite(project.p99ms)).toBe(true);
      expect(totalSamples.length).toBe(MEASURE_ITERS);
    },
  );
});
