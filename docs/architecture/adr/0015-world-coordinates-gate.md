<!-- ADR-0015-MARKER: world-coordinates-gate -->

# ADR-0015: World Coordinates — Decided by a Measured Spike

- **Status:** Accepted (the gate). Outcome: GO with two conditions, recorded below.
- **Date:** 2026-10-01
- **Relates to:** `code/decisions/0003-coordinate-system.md`

## Context

`code/decisions/0003-coordinate-system.md` says MapLibre owns the camera and
Excalidraw's scroll and zoom are derived from it. The code does the opposite.
It holds Excalidraw at scroll 0,0 and zoom 1, so scene coordinates are screen
pixels. On every camera event, `CoordinateSync` rewrites every geo-anchored
element from its anchor, and `useGeoAnchor` guesses the anchor back from the
pixels after every edit, through a `_lastSync` cache.

The architecture audit of 2026-10-01 measured the cost:

- 14 of 19 traced geo bug classes came from this design, 3 from event timing.
- Undo after a pan moves a shape to a different place (reproduced).
- Every pan marks the document dirty, starts an autosave and defeats
  Excalidraw's shape caches.
- Saved files and collab snapshots carry one viewer's pixels, which blocks live
  element sync (ADR-0014).

The proposed fix stores Web Mercator pixels at a reference zoom, measured from
a floating origin, and drives Excalidraw's scroll and zoom from the map camera.
A camera move then rewrites no element. The fork audit found this needs no
renderer patch: Excalidraw already renders any pan and zoom, and bearing can be
a CSS rotation because the drawing layer takes no input while the map is
rotated.

The change also changes the file format, so it is not started on argument
alone.

## Decision

Run a spike with zero edits to the vendored fork. Commit to the change only if
the spike meets every criterion below, measured in a real browser against
`main` at 1,000 and 5,000 shapes:

1. A pan or zoom writes no element (element versions unchanged).
2. Pan p95 frame time is at or below `main`'s, and under 16 ms at 1,000 shapes.
3. Undo after a pan restores the original geography (the roadmap W1 red test
   passes).
4. The camera bridge settles: one map move produces a bounded number of
   map-to-scene and scene-to-map updates, with no loop.
5. Every map zoom from 0 to 22 renders inside Excalidraw's zoom clamp, by
   re-basing the reference zoom or by widening the clamp in one constant.
6. Existing v1 documents migrate to the new coordinates with every element
   within 1e-6 px of where v1 draws it under random cameras.

**On go:** bump the file format once, together with the document-identity
changes of roadmap W3, and delete `CoordinateSync`, `useGeoAnchor`,
`useCoordinateSync`, the scroll lock, the drift check, `_lastSync` and the
screen and hybrid scale modes.

**On no-go:** keep the scroll lock. Skip writes for elements whose projection
did not change, base the dirty flag on element versions, and raise element
versions on re-anchor so undo sees them.

## Outcome

**Verdict: GO, with two conditions.** All six criteria pass when the
reference zoom is fixed at `z0 = 22`. Measured 2026-10-01 on branch
`spike/world-coords`, with zero edits to the vendored fork (the zoom clamp
constants are not touched either).

The conditions, both found by the spike:

1. **`z0 = 22`, not the document's working zoom.** Excalidraw sizes each
   element's cache canvas with a 20-unit padding in scene units
   (`element/src/renderElement.ts#getCanvasPadding`). At `zoom.value` above
   about 2^9 that padding hits the canvas size cap and shapes render blurred,
   then not at all. With `z0 = 22` the zoom value is never above 1. The cost:
   stroke width and font size defaults are scene units, so a stroke of 2 drawn
   at map zoom 12 is 2^-10 px wide. Creation-time normalisation (audit P4, a
   fork change in `App.tsx` creation sites and the stroke/font property
   actions) becomes required, not optional. The alternative is
   `z0` = working zoom plus a one-line padding fix in the fork renderer.
2. **Excalidraw's own zoom actions must be routed to the map.** Ctrl+= and
   Ctrl+- go through `getNormalizedZoom`, which clamps to [0.1, 30] and steps
   by +-0.1. Measured with `z0 = 22`: Ctrl+= at map zoom 6 jumps to zoom
   18.68. Widening `MIN_ZOOM` does not fix the additive step, so the clamp was
   left alone. Today these keys do nothing (the scroll lock eats them).

### Method

- Pure math, property-tested (`fast-check`): `packages/geo/src/world.ts`,
  `packages/geo/src/migrateV1.ts`.
- `packages/basemap/src/CameraBridge.ts`: map `move` -> `updateScene` appState;
  `onScrollChange` -> `map.jumpTo`; an echo equal to the last write is dropped.
- Behind `?world=1` or `VITE_WORLD_COORDS=1`, `MapEditor` uses the bridge
  instead of the scroll lock, `useCoordinateSync` and `useGeoAnchor`. Bearing is
  a CSS rotation of the Excalidraw canvases about the map centre. `?z0=N` pins
  the reference zoom.
- Browser numbers: `code/apps/atlas-app/scripts/spike-world-coords.mjs`,
  Playwright Chromium on the real GPU (`--use-angle=gl`, AMD Radeon), viewport
  1280x800 (map 1192x664), `vite --port 5293`. Pan = every frame
  `map.panBy([4,1], {animate:false})`; frame time = requestAnimationFrame
  delta, 3 runs x 300 frames (a run stops after 30 s). "Uncapped" disables
  vsync so the delta is the real frame cost; "vsync" floors at 16.7 ms.
- Modes: `main` is the scroll lock as it is. `lock` is the scroll lock with the
  layer-registry `onChange` gated on element versions (audit P0, applied in
  this spike to both paths). `world` uses `z0` = load zoom (4); `world22` uses
  `z0 = 22`.

### Criteria

| #   | Criterion                           | Measured                                                                                                                                                                                                                                                                                                                                                                                          | Result            |
| --- | ----------------------------------- | ------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- | ----------------- |
| 1   | Pan/zoom writes no element          | world: 0 of 1,000 and 0 of 5,000 elements changed version or x/y/w/h over 900 pan frames + 8 zoom steps; 0 element-array changes; document not dirty. main/lock: 1,000/1,000 and 5,000/5,000 geometry rewritten, 0 version bumps, array replaced every frame, dirty                                                                                                                               | GO                |
| 2   | Pan p95 <= main, < 16 ms at 1k      | see table below. 1k uncapped p95: world 7.2 ms, world22 6.7 ms, main 249.6 ms                                                                                                                                                                                                                                                                                                                     | GO                |
| 3   | Undo after a pan restores geography | Browser (draw, drag 60 px, pan 200 px, Ctrl+Z): world 0 px from the drawn place, lock 401.9 px. jsdom: the known-red undo case ported to the bridge (`geo.world.test.tsx`) passes                                                                                                                                                                                                                 | GO                |
| 4   | Bridge settles                      | one `panBy`: 1 map->scene, 0 scene->map, 1 echo dropped. `easeTo` of 22-25 move events: 1 write per event, 0 back. Mouse drag on map: 37 moves, 37 writes, 0 back. Wheel, 5 notches: 5 writes, 0 back. `scrollToContent`: 1 scene->map, 1 map->scene. Space-drag in Excalidraw, 20 steps: 20 scene->map, 20 map->scene. Never more than one exchange per input. Scene vs map afterwards: 3e-11 px | GO                |
| 5   | Zoom 0..22 renders                  | Map zoom 1.22 (the map's floor at this size) to 22, a 200-px solid square at each: `z0 = 22` sharp at every zoom; `z0 = 12` blurred at 21-22; `z0 = 4` blurred from 13, invisible from 21. Zoom value exact (`2^(z - z0)`) at every step; `updateScene` does not clamp                                                                                                                            | GO with `z0 = 22` |
| 6   | v1 migration within 1e-6 px         | Real `CoordinateSync` vs migrated element through the bridge transform and CSS rotation, random cameras (zoom 0.5-22, bearing 0 or random, viewport 320-2560 px), random point/bbox/polyline anchors, `zRef` 0-22, `z0` 0-22: worst 2.39e-7 px over 65,000 elements (4 seeds); stroke and font worst 5.8e-11 px                                                                                   | GO                |

Pan frame time, ms (p95 / mean):

| shapes | mode    | uncapped                  | vsync                       |
| ------ | ------- | ------------------------- | --------------------------- |
| 0      | main    | 3.0 / 1.4                 | 17.2 / 16.7                 |
| 0      | world   | 3.3 / 2.3                 | 26.4 / 17.8 (one noisy run) |
| 1,000  | main    | 249.6 / 149.8             | 313.8 / 189.9               |
| 1,000  | lock    | 51.3 / 24.1               | 91.3 / 41.7                 |
| 1,000  | world   | 7.2 / 4.0                 | 17.6 / 16.7                 |
| 1,000  | world22 | 6.7 / 4.5                 | 18.2 / 16.7                 |
| 5,000  | main    | 5,299 / 3,481 (27 frames) | 10,024 / 4,751 (20 frames)  |
| 5,000  | lock    | 408.5 / 198.3             | 162.0 / 119.0               |
| 5,000  | world   | 18.3 / 13.3               | 30.4 / 20.3                 |
| 5,000  | world22 | 33.4 / 21.9               | 45.0 / 23.8                 |

### Exceptions to criterion 6

- **Point anchors under a turned camera.** v1 draws text upright
  (billboarded); world turns it with the layer. The anchor point agrees to
  1e-6 px; the glyphs do not. This is a visible change.
- **Elements without an anchor.** v1 draws them fixed to the screen; no world
  position reproduces that. They migrate unchanged.
- **`screen` and `hybrid` scale modes** migrate as geographic. No creation path
  writes them and no saved document uses them (audit 2.5).
- **Off the Mercator world** (latitude beyond 85.051129, a box across the
  antimeridian), v1 collapses a box to its 1-px floor. Excluded.

### Risks found

- **Bearing coverage.** The canvases are turned, not enlarged, so a turned
  view has no drawing in the corners of the map. Measured at bearing 30: a
  turned square lands on its projected point and its turned edge; the empty
  corners follow from the geometry and were not measured. Enlarging the
  canvas needs a fork change or a second container. The sidebar is a DOM child
  of the Excalidraw container, so the whole layer cannot be turned.
- **`world22` is slower than `world` at 5,000 shapes** (p95 33 vs 18 ms
  uncapped). Not explained; SUSPECTED the 524,288-unit stroke widths seeded at
  zoom 4. Still 12x better than `lock`.
- **The pin tool** still writes a v1 screen-pixel element with an anchor; it
  is not ported.
- **The registry gate** sums element versions and deletions. It is what makes
  `lock` 5x faster than `main`; it applies today regardless of this decision.
- `isDirty` after a slow `main` run can read false because autosave cleared
  it; the element-array count is the reliable measure.

### Production change (on go)

- New: `packages/geo/src/world.ts`, `migrateV1.ts`;
  `packages/basemap/src/CameraBridge.ts`;
  `apps/atlas-app/src/hooks/useCameraBridge.ts`.
- Change: `MapEditor.tsx` (flag removed), `useExcalidrawChangeHandler.ts`
  (steps 2-3 deleted), `useLayerRegistrySync.ts`, `state/hydrate.ts` and
  `state/selectDocument.ts` (migrate on load, store `z0` and origin in the
  manifest, schema bump with W3), `tools/seedToElement.ts` and `PinTool`
  (create on the frame), `MapEditor.buildGeoJsonExport`, `tools/convert.ts`,
  `geo/bounds.ts`, `CommentAnchorsOverlay.tsx` (lng/lat from scene
  coordinates), `useMapEditorKeyboard.ts` (route zoom keys to the map),
  `useMapWheelRouter.ts`, `MapEditor.module.css`.
- Fork (P4): `packages/excalidraw/components/App.tsx` creation sites and
  `actions/actionProperties.tsx` stroke/font, in screen units.
- Delete: `CoordinateSync.ts`, `useCoordinateSync.ts`, `useGeoAnchor.ts`,
  `canonicalExport.ts`, `scaleMode.ts`, `cameraRotation` in projection,
  `geoOpFuzz.harness.ts` and the fuzz and hazard tests, `_lastSync`.
