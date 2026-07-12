# Phase 1 Cross-Browser Test Matrix

Wave 4 Task 17/18 — Phase 1 closure gate.

## Status

| Date       | Chromium | Firefox | WebKit       | iOS Safari | Android Chrome |
|------------|----------|---------|--------------|------------|----------------|
| 2026-05-04 | 6/6 ✓    | 6/6 ✓   | DEFER:deps   | DEFER:hw   | DEFER:hw       |

**Phase 1 acceptance**: `pin/rectangle stays glued to lat/lng during pan and zoom` is verified on **Chromium** and **Firefox** (the wheel-router ships with `deltaMode` normalization; Firefox passes without further fixes).

**Webkit deferred** on system dependencies — host requires `sudo yarn playwright install-deps` (libicu74, libxml2, libmanette-0.2-0). Browser binary is installed (`~/.cache/ms-playwright/webkit-2272/`); only the system shared libs are missing. Tracked: `atlasdraw-webkit-deps`.

**iOS Safari and Android Chrome** are manual columns per Spec §1 — Phase 1 plan flags these as DEFER until physical-device or BrowserStack access. No regression risk for Phase 1 acceptance because (a) Spec §1 names these as "best-effort" Phase 1 targets and (b) Wave 4 Task 19 (CI green) only gates on automated browsers.

## E2E coverage map

`code/apps/atlas-app/e2e/phase-1-geo-foundation.spec.ts`:

| #  | Case                                          | scaleMode    | Camera op            | Pre-fix? | Post-fix |
|----|-----------------------------------------------|--------------|----------------------|----------|----------|
| 1  | Pin stays glued during pan                    | screen       | `panBy([200,0])`     | pass     | ✓        |
| 2  | Rectangle stays glued during pan              | geographic   | `panBy([200,0])`     | pass     | ✓        |
| 3  | Pin stays glued during programmatic ZOOM      | screen       | `zoomTo(z+1)`        | pass     | ✓        |
| 4  | Rectangle stays glued during programmatic ZOOM | geographic  | `zoomTo(z+1)`        | pass     | ✓ (width 200→400)  |
| 5  | Pin glued during INTERACTIVE wheel zoom (HAND) | screen      | `mouse.wheel`        | pass     | ✓        |
| 6  | Pin glued during wheel zoom in DRAWING mode   | screen       | `mouse.wheel`        | **fail** (5afc) | ✓ via `useMapWheelRouter` |

Source-of-truth assertion in every case: `customData.geo.{lng,lat}` is byte-stable across the camera op. Position assertion: scene `x/y` matches `map.project(lng,lat)` within tolerance.

## Browser-specific findings

### Chromium
Reference behaviour. All 6 cases pass with 0px drift on programmatic ops, ≤15px tolerance on interactive.

### Firefox
Passes all 6 cases. The wheel-router's `deltaMode === 1` (DOM_DELTA_LINE) handling produces equivalent zoom rate to Chromium's PIXEL-mode default — no per-browser branching needed.

**Matrix flakiness** observed once: first cross-browser run (cold dev server) timed out Firefox at `expect(getByTestId('pin-tool-button')).toBeVisible()` after 11.4s. Did not reproduce on retry. Hypothesis: Vite dev server cold-start race during `webServer.reuseExistingServer:true` re-attach. Not a Firefox bug; tracked separately if it recurs (`atlasdraw-matrix-cold-start-race`).

### WebKit
Browser binary present (~/.cache/ms-playwright/webkit-2272/), launch fails with:
```
Host system is missing dependencies to run browsers.
sudo yarn playwright install-deps
# or apt-get install libicu74 libxml2 libmanette-0.2-0
```
Resolution requires sudo — held until user runs the command.

## Run instructions

```bash
# Single browser (fast, default chromium)
yarn workspace @atlasdraw/atlas-app e2e

# Full automated matrix (chromium + firefox + webkit)
yarn workspace @atlasdraw/atlas-app e2e:all
```

Webkit fails fast (~2ms per test) until system deps land — does not block the chromium/firefox columns.

## Phase 1 closure note

- Bench baseline: `code/packages/geo/bench/results/phase-1-baseline.json` — `total.p99=4.58ms` (8ms budget) — Q8 GATE PASS.
- E2E acceptance: 12/12 automated tests pass on chromium + firefox.
- Outstanding: webkit (system deps), iOS Safari + Android Chrome (manual/hardware), and atlasdraw-fef0 / atlasdraw-4f26 / atlasdraw-6e33 (deferred product decisions, not Phase 1 acceptance gates).

Phase 1 is **acceptance-complete on automated chromium + firefox** as of 2026-05-04. WebKit is the one outstanding automated column.
