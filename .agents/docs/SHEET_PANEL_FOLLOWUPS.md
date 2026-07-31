# Sheet Panel — follow-ups after the merge

`feat/sheet-panel-preconditions` merged to `main` as `cc2ce53` (`--no-ff`,
2026-07-30). Steps 0–6 of `PLANS/ATLASDRAW_SIDEBAR_DESIGN.md` plus two review
rounds, `b156146..aee15c0`. `git diff main aee15c0` is empty — the merged tree
is byte-identical to the tree Chief Opus verified at `2759 passed / 1 failed`,
typecheck 0, e2e 2 passed. Nothing in this file is a merge regression.

Every line below was re-checked against the source on `main` after the merge,
not carried over from the thread. Where the design doc and the source disagree,
the source wins and the disagreement is called out.

Pushed to `origin/main` 2026-07-30 (`df9c36c..cc2ce53`); local and origin are
level. GitHub reports 63 Dependabot vulnerabilities on the default branch — not
from this sequence, but now visible on a pushed branch.

---

## Status

MIXI asked "were all the follow-ups completed" on 2026-07-31 and this file could
not answer, because it had no status field. It has one now. **Update this table
in the same commit that changes a ticket** — a ledger that lags is worse than no
ledger.

| | state | where |
|---|---|---|
| FU-12 | **done, shipped** | `d29920d`, merged `0b0de34`, pushed |
| FU-13 | **done, shipped** | same commit |
| FU-1 | open | — |
| FU-2 | **done** | the seven deleted `8cb12be`, on `feat/map-rotation` |
| FU-3 | open | — |
| FU-4 | open | — |
| FU-5 | open | — |
| FU-6 | open | — |
| FU-7 | open, scope only | — |
| FU-8 | open, with a concrete reproduction as of 2026-07-31 | reproduction + `rm:build` glob bug in ticket |
| FU-15 | open | stale `tsbuildinfo` fakes a source error — sibling of FU-8 |
| FU-9 | open | — |
| FU-10 | open | — |
| FU-11 | parked with a kill criterion, deliberately | — |
| FU-14 | **done, on a branch** | RT-0 `8749fc0`, RT-1+RT-2 `0d3e567`, probe fix `4505042`, RT-4 `67c33ce`, RT-3+RT-9 `a15fbcf` — all on `feat/map-rotation`, unmerged |

4 of 15 done, three of them sitting on `feat/map-rotation` and not yet merged
or run in a browser. Nothing is now blocked on an answer.

---

## The one thing to fix first

The panel now lists layers well and **drawing works** — the native Excalidraw
toolbar is the drawing path and every shape it makes is geo-anchored
(`useGeoAnchor.ts`, wired at `MapEditor.tsx:598`). What's broken is what happens
to that work afterwards: **the PDF export drops every shape the user drew**, and
its legend describes a different map than the one on the page. FU-12 and FU-13
are the tickets that matter. FU-1 (raster import) is the one real capability
gap.

An earlier revision of this file claimed the app could barely produce layers.
That was wrong — see FU-2, which now records the mistake rather than hiding it.

Every ticket below carries a **User impact** line: what a person sitting in
front of the app actually experiences. Tickets whose impact is on contributors
rather than users say so.

---

## A. Import and the tools subsystem

### FU-1 — `.tif` drops are a silent no-op
`useDataFileImport.ts:55` — `type DataFileExt = "geojson" | "csv" | "zip"`.
Anything else falls to the `:231` error path: *"unsupported file type — expected
.geojson, .csv, or .zip"*. PRD §4 job 1 is raster import; it is not met.
`packages/data/src/thumbnail.ts` is complete and tested and still has no caller
in app code (the only `thumbnail` hits are `atlasdraw.ts`'s write-side
container format).

**User impact:** You drag a GeoTIFF onto the map and get an error toast telling
you the file type is unsupported. Every raster workflow is closed — scanned
survey sheets, satellite imagery, elevation, historical map plates. For a tool
pointed at archives, that is the format most likely to arrive first.

**Done when:** a dropped `.tif` registers a data layer that renders, and the
layer card shows it with provenance like every other source.
**Size:** medium — raster is a different MapLibre source type, not a parser swap.

### FU-2 — `packages/tools` is a dead parallel drawing subsystem

**This ticket was wrong on first writing, and the design doc it came from is
wrong too.** Both said seven working geo-tools are "one toolbar away" from the
user — implying you cannot draw. MIXI corrected it from the running app: you
can draw everything. The code agrees with MIXI.

`useGeoAnchor` auto-stamps `customData.geo` on elements from the **native
Excalidraw toolbar**, dispatching by type (`useGeoAnchor.ts:12-18`):
rectangle/ellipse/diamond/image/iframe/embeddable/frame → `bbox`,
line/arrow/freedraw → `polyline`, text → `point`. It is wired at
`MapEditor.tsx:598`, and `scaleMode` is always `"geographic"` by maintainer
decision (2026-07-19, `useGeoAnchor.ts:7-10`). Phase 2 Wave 4 **T18 widened it
from bbox-only to ALL native tools** — that is the moment `packages/tools`
stopped being the drawing path, and the header says so.

So the real finding is the opposite shape: not a missing toolbar, a **dead
subsystem**. Seven of the eight `AtlasdrawTool` objects have zero runtime
consumers — verified by grepping each symbol across `code/apps` + `code/packages`
excluding its own source: every hit is `packages/tools/src/index.ts`,
`registry.test.ts`, `dist/`, or a comment in `seedToElement.ts:188,263`. Only
`PinTool` is activated (`MapEditor.tsx:932`, `:1253`).

The *package* is alive and should stay — `classifyTool` (`useToolState.ts:20`),
the `AtlasdrawTool` type, `seedToElement`, `useConvertToDataLayer`, `PinTool`
all depend on it. What's dead is the seven implementations.

**Prior art, and the rule I broke.** `ISSUES.md` Issue 5 hit this exact pattern
and resolved it by *deleting* `geoToExcalidraw`/`excalidrawToGeo` as dead code
superseded by a different architecture — not by wiring them up. That resolution
also added `.claude/rules/canonicalization-verify-first.md`: re-check a
duplicate/dead claim against the code before acting on it. I inherited this
finding from the design doc and re-published it without running the check that
rule exists to force.

**User impact: none.** Drawing works. This is maintenance weight — ~700 lines
that read as the drawing system to anyone new, with `PinTool` sitting among them
making the whole set look load-bearing. It cost this thread two wrong messages.

**Done when:** a decision is recorded, not when code moves. Either delete the
seven and keep `PinTool` + the shared types, or write down what they are for. If
they are a real alternative interaction model — `RectangleTool` drags a bbox in
*geographic* space, whereas the native rectangle is drawn in screen space and
anchored after the fact, which is not identical under a rotated or tilted camera
— that is a legitimate reason to keep them, and it belongs in an ADR rather than
in seven unreferenced files.

**Kill criterion:** if nobody can name a behaviour the native toolbar can't
produce within one session of looking, delete them.

**RESOLVED 2026-07-31 — delete the seven.** The block was conditional on FU-14
D6, and D6 is answered: drawing is disabled while `bearing !== 0`
(`PLANS/ATLASDRAW_ROTATION_PLAN.md`, RT-9). That removes the premise the seven
were kept on. If a tool can only be picked up when the camera is north-up, then
at draw time screen-space and geographic bbox coincide exactly — "drag a
rectangle in geographic space" is not a behaviour the native toolbar fails to
produce, it is the *same* behaviour. Nobody named another in three sessions of
looking. Kill criterion met, and this time on a premise that cannot quietly
reverse: it is a decision about the app, not a claim about the code.

Note what changed and what didn't. Tilt was dropped, not deferred — under
rotation alone the geographic/screen distinction closes completely. Had tilt
shipped, this ticket would still be open.

**Consumer analysis re-verified 2026-07-31 at `0b0de34`**, per
`.claude/rules/canonicalization-verify-first.md`, because the rule exists
precisely because this ticket broke it once. Grepped each of the eight symbols
across `apps/` + `packages/`, excluding its own source, `dist/`, and the
vendored `packages/excalidraw/`:

| | non-`packages/tools` hits | verdict |
|---|---|---|
| `PolygonTool` `PolylineTool` `FreehandTool` `TextLabelTool` `ArrowTool` `RectangleTool` `CircleTool` | `seedToElement.ts` only — **all nine hits are comments** (lines 62-68, 188, 216, 239, 263, 294, 322), naming which T-task each branch mirrors | **delete** |
| `PinTool` | `MapEditor.tsx`, `useAtlasdrawTool.ts`, `seedToElement.ts`, an e2e spec, four test files | **keep** |

The four survivors — `types.ts`, `classifyTool.ts`, `convert.ts`, `PinTool.ts` —
import none of the seven. The cut is clean; the cross-references among the seven
(`PolylineTool`→`PolygonTool`, `CircleTool`→`RectangleTool`) vanish with them.

**Not yet executed.** The deletion also touches `index.ts` (seven exports and
their registrations) and `registry.test.ts` (asserts all eight register), plus
seven `.test.ts` files. Those comments in `seedToElement.ts` should stay —
they explain the geometry, and they will outlive the classes they name.

**Size:** small. The work was the decision, and the decision is made.

### FU-3 — `collab-data` still lives outside the registry
`useCollabDataLayer.ts:22` defines `COLLAB_DATA_ID = "collab-data"` and adds it
to the map directly. P2 taught `reconcileDataLayers` to re-add registry layers
after a basemap swap or a document load — this layer isn't in the registry, so a
basemap switch still drops it with nothing to put it back. Pre-existing at
`5b1efa2`, deliberately out of the sequence's scope.

**User impact:** In a shared session, switch the basemap and your collaborators'
shapes vanish from the map. They are still in the document — a reload brings
them back — but nothing on screen says so. It reads as live data loss, in front
of the other people in the session.

**Done when:** collab's layer goes through `registerDataLayer` and survives a
basemap switch. Add the case to `dataLayerRender.test.ts`, which already has a
`collab-data` ordering assertion at `:557`.
**Size:** small.

---

## B. Panel polish — visible, cheap

### FU-4 — The drag source is the whole row, not the grip
`LayerPanel.tsx:429` puts `draggable` on the row container;
`LayerPanel.test.tsx:167` asserts exactly that. Since Step 4 the row expands
into a card, so dragging a colour input or the attribute table starts a layer
drag with the full expanded card as the drag image. The pinned grip from Step 6
makes the mismatch more obvious, not less.

**User impact:** Open a layer card, reach for the colour picker or the attribute
table, and you start dragging the layer instead — the whole expanded card
following your cursor as a ghost. You reorder your layers by accident while
trying to change a colour.

**Size:** small. Move `draggable` to the grip, update the test to match.

### FU-5 — `h` can't exit comment mode
`useCommentModeTool.ts` makes picking a tool the exit for both toolbars
(`exitBecauseToolPicked`, `:104`), but the hand tool is indistinguishable from
the tool the mode itself borrows, so `h` is swallowed.

**User impact:** In comment mode every other tool key drops you out. `h` — the
one you press to pan — silently does nothing, and you stay in comment mode with
no feedback. One key that lies about a mode costs more trust than the shortcut
was worth.

**Size:** small, but needs a real decision about what the mode borrows —
don't paper it over with a key-specific special case.

### FU-6 — The ⋯ overflow menu has no roving focus
The rail got roving tabindex + arrow/Home/End in Step 2. The card's overflow
menu didn't. Same pattern, one component over.

**User impact:** Keyboard and screen-reader users can open the layer overflow
menu but can't arrow through it. Everything else the rail touches got arrow keys
in Step 2; this is the gap in that promise.

**Size:** small.

### FU-7 — Map-anchor and element-anchor comment clicks are mutually exclusive
At any instant one of the two can receive a click, never both. That is pointer
routing — Excalidraw's interaction model, not a comment-mode bug. **Research
ticket, not a fix ticket.** Write down what the two anchor kinds should do when
they overlap before anyone touches routing.

**User impact:** Where a map-anchored comment overlaps a shape-anchored one,
only one of them opens, and which one depends on what happens to be on top. You
can see a comment thread and not be able to reopen it.

**Size:** unknown by design. Scope it before sizing it.

---

## C. The gates lie

### FU-8 — `test:all` sabotages itself
`code/package.json:70` — `test:all` runs `test:typecheck` first; `:74` —
`test:typecheck` runs `build:types`, which emits
`packages/excalidraw/dist/{dev,prod}`. After that, 10 fork sidebar tests resolve
`../..` to the built bundle instead of source and fail on a null `useTunnels`.
So the composite gate cannot pass, and every verification run in this sequence
had to run the sub-gates separately. Hit and worked around three times now.

The sibling trap — `playwright.config.ts` hardcoding its dev server to one
absolute checkout, so an e2e run from a worktree tested the wrong tree — **is
fixed** in `aee15c0`. This one isn't.

**Concrete reproduction, from the FU-14 rotation sequence 2026-07-31.** Run
`test:typecheck` *before* `test:app` and the suite goes from 1 failure to 11.
`build:types` emits `packages/{common,math,element,excalidraw}/dist`; the app
suite then loads two copies of the jotai store, `useTunnels()` returns null, and
every Sidebar docking test dies with "not initialized yet". `rm -rf
packages/*/dist` restores the baseline.

**And the obvious escape hatch does not work.** `yarn rm:build` aborts on the
first non-matching glob (`apps/*/dist`) before it ever reaches the package
dists — so the command that looks like it cleans this up silently does not.
That part is a one-line fix in `code/package.json`.

**Impact — contributors, not users.** A new contributor's most obvious first
command fails on a clean checkout, and nothing distinguishes "the repo is
broken" from "I broke it."

**Done when:** `yarn test:all` passes from a clean worktree in one invocation.
**Size:** medium, and it's build config, which is where cheap fixes go to rot.
**See also:** FU-15, the same class of stale-artifact trap one layer down.

### FU-9 — The permanent red
`MermaidToExcalidraw` snapshot fails on pristine `main` and has failed through
every commit of this sequence. Nine messages in this thread say "1 failed (the
pre-existing one)". A suite whose normal state is red trains everyone to read
past failures.

**Impact — contributors, not users.** The next real regression arrives as "2
failed" and reads as normal.

**Done when:** fixed, or quarantined with a linked reason, so green means green.
**Size:** small to triage, unknown to fix.

### FU-10 — Checks that look like checks
Three separate review rounds each found an assertion that could not fail:
StylePanel's "not a dialog any more" test read a stylesheet that still said
`position: absolute`; the hydrate provenance test hid its only assertion behind
an `if`; the SCSS helper's regex stopped at the first `}` and let a nested
`min-height: 0` leak upward into the assertion above it.

The root cause is structural: vitest injects no CSS modules, so
`getComputedStyle` returns `""` and a CSS assertion written against the DOM
passes whatever the truth is. The workaround — asserting against stylesheet
source text — catches a deleted literal line and nothing else. Not a
`flex-shrink: 0` added above the panel, not a cascade reorder from an upstream
merge, not a new wheel handler. The probes that actually caught the Step 6
clipping were the browser ones, now `e2e/layer-panel-scroll.spec.ts`.

**Done when:** two things. (1) Sweep the app suite for assertions that pass
under mutation — start with every `getComputedStyle` and every test that reads a
`.scss` file. (2) Write the rule down in the UI conventions skill: **a claim
about layout gets a Playwright probe; source-text assertions are a
documentation aid, not a gate.**
**User impact — indirect, and the largest on this list.** Two of the three worst
defects in the whole sequence shipped past tests that were structurally
incapable of failing. The layer panel's guarantees are weaker than its test
count implies: nothing in the suite today would stop a future change from
re-clipping the layer list. The user never sees this ticket; they see the bug it
lets through.

**Size:** medium. This is the highest-leverage item in section C.

### FU-15 — Clearing `dist` without `tsconfig.tsbuildinfo` fakes a source error
The fix for FU-8 is `rm -rf packages/*/dist`. Do exactly that and leave
`packages/*/tsconfig.tsbuildinfo` behind, and `tsc -b` believes
`@atlasdraw/geo` is still up to date, skips its declaration emit, and fails
every dependent package with **"has no exported member `GeoCustomData`"**.

The failure names a symbol and a package, so it reads as a real source error.
It is not — the source was fine both times this was hit during FU-14. The cost
is the debugging trip, not the build: you go hunting for a broken export that
was never broken.

**Why it belongs next to FU-8, not inside it.** FU-8 is "the composite gate
sabotages itself." This is "the documented workaround for FU-8 has its own
trap." Fixing FU-8 without fixing this just moves where people lose the hour.

**Done when:** whatever cleans `dist` also clears the matching
`tsconfig.tsbuildinfo` — and `yarn rm:build` is the natural place, once its
glob-abort bug (see FU-8) is fixed.
**Size:** small. Both halves are one line each.

---

## E. PDF export prints the wrong map

Both raised by MIXI 2026-07-30, both traced to source before writing this.
Neither is a regression from the sheet-panel sequence — the PDF path has been
this way since Phase 6 A10.

> **Both fixed in `d29920d` on `fix/pdf-export-composite`** — committed
> 2026-07-31, not yet merged to `main` and not yet pushed. The shape of each fix
> is recorded under its ticket below; the commit body carries what the fixes
> cost and what the test runs actually said.

### FU-12 — The PDF has no shapes in it
`MapEditor.tsx:1196` passes `getMapCanvas={() => map?.getCanvas() ?? null}`.
That is MapLibre's WebGL canvas and nothing else. Excalidraw renders its scene
on a separate canvas stack, so `print-pdf.ts:327` embeds one JPEG containing the
basemap and MapLibre data layers, with every drawn element absent.

This is not a blank-canvas bug — `MapCanvas.tsx:133` sets
`preserveDrawingBuffer: true`, which is why the map half comes through at all.
It is a missing composite.

**The correct code already exists.** `lib/export.ts:18-67` — `exportPNG`
composites exactly this: background, then `drawImage(mapCanvas)`, then
`exportToCanvas` of the Excalidraw scene at the live viewport so zoom and scroll
line up. PNG export is right; the PDF path rebuilt canvas capture from scratch
and skipped the compositing step. Same shape as `ISSUES.md` Issue 5 — a concern
built once for real, then rebuilt worse elsewhere.

**User impact:** You export a PDF and get a basemap with your data layers and
none of your annotations — no pins, no polygons, no lines, no labels, no
freehand. The thing you drew is the reason you exported, so the document is a
picture of everything except your work. Worse than a hard failure, because it
looks like a successful export.

**Done when:** the PDF and the PNG contain the same pixels. Extract the
compositing from `exportPNG` into a shared helper and feed it to both.

**One design note before starting:** `PrintOptions.mapCanvas` is typed
`Pick<HTMLCanvasElement, "toDataURL">` (`print-pdf.ts:55`), and `exportPNG`
composites into an `OffscreenCanvas`, which has `convertToBlob` and no
`toDataURL`. Either composite into a detached `<canvas>` for the PDF path or
widen `PrintOptions` to take bytes. Pick one deliberately — don't discover it
mid-edit.

**Size:** small-to-medium. The hard part is written; this is plumbing plus a
type decision.

**How it was fixed.** `compositeMapScene` extracted from `exportPNG` — one
definition of what an export contains, with `exportPNG` reduced to a wrapper so
the PNG path is unchanged by construction rather than by inspection.
`exportCompositeDataURL` sits on top for consumers that need encoded bytes.

The type decision went to changing the contract: `PrintOptions.mapCanvas:
Pick<HTMLCanvasElement,"toDataURL">` became `mapImageDataUrl: string`.
`OffscreenCanvas` encodes asynchronously and has no `toDataURL`, so a
synchronous canvas-shaped parameter could only have been satisfied by a fake.
`print-pdf.ts` now has no knowledge of canvases, which is what its header
already claimed.

`ExportDialog`'s `getMapCanvas: () => HTMLCanvasElement | null` became
`getMapImageDataUrl: () => Promise<string | null>`, and the compositing moved
inside the dialog's `try` so a renderer failure surfaces as a dialog error
rather than an unhandled rejection.

**The guard was mutation-tested**, per FU-10: deleting
`ctx.drawImage(excalidrawCanvas, ...)` turns the new
`exportCompositeDataURL > composites the Excalidraw scene over the map` red,
along with two pre-existing PNG assertions. Restored and re-verified after.

**A wrong turn worth recording:** the first cut hand-rolled a chunked base64
encoder and failed on `blob.arrayBuffer is not a function` — jsdom 22's Blob
has no `arrayBuffer`, a fact `print-pdf.test.ts` already carried a comment
about. `FileReader.readAsDataURL` does the whole job and leaves no encoder of
ours to get wrong.

### FU-13 — The legend describes the whole document, not the exported view
`MapEditor.tsx:1197-1201` maps `useLayerRegistryStore.getState().entries`
straight to `LayerLegendEntry[]`. No `visible` filter, no bounds test — even
though `visible` is on every entry (`layerRegistry.ts:46`, `:87`) and is exactly
what the eye toggle in the panel writes.

Two defects in one line, and the first is nearly free:

1. **Hidden layers still print.** Turn a layer off in the panel, export, and it
   is in the legend.
2. **Off-screen layers still print.** Zoom to one neighbourhood and export; the
   legend still lists every layer in the project, including ones with no feature
   anywhere near the page.

**User impact:** The legend and the map disagree. Print a detail sheet and the
key describes a document the reader is not holding — which for a printed map is
the one thing a legend exists to prevent.

**Done when:** the legend lists exactly the layers with something painted in the
exported view. `map.queryRenderedFeatures()` returns what MapLibre actually drew
in the current viewport, which is that semantic directly rather than a bbox
approximation — and it already respects visibility, so it subsumes defect 1.
Fall back to `visible &&` bounds-intersect only if querying proves too slow at
25 layers.

**Open question to settle, not to guess:** once FU-12 lands and drawn shapes are
in the PDF, should the legend gain entries for them? The legend is registry-fed
today and annotation layers are registry entries (`layerRegistry.ts:43`), so
they would appear as one grey swatch each. Decide the intent before wiring it.

**Size:** small — one predicate — plus whatever the open question turns into.

**How it was fixed.** New `lib/legend.ts`, three units so each is testable
alone rather than through the React tree:

- `renderedDataLayerIds(map, ids)` — `queryRenderedFeatures` **per layer**, not
  one call for all of them. An id absent from the current style throws, and a
  single throw would otherwise blank the whole legend. An absent layer is
  genuinely not in the exported image, so it is excluded rather than assumed.
- `visibleAnnotationIds(elements, appState, w, h)` — screen box from scene box
  via Excalidraw's own `(scene + scroll) * zoom`, intersected with the exported
  frame. Edge-touching counts as visible: a shape on the border still puts ink
  on the page.
- `buildLegendEntries(entries, ctx)` — `visible` first, because a hidden layer
  is out regardless of the camera and that check needs no map at all.

**Two decisions that went beyond the literal ask**, both reversible in one line:

1. `ExportDialog`'s `layers: LayerLegendEntry[]` became
   `getLegendEntries: () => LayerLegendEntry[]`, evaluated at export time like
   the image. A snapshot taken at dialog-open could disagree with the image if
   the camera were still animating.
2. **The open question above is answered "yes" by this implementation** —
   annotation layers in frame now appear in the legend, one neutral swatch
   each. They are registry entries, so they always could have. If they should
   be excluded, that is a `.filter((e) => e.kind === "data")` and a test.

---

## F. Camera

### FU-14 — Rotate and tilt, and what they do to annotations

> **SHIPPED 2026-07-31 on `feat/map-rotation`, not merged, not run in a
> browser.** Five commits: RT-0 `8749fc0` (rotation off, no way back to north
> yet), RT-1+RT-2 `0d3e567` (`_lastSync` carries `angle`; bbox anchors turn
> instead of skewing), `4505042` (the east probe wrapped at the antimeridian
> and flipped the answer 180°), RT-4 `67c33ce` (the printed north arrow turns
> with the camera), RT-3+RT-9 `a15fbcf` (compass, reset-north, the gestures
> back on for the editor only, and drawing held shut while turned).
>
> **Two departures from the plan below, both deliberate.**
>
> *The rotation is measured, never read.* `cameraRotation()` projects two
> points a hair apart along the centre parallel and reads the angle that comes
> back, so nothing in the geometry path depends on MapLibre's bearing sign
> convention — which matters because nobody has run this app. D2's
> `angle = -bearing` is still what the code computes; it is just no longer
> what the code *assumes*. The single exception is `setCameraRotation`, which
> a control needs because `setBearing` is the only setter there is.
>
> *The bearing round-trip was not built, and documents always open north-up.*
> The plan assumed capture/restore already existed; it did not. Because the
> rotation is measured off the live projection rather than a stored field,
> geometry is correct either way, so this became product taste rather than
> correctness. A document that reopens crooked, with drawing disabled and no
> explanation, is a worse first five seconds than losing a camera angle. Two
> lines to reverse if that reads wrong in use.
>
> **RT-9's shape, since D6 named an option that could not fire.** MIXI chose
> "block drawing while tilted" in the message that dropped tilt. The
> rotation-only reading shipped: the pointer-events gate stays shut while
> `bearing !== 0`, so the drag reaches MapLibre and a turned plate still pans
> and zooms, and a hint carries a one-click Reset north. The atlas tools are
> not blocked — a pin is a point anchor and is exact at every rotation.
>
> Task breakdown lives in
> `PLANS/ATLASDRAW_ROTATION_PLAN.md`: six tasks, **RT-0 first** (close the live
> defect — rotation is reachable and unrecoverable today) and **RT-1 strictly
> before RT-2** (`_lastSync` must carry `angle` before anything writes `angle`,
> or the first camera rotation reads as a user rotation and corrupts the
> anchor). RT-P, RT-5, RT-6, RT-7, RT-8 and RT-10 were dropped with tilt.
>
> Two problems evaporated rather than deferring. Scale is uniform under bearing,
> so **D7's scale-bar half is moot** — `drawScaleBar` and StatusBar stay
> correct; only the north arrow needs the bearing. And at pitch 0 there is no
> behind-the-camera case, so **D5 does not apply** and no overlay needs a cull
> rule. `maxPitch: 0` stays, and the OQ-2 rationale in the `MapCanvas.tsx`
> header stays true.
>
> The analysis below is preserved as written, including the decisions that the
> tilt drop retired. Read it as the reasoning, not the plan.

Raised by MIXI 2026-07-30: enable tilt and rotate with appropriate gestures,
without breaking annotations. Traced end to end by Chief Opus against source at
`cc2ce53`; **no code touched, and this was a decision ticket, not an
implementation ticket.**

**Where the app is today, and it is in neither coherent position.** Tilt is
locked at construction — `packages/basemap/src/MapCanvas.tsx:128` sets
`maxPitch: 0` and `pitchWithRotate: false`, so no gesture and no `setPitch()`
can produce one. Rotation, however, is *on by default and almost certainly
unintended*: `dragRotate` is disabled in exactly one place (`EmbedView.tsx:213`,
under `?lock=1`), the editor map passes no such option, and the Excalidraw plate
is `pointer-events: none` unless you are drawing — so a right-drag reaches the
map. There is no `NavigationControl`, no compass and no `resetNorth` anywhere in
`apps/` or `packages/`, so **there is no way back to north**, and `bearing`
round-trips in the file format. A user can rotate the map today and cannot
undo it.

**Rotate and tilt are not the same size of problem.** Mercator is conformal, so
under bearing alone a geographic bbox lands on screen as a rotated rectangle —
which Excalidraw represents natively via `angle`. Under pitch it lands as a
trapezoid with curved edges, and an Excalidraw element has no shear and no
perspective. Rotation is exactly representable; tilt is not, and the choice is
which approximation to ship.

**Smaller blast radius than it looks.** `CoordinateSync.ts:277-290` projects
polyline vertices individually, so lines, arrows, freedraw and polygons are
already correct at any bearing and any pitch, for free. Point anchors are
already correct for position. It is only `bbox`, and only *size*, that breaks.

The decisions, in the order they constrain each other:

- **D1 — gestures and pitch cap.** Right-drag conflicts with Excalidraw's
  context menu. Default: leave right-click alone; bind rotate/tilt to a
  draggable compass, shift+arrows, and the touch gestures. Cap `maxPitch` at 60,
  not 85 — past ~60 the horizon enters the frame and everything below gets worse.
- **D2 — rotation: write `angle`.** `angle = -bearing` plus width/height from
  the unrotated span is exact. Costs two things: `excalidrawTypes.ts:12-14`
  states that projection writes only `x/y/width/height/points`, which stops
  being true; and `reanchorIfMoved` (`useGeoAnchor.ts:333+`) separates user
  edits from camera moves by diffing `_lastSync`, which has no angle field — so
  a camera rotation would read as a user rotation and corrupt the anchor.
  `_lastSync` must carry `angle` in the same commit. This is the whole of
  rotation, and it is small.
- **D3 — tilt: the real fork, and a rendering-model decision. NEEDS MIXI.**
  Four honest answers in ascending cost: (1) billboard — cheap, visibly wrong
  for anything bigger than a pin; (2) drape by degrading area shapes to
  densified polylines, so the existing vertex-wise projection does the work —
  correct and built on shipping code, but a rectangle stops being a rectangle
  and you pick a densification count; (3) forbid tilt while any bbox annotation
  exists — honest, cheap, annoying; (4) render annotations as a MapLibre GeoJSON
  layer when pitched — correct, a different pipeline, and you lose Excalidraw
  editing while tilted. **Chief Opus's default is 2.**
- **D4 — things with a size rather than a shape.** Under pitch the ground scale
  varies down the screen, while `computeScaleFactor` (`scaleMode.ts:41`) is one
  `2^(zoom-zRef)` for the whole scene. Billboard text, pins and stroke widths at
  constant screen size (what every map does with labels), or derive a
  per-element factor from local ground resolution. Default: billboard. Touches
  the only creation mode there is — `useGeoAnchor.ts:8-10` stamps
  `scaleMode: "geographic"` on everything.
- **D5 — behind the horizon. Not optional.** `map.project` on a coordinate
  behind the camera plane does not fail; it returns a mirrored point, so an
  annotation off the back of the camera reappears somewhere absurd. This is what
  will make a first tilt demo look broken. Every consumer needs a cull rule —
  `CoordinateSync`, `CommentAnchorsOverlay`, `CursorOverlay` — and a decision on
  what a culled element does (vanish, or clip at the horizon). **Verify with a
  live probe before designing around this description.**
- **D6 — drawing while the camera is not north-up-flat. ANSWERED: block. This
  is what unblocked FU-2.** Unprojecting the pointer is fine at any camera; the shape is
  not. Drag a rectangle at bearing 30 and unprojecting its corners gives a
  north-aligned bbox that is not the box you dragged. Snap-to-north when a
  drawing tool is picked, block drawing while tilted, or stamp a 4-vertex
  polyline instead of a bbox.
- **D7 — the collar lies under rotation.** `print-pdf.ts:368` calls
  `drawNorthArrow(page, font, x, y)` with no bearing parameter, so the printed
  arrow points up on every sheet. `drawScaleBar` (`print-pdf.ts:199`) and
  StatusBar assume a single scale, which pitch breaks top-to-bottom. Cheap fix;
  decide whether a pitched sheet prints a scale bar at all.
- **D8 — collab drops tilt on the floor.** `MapCameraPayload`
  (`realtime-events.ts:24-29`) and `AwarenessState.viewport` (`:138`) carry
  `bearing` but not `pitch`, so follow-mode would flatten a peer camera. The
  file format already stores both (`manifest-schema.ts:29-30`) — a two-field
  protocol decision, not a design one.
- **D9 — cost.** `useCoordinateSync` already re-projects every geo element on
  `move|zoom|rotate|pitch` at 16ms (`useCoordinateSync.ts:51`), so a rotate
  gesture costs what a pan costs. D3's densification is the multiplier to watch.

**User impact.** Today: you can rotate the map by accident and never get back to
north, and bbox-anchored shapes visibly detach when you do. After: whatever D3
decides is what a tilted sheet looks like.

**Done when:** ~~MIXI answers D3 and D6~~ — answered 2026-07-31. **D3: none of
the four — tilt is dropped**, so no bbox annotation ever has to survive a
pitched camera. **D6: block** — drawing tools are disabled while
`bearing !== 0`, and the blocked state offers one-click reset-north via the
compass RT-3 builds anyway. Chief Opus flagged one reading in that answer:
"block drawing while tilted" arrived in the same message that dropped tilt, so
as literally written it could never fire; the rotation-only equivalent above is
the faithful implementation. If option 1 (auto-snap to north when a tool is
picked) was meant instead, the difference is one click — say so and RT-9 changes
shape.

Now done when the six RT tasks land.

**Size:** rotation, medium. Tilt is not being estimated, because it is not being
built.

---

## D. Parked, with a kill criterion

### FU-11 — uMap promote-to-inspector
Offered in §4 as the escape hatch if a 25-layer prototype still felt bad. It
felt bad because the list was *clipped*, not because it was a column — so the
counterargument (QGIS's legend explosion, Felt abandoning the single column) was
never under test. Retested with scrolling: accordion + filter + resize holds.

**Kill criterion:** watch one real session with 25+ layers. If the column still
loses people, build the inspector. If it doesn't, delete the option from §4 —
don't leave it sitting there as a permanent maybe.

---

## Doc hygiene

`PLANS/ATLASDRAW_SIDEBAR_DESIGN.md` §"Three decisions I want from you" is now
answered by what shipped: preconditions went first, comments became a mode, and
the `registerSidebarTab` widening is in `DefaultSidebar.tsx`. Strike the section
or convert it to a record of what was decided — a doc that asks for decisions it
already got is the doc-drift pattern `ISSUES.md` Issue 2 is about.

---

## Order I'd take them in

~~1. **FU-12**~~ ~~2. **FU-13**~~ — shipped: `d29920d`, merged `0b0de34`, pushed.
~~3. **FU-14 D3 and D6**~~ — answered 2026-07-31.
~~4. **FU-14 RT-0..RT-9**~~ ~~5. **FU-2**~~ — shipped 2026-07-31 on
`feat/map-rotation`, five commits, unmerged.

1. **Merge `feat/map-rotation`, and run the app before you do.** Everything on
   that branch was verified by reading source and by tests; nobody has opened
   the editor. The claims most worth a live check are the ones a test cannot
   make: that the compass is clickable where it sits (bottom-left, z-index 10,
   above `.atlasToolOverlay`), that two-finger twist reaches the map through
   the Excalidraw plate, and that a turned map draws its annotations turned.
2. **FU-1** — the PRD job that isn't met, and the only real capability gap.
3. **FU-10** — before the next feature, because it's what makes the next
   feature's tests mean anything.
4. **FU-3, FU-4, FU-5, FU-6** — one small batch, one review round.
5. **FU-8 + FU-15, FU-9** — build config, do them when something else is
   compiling. Take FU-8 and FU-15 together; fixing either alone just relocates
   the lost hour.
6. **FU-7** — scope only. **FU-11** — observe only.

FU-2 dropped from third to last when the claim behind it collapsed, got blocked
outright when MIXI asked for rotate and tilt, was unblocked by the decision to
drop tilt, and is now done. It moved three times without a user ever being able
to tell.

The split inside FU-14 held up in the doing. RT-0 *removed* a behaviour and
went first on its own; everything after it *added* one, and every commit in
between was safe to stop at.
