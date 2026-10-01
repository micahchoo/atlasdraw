<!-- ADR-0015-MARKER: world-coordinates-gate -->

# ADR-0015: World Coordinates — Decided by a Measured Spike

- **Status:** Accepted (the gate). Outcome: GO with two conditions. Shipped in
  roadmap wave W4 (branch `w4/world`); world coordinates are the only path.
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

### Decision

Made before W4 and carried out in it:

1. **Reference zoom `z0 = 22` for every document**, with the floating origin
   stored in the manifest (`manifest.world = { z0, origin }`). Stroke width
   and font size are normalised at creation: the stroke and font pickers and
   new elements work in screen pixels and store them divided by the zoom
   value, so on-screen sizes at the zoom where the user draws are as before
   (fork prop `screenSizedStyles`).
2. **One owner for the camera.** Excalidraw's zoom keys, zoom buttons and
   fit actions call the host (`onZoomAction`), which zooms the map;
   the editor's command keys (`commands/useCommandKeys.ts`) take the zoom
   keys before the drawing sees them; trackpad pinch goes to the map with
   the wheel.
3. **Bearing** is a CSS rotation of the drawing layer's canvases about the
   map centre, display only. Drawing stays blocked while the map is turned.

### As built (W4)

- `packages/geo`: `world.ts` (`documentFrame`, `REFERENCE_ZOOM`,
  `sceneUnitsPerPixel`), `sceneGeometry.ts` (an element's drawn outline),
  `bounds.ts` (lng/lat bounds through the frame), `migrateV1.ts`.
- `packages/data`: the coordinate step is the second step of
  `MIGRATIONS[1]`; the manifest gains `world`. The version stays 2.
  `fixtures/v1-delhi.atlasdraw` was written by the v1 build; the migrated
  file draws every element within 1e-6 px of where v1 drew it at the save
  camera (zoom 13.3, bearing 25), rotated boxes, polylines, text, a pin and
  the `screen` and `hybrid` modes included. v1 kept no `a0` for those two
  modes, so their saved angle held the camera's turn; the migration takes it
  out with the turn of a box that has both (`savedCameraTurn`).
- `CameraBridge` reads the frame on every exchange (a newly opened document
  applies at once) and attaches after Excalidraw initializes: its initial
  `zoom: 1` would otherwise read as a user change and send the map to zoom 22.
- Lng/lat for GeoJSON export, convert-to-data-layer (one converter,
  `tools/convert.ts`, with the element's own turn), bounds and zoom-to,
  comment anchors and their hit test, and the generated layer name ("Rectangle
  near …") come from scene coordinates through the frame.
- Pins and tool seeds are placed in the frame; a pin is centred on the
  click. A bare `.excalidraw` import opens at the live camera, at the size it
  had (`lib/placeDrawing.ts`).
- Deleted: `CoordinateSync`, `useCoordinateSync`, `useGeoAnchor`,
  `canonicalExport`, `scaleMode`, `cameraRotation`, `projection.ts`,
  `parseGeoCustomData`, the scroll lock and drift check, `_lastSync`, the
  fork's `onScrollBackToContent`, `geoOpFuzz.harness` with its fuzz and
  hazard tests, `useAtlasdrawTool.updateElement`, the geo coord-sync bench.
  Property tests on the frame, the scene geometry and the bridge replace
  the fuzz harness.
- The layer-registry `onChange` gate from the spike is gone with the
  registry: W3 computes annotation rows from the scene store, which
  publishes only when the scene signature changes.

### Found in production, not by the spike

`z0 = 22` makes one scene unit about a thousandth of a pixel where people
draw. Upstream draws some details at fixed scene sizes, and has limits in
scene units. In the browser: arrows had no heads, dashes were dust, strokes
were drawn at half width (the cache canvas padding of 20 units clipped the
outer half), rough shapes bowed by thousands of pixels, text drew at half
size (Chromium clamps a canvas font to 10000px), library items went in at
a thousandth of their size, and elbow arrows were clamped to ±1e6. Fixed in
the fork:

- Each element records its pixel unit, `customData.atlas.unit` (scene units
  per screen pixel at the zoom it was drawn at), from every creation path:
  the editor, pins and seeds, imports, library items and pastes from
  outside, and the v1 migration. Arrowhead size, dash lengths, rough jitter
  and bowing, the adaptive corner radius and cache-canvas padding are
  multiplied by it (`packages/element/src/atlasStyleUnit.ts`). An element
  without a unit is drawn as upstream draws it.
- Library items and pastes from outside the atlas are scaled to the size
  they had there (`scaleForeignElements`).
- Canvas text above 1000px is measured and drawn at 1000px into a scaled
  context (`MAX_CANVAS_FONT_SIZE`).
- The 1e6 limits are `MAX_SCENE_EXTENT = 2^32`.

Fork edits, all marked "Atlasdraw" and tested
(`packages/excalidraw/tests/atlasWorldScale.test.tsx`,
`packages/element/tests/atlasStyleUnit.test.ts`,
`packages/element/tests/atlasCanvasFont.test.ts`): `types.ts` and
`index.tsx` (the two props), `components/App.tsx` (creation sites, unit
stamp, foreign elements, fitting `scrollToContent`),
`actions/actionProperties.tsx` (stroke and font pickers),
`actions/actionCanvas.tsx` (zoom actions), `actions/actionBoundText.tsx`,
`components/LayerUI.tsx` (prop removed), `atlasStyleScale.ts`;
`packages/element`: `atlasStyleUnit.ts`, `bounds.ts`, `shape.ts`,
`renderElement.ts`, `utils.ts`, `textMeasurements.ts`, `elbowArrow.ts`,
`newElement.ts`; `packages/common/src/constants.ts`.

W4 left two things open: touch pinch under a drawing tool, and the other
upstream scene-unit constants. W4b (branch `w4b/units`) closes them; see
the next section.

### Leftovers fixed (W4b)

**Scene-unit distances.** Each upstream distance in scene units is now in
one of two units, so that the editor at any map zoom looks and behaves as
upstream does at zoom 1:

- The element's unit, `customData.atlas.unit`, for distances that are part
  of the drawing. They scale with the map, like an arrowhead.
- The editor's unit, `editorUnit` (one screen pixel at the current zoom with
  `screenSizedStyles`, else 1), for distances of the interaction. The fork
  mirrors the prop into `AppState.screenSizedStyles` (not saved), because
  the element package and the renderers see `appState`, not props.

Without a unit, and without the prop, every formula is upstream's.

| Constant (where)                                                                                                                | Unit                                   | Before W4b, at map zoom 12                                       |
| ------------------------------------------------------------------------------------------------------------------------------- | -------------------------------------- | ---------------------------------------------------------------- |
| `BASE_BINDING_GAP`, `BASE_BINDING_GAP_ELBOW` (`binding.ts#getBindingGap`, the elbow fallback)                                   | arrow                                  | arrowhead touched the target                                     |
| `maxBindingDistance_simple` (binding reach, its highlight, mid-point snap, elbow endpoint drag)                                 | editor                                 | 0.03 px: an end bound only inside the shape                      |
| `BASE_ARROW_MIN_LENGTH`, `snapToMid` limits 5..80 (`binding.ts`)                                                                | arrow                                  | near zero                                                        |
| `BOUND_TEXT_PADDING` (`textElement.ts`, `textMeasurements.ts` min sizes, `renderElement.ts` arrow label, `actionBoundText.tsx`) | container (text for wrap-in-container) | text touched its container                                       |
| `BASE_PADDING`, its `+ 5`, the `±2` end boxes (`elbowArrow.ts`); the elbow hover reach, which upstream gives no zoom            | arrow                                  | routes hugged shapes                                             |
| Eraser (`eraser/index.ts`): free-draw box 15 and floor 2.25; line tolerance `2·stroke/zoom` with the zoom relative to the unit  | element                                | an arrow erased from 4,000 px away; free draw only on a crossing |
| `LINE_POLYGON_POINT_MERGE_DISTANCE` (`shape.ts#toggleLinePolygonState`)                                                         | line                                   | ends 10 px apart did not merge                                   |
| `ELEMENT_TRANSLATE_AMOUNT`, `ELEMENT_SHIFT_TRANSLATE_AMOUNT` (arrow keys)                                                       | editor                                 | moved 0.001 px                                                   |
| `TEXT_TO_CENTER_SNAP_THRESHOLD`                                                                                                 | editor                                 | near zero                                                        |
| `DEFAULT_LINK_SIZE` (`hyperlink/helpers.ts#getLinkHandleFromCoords`; upstream never grows it below zoom 1)                      | editor                                 | link icon 0.012 px                                               |

Kept, because upstream already divides them by the zoom (screen pixels at
any zoom): the hit threshold (`DEFAULT_COLLISION_THRESHOLD`), `SNAP_DISTANCE`,
transform handles (`transformHandleSizes`, `DEFAULT_TRANSFORM_HANDLE_SPACING`,
`SIDE_RESIZING_THRESHOLD`), `FOCUS_POINT_SIZE`, `POINT_HANDLE_SIZE`,
`LINE_CONFIRM_THRESHOLD`, `DRAGGING_THRESHOLD`, `TEXT_AUTOWRAP_THRESHOLD`,
`MINIMUM_ARROW_SIZE`, the eraser's `5 / zoom`. `DOUBLE_TAP_POSITION_THRESHOLD`
is in client pixels.

Kept in scene units, on purpose:

- `DEDUP_TRESHOLD` (elbow arrows, 1 unit): it only drops shorter segments;
  smaller keeps more points and changes nothing visible.
- `DEFAULT_GRID_SIZE`, `DEFAULT_GRID_STEP`: the atlas has no grid.
- `INVISIBLY_SMALL_ELEMENT_SIZE` (0.1): a click with no drag is still 0.
- `MINIMAL_CROP_SIZE` (10, image crop): a crop can go smaller than 10 px.
  Not seen as a problem; change it with the image's unit if it is.
- `DEFAULT_EXPORT_PADDING` (10): Excalidraw's own exports. The atlas exports
  through its own PNG and PDF paths.
- `getNormalizedZoom`'s clamp: Excalidraw's own zoom never runs (below).

Test: `excalidraw/tests/atlasSceneUnits.test.tsx` makes the same screen
gestures in upstream's editor at zoom 1 and in the atlas editor at zoom
1/1024, and compares the geometry in pixels: an arrow ending 10 px from a
shape binds at the same gap, bound text sits at the same padding, an elbow
arrow takes the same route, arrow keys nudge 1 and 5 px, the eraser and the
link icon reach as far. `element/tests/atlasStyleUnit.test.ts` holds the
unit rules.

**Touch pinch.** Under the selection tool and every drawing tool the plate
takes the pointers, so a pinch reaches Excalidraw's pinch handler, which
clamped to [0.1, 30] and rounded to 6 places: at map zoom 4 the first frame
sent the map to 18.68. With `onZoomAction` (the host owns the camera) the
pinch zoom goes unclamped to the camera bridge, which moves the map; Safari's
gesture zoom too (`App.tsx#pinchZoom`). Tests: `atlasWorldScale.test.tsx`;
`e2e/pinch-zoom-touch.spec.ts` (fingers twice as far apart, one map level,
under selection and rectangle).

**Ctrl+0.** Excalidraw's reset zoom is its 100%, map zoom 22. A map has no
100%, so on the map it frames everything drawn, as zoom-to-fit does, and
does nothing on an empty drawing (`useCameraBridge.ts#zoomActionOnMap`).
The only zoom readout in the map views is the status bar's map zoom:
Excalidraw's percentage control is not rendered in the collar shell and is
hidden in the embed. Tests: `zoomActionOnMap.test.ts`, `e2e/zoom-reset.spec.ts`.

**SVG text above 10000px.** Measured in Chromium: an SVG `<text>` is clamped
to 10000px by its own font-size (a 20480px text drew at 10000px, even shown
at 200 px wide), while a 1000px text in `scale(20.48)` draws at the full
size. Firefox does not clamp. SVG export is reachable with atlas text:
library previews and the publish dialog, and copy-as-SVG in the embed, which
does not close `saveAsImage`. `staticSvgScene.ts` writes text above
`MAX_CANVAS_FONT_SIZE` at that size in a scaled `<text>`. Test:
`atlasWorldScale.test.tsx`.

Still open: `ShareView` mounts a bare Excalidraw with no map and no camera
bridge, so a world-coordinate document opens there at zoom 1 (map zoom 22)
and shows Excalidraw's percentage. It predates W4.

### Production measurements (W4)

`code/apps/atlas-app/scripts/bench-world-coords.mjs` on `vite --port 5297`,
the same machine and method as the spike (Playwright Chromium on the real
GPU, 1280x800, 3 runs x 300 frames of `panBy([4,1])`), 2026-10-01:

| shapes | uncapped p95 / mean (ms) | vsync p95 / mean (ms) | element writes during pan and zoom | dirty |
| ------ | ------------------------ | --------------------- | ---------------------------------- | ----- |
| 0      | 2.7 / 2.05               | 17.2 / 16.67          | 0                                  | no    |
| 1,000  | 5.4 / 3.70               | 17.3 / 16.67          | 0 of 1,000                         | no    |
| 5,000  | 18.6 / 11.61             | 19.2 / 16.72          | 0 of 5,000                         | no    |

Bridge, per input: one `panBy` 1 write into the scene and 0 back; an
animated `easeTo` 31 writes for 31 `move` events and 0 back; a mouse drag on
the map 37 and 0; Excalidraw's `scrollToContent` 1 and 1; a fitting
`scrollToContent` goes to the map (18 writes, 0 back); space-drag in
Excalidraw 20 steps, 20 back and 23 in; 5 wheel notches 5 and 0. Scene and
map agree to 4.2e-11 px afterwards. Undo after drag and pan: 0 px from the
drawn place.
