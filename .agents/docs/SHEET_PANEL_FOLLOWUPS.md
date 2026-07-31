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
| FU-1 | **step one shipped** — drop a GeoTIFF, it places itself. RA-7/8/9 open | `73236d7`; plan in `PLANS/ATLASDRAW_RASTER_PLAN.md` |
| FU-2 | **done — the seven are deleted** | twice over: `6497dd8` on `main`, `8cb12be` on `feat/map-rotation`; see the merge note below |
| FU-3 | **done** | `main` — the collab layer survives a style swap |
| FU-4 | **done** | `main` — grip is the only drag source |
| FU-5 | **resolved — not a defect**, see ticket | disproved in a browser; probe kept |
| FU-6 | **done** | `main` — roving tabindex on the ⋯ menu |
| FU-7 | open, scope only | — |
| FU-8 | **done — `yarn test:all` passes in one invocation** | `main`; it had five faces, not three |
| FU-15 | open, and narrower than it was | FU-8 took `dist/` deletion off the path, so the stale-`tsbuildinfo` trap is now only sprung by clearing outputs by hand |
| FU-9 | **done** | `main` — the snapshot was stale, not broken |
| FU-10 | **done** | `main` — 3 fixed, and `yarn test:falsifiable` keeps them fixed |
| FU-11 | parked with a kill criterion, deliberately | — |
| FU-14 | **done, on `main`** | merged `949a4ed`; shipped a crash fixed at `c9960fa`, twist coverage `d0062c4` |
| FU-16 | open — filed 2026-07-31 | a local `playwright test` attaches to a stranger's dev server |
| FU-17 | open — filed 2026-07-31 | the app honours two of the three pan gestures its inherited hint advertises |

12 of 17 done, 1 closed as not-a-defect. FU-16 and FU-17 both came out of the
first time anyone ran this app in a browser; see section C. The note below is
kept for the record of how FU-14 landed — and the only
work in this file nobody has run in a browser. What is left is FU-1 (a feature,
blocked on one decision from MIXI), FU-15 (narrow), FU-7 (scope only) and FU-11
(observe only).

**FU-2 was deleted twice.** Honey deleted the seven on `main` (`6497dd8`) while
Fizz deleted them on `feat/map-rotation` (`8cb12be`), the same afternoon, from
the same ticket. Git merged it without drama — the files agree about being gone
— but four prose conflicts had to be resolved by hand. The ledger is what was
supposed to prevent this and it did not, because both agents read it before the
other's commit existed. Worth a rule: claim a ticket in the table before you
start it, not when you finish.

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
Anything else falls to the error path. PRD §4 job 1 is raster import; it is not
met.

**User impact:** You drag a GeoTIFF onto the map and get an error toast. Every
raster workflow is closed — scanned survey sheets, satellite imagery,
elevation, historical map plates. For a tool pointed at archives, that is the
format most likely to arrive first.

**Scope re-verified 2026-07-31, and this ticket was under-sized.** It sits in a
list of panel follow-ups next to "move `draggable` to the grip". It is not that
kind of item, and calling it "the only real capability gap" made it sound like
one missing branch in `detectExt`. What is actually missing:

| | verified how |
|---|---|
| **No GeoTIFF decoder, and no dependency for one.** | `geotiff`/`georaster` appear in no `package.json` in the repo |
| **No raster path anywhere.** | `grep -rn raster` over `apps/atlas-app/src`, `packages/data/src`, `packages/basemap/src` → 3 hits, all prose in unrelated comments |
| **The registry cannot hold a raster.** | `LayerRegistryEntry = AnnotationLayerEntry \| DataLayerEntry`, and `DataLayerEntry` is vector-shaped: `featureCount`, `style: LayerStyle` (fill colour, opacity, expression). A raster has no features and none of that style |
| **Reprojection is unsolved.** | GeoTIFFs routinely arrive in a projected CRS; nothing in `packages/geo` reprojects raster grids |

A third `kind` in the registry is not a local change: `reconcileDataLayers`,
`applyOrderToMap`, `hydrate`, the panel card, and the PDF legend all switch on
`kind` today.

**One claim in the original ticket was wrong.** It cited
`packages/data/src/thumbnail.ts` as complete-but-uncalled, implying a raster
path already half-built. `thumbnail.ts` renders an `HTMLCanvasElement` to a
1024×768 PNG for the `.atlasdraw` container's `meta/thumbnail.png`. It has
nothing to do with importing rasters. It is genuinely uncalled — that part is
true — but it is not evidence for this ticket.

**The decision that gates it, and it is MIXI's:** does a raster become a third
registry `kind`, or does it live outside the registry with its own lifecycle,
the way `collab-data` does (FU-3)? Everything else follows from that answer, and
answering it wrong costs a migration of every `switch (kind)` in the app.

**Shipped meanwhile, and it is not the feature.** The error message. Dropping a
`.tif` said *"unsupported file type"*, which tells the user their file is wrong
when the file was correct and the app is not. It now names the format and says
*"GeoTIFF import isn't supported yet"* — same for GeoPackage, KML and GPX,
which are the other formats an archive will hand you. `KNOWN_UNBUILT` in
`useDataFileImport.ts` picks the wording only; nothing routes on it, and an
entry gets deleted the day its importer lands.

**Size:** the honest answer is "a feature", and it should be a plan, not a row
in this table.

**STEP ONE SHIPPED 2026-07-31** — `73236d7`, merged on top of rotation.
RA-1 the third registry kind, RA-2 the decoder, RA-3 the map write, RA-4 the
drop path, RA-5 the panel row, RA-6 persistence, plus a Playwright probe.
MIXI chose Option A. Open: RA-7 opacity, RA-8 legend entry, RA-9
full-resolution — all held deliberately until someone has a scan on screen to
judge them against.

**One correction this ticket earned.** Its scope note said there was "no raster
path anywhere", citing a grep over `apps/atlas-app/src`. That was true of that
directory and false of the app: Excalidraw's native image tool is enabled, and
`useGeoAnchor` stamps `image` elements as a geographic bbox
(`useGeoAnchor.ts:12-18`), so a dropped PNG already moved with the map. MIXI
caught it. The same mistake FU-5 was — searching one place and treating the
absence as a fact about the whole system.

The existing path still does not do the three things this one exists for: TIFF
is absent from `IMAGE_MIME_TYPES` (`packages/common/src/constants.ts:237`);
nothing reads georeferencing, so a PNG lands where you dropped it; and
`.excalidrawLayer` is z-index 1 over `.mapLayer` at 0, so a full-opacity image
covers the data layers. A raster layer reads the file's own coordinates and
sits underneath. Both routes were put to MIXI with the trade written out, and
this one was kept.

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

**EXECUTED 2026-07-31.** Fourteen files deleted (seven tools, seven tests),
`index.ts` down to one import and one registration, `registry.test.ts` rewritten
to assert the registry's actual property rather than a count — plus a case that
the seven ids no longer resolve, since "deleted" and "renamed" look identical
from the outside. The consumer grep was re-run at deletion time, not trusted
from the paragraph above; same result.

**One thing done differently from the plan above.** It said the
`seedToElement.ts` comments should stay because they explain the geometry.
Half right: they explain the geometry *by naming a class that no longer
exists*, which is a dangling reference the next reader has to go looking for.
The geometry survives, the names are gone — "T09 CircleTool — center point +
default diameter" became "Center point + default screen-pixel diameter".

**What was NOT deleted, and why.** `seedToElement`'s branches for freedraw,
line, arrow, rectangle, ellipse and text now have no *built-in* producer, only
PinTool. They stay: `AtlasdrawElementSeed` is a public type and `registerTool`
a public entry point, so the bridge's contract is to accept any seed the union
permits. Narrowing it to what ships today would be a different decision than
the one this ticket made. Same reasoning keeps the registry with one tool in
it — its users are the tools registered from outside.

**Size:** small. The work was the decision, and the decision was made.

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

**DONE — but not the way this ticket proposed.** The layer now re-adds itself
on `styledata`, the same signal `useBasemapStyle` reconciles the registry on.
Six cases in `useCollabDataLayer.test.ts`; four of them fail with the listener
removed, checked.

**Why not `registerDataLayer`.** The registry is what the LayerPanel renders,
so an entry there arrives with rename, delete, restyle and reorder — four
controls that would all lie about a Yjs-owned layer, and a delete that undoes
itself on the next sync. It would also need the FeatureCollection mirrored into
`useDataLayerFCStore`, duplicating the Yjs doc as app state. And
`dataLayerRender.test.ts:557` already encodes the opposite decision: it asserts
`collab-data` is a *non-registry* layer that `applyOrderToMap` must leave
alone. Machine-owned layers keep their own lifecycle; they just have to *have*
one across a style swap.

**Left unspecified on purpose:** where the collab layer sits in the stack after
a swap. Nothing ever specified it, the re-add order now depends on listener
registration order, and inventing a rule here would be inventing a requirement.
Worth deciding if anyone ever notices.

---

## B. Panel polish — visible, cheap

### FU-4 — The drag source is the whole row, not the grip — **DONE**
`LayerPanel.tsx:429` put `draggable` on the row container;
`LayerPanel.test.tsx:167` asserted exactly that. Since Step 4 the row expands
into a card, so dragging a colour input or the attribute table started a layer
drag with the full expanded card as the drag image. The pinned grip from Step 6
made the mismatch more obvious, not less.

**Shipped on this branch.** `draggable` and `onDragStart` moved to the grip; the
drop handlers stayed on the row, because you aim a drop at a row and not at its
grip. The drag image is now the header line — the grip alone is a 12px smudge
you cannot aim with, and the row is the whole card again.

**It subsumed a second mechanism.** `dragDisabled`, which dropped `draggable`
off the row while renaming so a press-and-sweep over the input would not start a
reorder, existed only because the row was draggable. With `draggable` on the
grip the input has no draggable ancestor at all, so the prop and both call sites
are deleted rather than kept as a no-op. Its test now walks the real ancestor
chain instead of asserting a prop that no longer exists.

**User impact:** Open a layer card, reach for the colour picker or the attribute
table, and you start dragging the layer instead — the whole expanded card
following your cursor as a ghost. You reorder your layers by accident while
trying to change a colour.

**Size:** small. Move `draggable` to the grip, update the test to match.

### FU-5 — `h` can't exit comment mode — **RESOLVED: it can**

**This ticket describes behaviour the app does not have.** Disproved in a real
browser on 2026-07-31, chromium and firefox:
`apps/atlas-app/e2e/comment-mode-keys.spec.ts`. Pressing `h` in comment mode
leaves the mode and lands on the previous tool, exactly like `r` does.

The reasoning was two true facts and a false join. The mode does borrow `hand`
(`useCommentModeTool.ts`), and the exit watcher does ignore `hand`. But `h` is
not "pick the hand tool" — it is `actionToggleHandTool`
(`packages/excalidraw/actions/actionCanvas.tsx:567`), a **toggle**. With `hand`
already active it moves the tool *away* from `hand`, to
`activeTool.lastActiveTool` or `selection`. The watcher sees a real change and
exits. There was never a key to special-case.

**Why the suite agreed with the ticket.** `commentMode.test.tsx` had a case
named *"stays in the mode when the tool is set to `hand`"* whose fake API sets
the tool directly. That is a fair model of a programmatic re-assert and a wrong
model of a keystroke, and reading it as the latter is where the ticket came
from. The case is renamed and now says which one it is.

**What is kept:** the e2e probe, covering Escape, `r` and `h` — the whole
keyboard surface of the mode. Note webkit could not be run here (the host is
missing `libicu74`, `libxml2`, `libmanette-0.2-0`; `playwright install-deps`
needs root), so the claim is chromium + firefox, not all three projects.

**The real lesson is FU-10's.** A test that models a keystroke with a
direct state write cannot fail when the keystroke does something else, and this
one invented a whole ticket. Behavioural claims about keys get a browser.

### FU-6 — The ⋯ overflow menu has no roving focus — **DONE**
The rail got roving tabindex + arrow/Home/End in Step 2. The card's overflow
menu didn't. Same pattern, one component over.

**Shipped on this branch.** The menu's three buttons became a list rendered
from data, which is what makes the roving tabindex one loop rather than one
`tabIndex` expression per button — and the two views (actions, delete-confirm)
have *different lengths*, which is exactly what hand-written indices get wrong.
Opening focuses the first item; ArrowUp/Down wrap; Home/End jump.

**One thing found while fixing it, beyond the ticket.** The confirm step swaps
the whole item list out. Without moving focus on that swap, a keyboard user who
steps into "Delete…" is left focused on a button that no longer exists — the
two-step delete guard becomes a keyboard trap instead of a safety net. Focus
follows the swap, and a test pins it.

**Size:** small. It was.

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

**DONE 2026-07-31 — `yarn test:all` exits 0 in one invocation.** It had five
faces, not three. Each was hiding behind the one before it, which is why the
count kept going up every time someone looked.

**Face 1, the dist poisoning — fixed at the root, and the root is three
characters.** Three files imported `from "../.."`. That resolves the package
*directory*, so Vite reads `packages/excalidraw/package.json` and follows
`main` to `./dist/prod/index.js`. With no `dist/` it silently falls back to
`index.tsx` and everything passes; once `test:typecheck` has built `dist/`, the
same import loads the **bundle** and dies on a null `useTunnels`. They now say
`../../index`, which does not depend on build state. Verified the hard way:
built `dist/` on purpose, then ran all three suites green with it present.

    packages/excalidraw/components/Sidebar/siderbar.test.helpers.tsx
    packages/excalidraw/components/FontPicker/FontPicker.test.tsx
    packages/excalidraw/components/Stats/stats.test.tsx

**Face 2 — "a full run cannot produce a true number" — dissolves with face 1.**
Nothing about the ordering was ever wrong; one import was.

**Face 3, the TS6305 trap, is defused rather than fixed.** Deleting `dist/`
leaves the five `tsconfig.tsbuildinfo` files, so `tsc -b` believes it is up to
date, skips the rebuild, and typecheck fails with 6× TS6305. That is inherent
to deleting outputs without their build info — but nobody has to delete `dist/`
any more, so the trap is off the path. If you ever do clear it, clear the
tsbuildinfo files in the same breath.

**Face 4 — `test:code` could never pass.** `eslint --max-warnings=0` against 17
pre-existing `import/order` warnings in 10 files. All auto-fixable, all fixed.
A gate whose threshold is zero and whose baseline is seventeen is not a gate.

**Face 5 — `test:other` could never pass either.** `prettier --list-different`
reported 37 files: 31 markdown, 5 JSON, 1 HTML, **zero source**. 34 of them
were formatted. The other three were not, and that is the interesting part:
they are the MapLibre style documents in `packages/basemap/src/styles/`, and
prettier collapses them by **~10,000 lines each**. Reformatting 26,000 lines of
third-party runtime data to satisfy a formatter is not a fix — it buries every
future real change in those files. They are ignored instead.

Which surfaced a sixth thing, small but load-bearing: the `prettier` script
pointed `--ignore-path` at **`.eslintignore`**, so prettier's exclusions could
only be expressed as eslint's, and `.prettierignore` existed but was empty and
had no effect. It points at `.prettierignore` now, which carries what
`.eslintignore` carried plus the two prettier-only entries.

**Proof:** `yarn test:all` → **exit 0**, 243 test files, 2780 passed, 0 failed.
First time the composite gate has passed.

**Size:** medium. Face 1 was three characters; the rest was bookkeeping nobody
had done because the gate that would have caught it was the broken thing.

### FU-9 — The permanent red
`MermaidToExcalidraw` snapshot fails on pristine `main` and has failed through
every commit of this sequence. Nine messages in this thread say "1 failed (the
pre-existing one)". A suite whose normal state is red trains everyone to read
past failures.

**Impact — contributors, not users.** The next real regression arrives as "2
failed" and reads as normal.

**DONE 2026-07-31 — the snapshot was stale, and it was never a bug.** Diffed
the stored snapshot against the received one character by character: the single
difference is an inserted `<button class="Dialog__close">`. That button is
commit `694a95c`, *"fix(excalidraw): always render the Dialog close button"* —
a deliberate a11y fix, because on desktop the vendored Dialog rendered no close
button, so an error dialog had no visible dismissal and, with zero focusable
elements, Modal's focus-scoped Escape handler never fired either. The fix was
right; the snapshot was simply never updated with it.

So the permanent red was a correct change and a stale expectation, sitting
there long enough that nine messages in one thread wrote "1 failed (the
pre-existing one)" and moved on. That is the cost the ticket named, and it is
now the only ticket on this list whose fix was a one-line `-u`.

**Size:** small to triage, one command to fix. The triage was the work.

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

**DONE 2026-07-31, both halves.**

**(1) The sweep.** The first pass used a regex and produced 20 hits, most of
them false — which is the joke writing itself, so it was redone against the
TypeScript AST. Three genuine cases in atlasdraw-owned code, each an instance of
a pattern that had already shipped a defect:

| | |
|---|---|
| `useMapWheelRouter.test.ts:70` | **no assertion at all.** A comment said the event "should pass through untouched"; nothing checked it. Could fail only by throwing. Now asserts that neither `preventDefault` nor `stopPropagation` was called — which is what "untouched" means for a router whose entire job is those two calls. |
| `StylePanel.test.tsx:126` | **every assertion inside two nested `if`s.** If Apply wrote nothing, or wrote a graduated expression, both guards go false and zero assertions run. Narrows by asserting the narrowing condition, then projecting. |
| `apps/storage/src/config.test.ts:52` | same shape, and worse: *"honors an explicit DATA_DIR"* had its **only** assertion inside `if (cfg.STORAGE_MODE === "sqlite-fs")`. A `loadConfig` returning the wrong mode entirely passed. `toMatchObject`, no narrowing. |

The `getComputedStyle` / stylesheet-reading tests the ticket named as the
starting point were already hardened by the Step 6 review rounds — one
`getComputedStyle` in app code and it is production, in `useMapWheelRouter`.

**The fixes are the smaller half.** `scripts/find-unfalsifiable-tests.mjs` makes
the sweep repeatable, and `yarn test:falsifiable` runs it inside `test:all`. It
catches both patterns and is deliberately conservative about what counts as an
assertion — same-file helpers like `expectClean`, and throwing queries like
`findByText`, count — because a checker that cries wolf gets ignored exactly
like the suite it is checking. Verified against a canary file carrying one of
each defect plus one healthy case: both caught, the healthy one untouched.

What it cannot catch is an assertion that runs and is merely weak. That is the
rule, not the script.

**(2) The rule is written down** in `.claude/skills/atlasdraw-ui-conventions/`
under *Testing a UI claim*, with a table of which claim belongs in vitest and
which needs a browser, and two checklist lines. It covers keyboard and focus as
well as layout, because FU-5 was a keyboard claim modelled with a fake API and
it cost a whole fictional ticket.
**User impact — indirect, and the largest on this list.** Two of the three worst
defects in the whole sequence shipped past tests that were structurally
incapable of failing. The layer panel's guarantees are weaker than its test
count implies: nothing in the suite today would stop a future change from
re-clipping the layer list. The user never sees this ticket; they see the bug it
lets through.

**Size:** medium. This is the highest-leverage item in section C.

---

**Addendum 2026-07-31 — the rotation wave produced four more, and they are two
shapes the scanner cannot see.** Recorded here rather than as a new ticket
because FU-10's fixes still stand; what follows is the part its own closing line
predicted — *"what it cannot catch is an assertion that runs and is merely
weak. That is the rule, not the script."*

**Shape 1 — the assertion runs and measures the wrong thing.**

| | |
|---|---|
| `cameraRotation.test.ts:183` | `setCameraRotation(map, 137)` then `expect(-bearing).toBe(137)` — asserting `-(-137) === 137`. True for every possible sign convention, including a wrong one. Replaced by `cameraRotationRoundTrip.test.ts`, which goes out through the convention and back through the measurement against real Mercator. |
| the first draft of `mapRotationDriftLoop.repro.test.ts` | asserted *"at most one corrective sync"* — a property of the re-entrancy guard, not of the reference fix. It stayed **green with the correctness defect reinstated**, because the cheaper of the two defects masked the other. Now asserts zero, which is what the header claims. |

**Shape 2 — the setup silently does nothing, so the assertion measures an
untouched system.** This is the new one, and it is the more dangerous of the
two because it leaves no trace anywhere:

| | |
|---|---|
| the first draft of `map-rotation-touch.spec.ts` | twisted two fingers without first picking up the hand tool. The plate captures pointer events under every tool but `hand` (`classifyTool.ts:20`), so nothing reached the camera and the spec would have reported two-finger twist as **dead** — a feature that works. |
| a manual gate probe during review | pressed `h` to select the hand tool; the keypress did not land, so the control row and the test row both ran under `selection` and both reported "no pan". A positive control that never exercised the thing it controlled for. |

**The scanner catches neither, and should not be expected to.**
`find-unfalsifiable-tests.mjs` is a syntax walk over assertion presence and
guard nesting. Shape 1 needs arithmetic relating actual to expected — a solver.
Shape 2 needs to know what state the test intended to reach, which is nowhere in
the file. Do not read a clean `yarn test:falsifiable` as coverage of either.

**Two rules, both cheap, both would have caught these on the first run:**

1. **A setup step that can fail should assert it succeeded, in the same test,
   before the thing it sets up for.** The worked example already ships:
   `pickUpHandTool` (`apps/atlas-app/e2e/map-rotation-touch.spec.ts:105`) does
   not just click the tool, it then asserts the Excalidraw layer has gone
   `pointer-events: none` — so the helper fails at the point of failure rather
   than handing a silently-unchanged system to the assertion below it. One line,
   and Shape 2 stops being invisible.
2. **A claim handed to a teammate should carry what would falsify it.** *"Neither
   bypass has coverage"* travelled two messages and into a filed ticket before
   anyone opened the test files — there were 18 cases across the two.
   It survived review because it arrived as a conclusion with its evidence
   stripped off, so there was nothing to disagree with. *"I grepped
   `apps/atlas-app/src/hooks` for `*.test.ts` and found none"* would have been
   wrong out loud and dead in one command.

Rule 2 is not a testing rule and is kept here anyway: the same failure — a check
that cannot come back false — moved from the suite into the conversation, and
cost a commit rather than a round.

### FU-15 — Clearing `dist` without `tsconfig.tsbuildinfo` fakes a source error

**Narrowed 2026-07-31 by FU-8's real fix.** This was filed when `rm -rf
packages/*/dist` was the standing workaround for the dist-poisoning bug. FU-8
turned out to be three characters in three import paths, so nobody has to
delete `dist/` any more and the trap is off the normal path. It is still live
for anyone who clears build outputs by hand — which is what FU-8's own ticket
now tells you to do "in the same breath" as the tsbuildinfo files, an
instruction that only works if you remember it.

Clear `dist` and leave
`packages/*/tsconfig.tsbuildinfo` behind, and `tsc -b` believes
`@atlasdraw/geo` is still up to date, skips its declaration emit, and fails
every dependent package with **"has no exported member `GeoCustomData`"**.

The failure names a symbol and a package, so it reads as a real source error.
It is not — the source was fine both times this was hit during FU-14. The cost
is the debugging trip, not the build: you go hunting for a broken export that
was never broken.

**Why it was filed beside FU-8 rather than inside it.** FU-8 was "the composite
gate sabotages itself"; this is "the documented workaround for FU-8 has its own
trap". Fixing FU-8 the way it was originally scoped would only have moved where
the hour was lost. It got fixed a better way instead, which is what shrank this
ticket rather than closing it.

**Done when:** whatever cleans `dist` also clears the matching
`tsconfig.tsbuildinfo` — and `yarn rm:build` is the natural place. Still
`rimraf --glob apps/*/dist packages/*/dist packages/*/build` at
`code/package.json:92`, so the glob-abort FU-8 describes is also still there:
it gives up on `apps/*/dist` before reaching the package dists, which makes it
a no-op for exactly the directories that matter.
**Size:** small. Both halves are one line each.

---

### FU-16 — A local e2e run attaches to whatever is already on :5174

`apps/atlas-app/playwright.config.ts` sets `reuseExistingServer: !process.env.CI`.
Locally that means Playwright does **not** start a server: it uses whatever is
already listening, whoever started it, at whatever commit that process was
launched from. The tests then report on a tree nobody chose.

This is the fourth artifact-staleness trap on this ledger, after FU-8, FU-15 and
the stale Vite transform that opened the rotation crash thread. Same family
every time: **an artifact outliving the source that produced it.**

Two ways it has already cost something:

- A dev server started before a merge kept serving the pre-merge module for
  hours. The reported symptom was a missing export that existed on disk —
  `setCameraRotation`, `2026-07-31`. Restarting the server was the whole fix,
  and it took a sourcemap dump to establish that.
- **It silently weakens mutation checks.** Mutate a source file, run the e2e
  suite, and if the attached server is holding the unmutated module the test
  stays green — which reads as "the mutation was not caught" when the mutation
  never reached the browser. A mutation check that cannot see its own mutation
  is the FU-10 class wearing different clothes.

`playwright.clean.config.ts` (`d0062c4`) is the current answer: it boots its own
server on a dedicated port. It works, and it is opt-in — the default config is
still the one anyone types `yarn e2e` into.

**Done when:** the default local run cannot attach to a foreign server. Either
`reuseExistingServer: false` outright, or a fixed dedicated port plus a startup
assertion that the server it reached is serving this working tree. The second is
better: it catches the class rather than the instance.
**Size:** small. One config line, or one line plus a health check.

---

### FU-17 — Middle-drag is advertised by the UI and wired to nothing

Under the default selection tool the Excalidraw plate captures pointer events —
`classifyTool` is `toolType !== "hand"` (`packages/tools/src/classifyTool.ts:20`),
a deliberate `atlasdraw-dd91` resolution — so a plain left-drag does not pan the
map. Two escape hatches exist because of that gate, and both were built on
purpose: **wheel**, via `useMapWheelRouter` (`apps/atlas-app/src/hooks/useMapWheelRouter.ts:2`,
whose header says it routes wheel events to the map regardless of which layer is
on top), and **space+drag**, via the bridge at
`useExcalidrawChangeHandler.ts:134` that forwards Excalidraw's own scroll-pan
delta onto `map.panBy`.

Measured under the selection tool, twice independently: left-drag leaves the
centre unmoved, wheel zooms 4 → 5.4 with the centre tracking the cursor,
space+drag moves 78.5000E 30.1297N → 76.0022E 31.2751N, and hand + left-drag
moves as the positive control.

**The gap is one gesture, not the pair.** Excalidraw's hint reads *"To move
canvas, hold Scroll wheel or Space while dragging, or use the hand tool"* — a
vendored locale string (`packages/excalidraw/locales/en.json:359`, with `:736`
supplying "Scroll wheel"), not a promise this app authored. Middle-button drag
does not pan the map and cannot: the bridge is gated on `spaceHeldRef.current`
and the scroll reset below it runs unconditionally, so a middle-drag pans
Excalidraw's canvas and then has it zeroed with nothing carrying it to the
camera. Grepping `apps/` and `packages/{basemap,tools}` for middle-button
handling returns one type comment (`packages/tools/src/types.ts:28`) and nothing
else.

So the app honours two of the three gestures its inherited hint advertises, and
a user who follows the hint's first suggestion gets silence.

**What this ticket is not.** It was first drafted as "both bypasses are
untested". That was wrong and worth recording as wrong: `useMapWheelRouter.test.ts`
carries 15 cases including the routing itself, modifier pass-through and
scroll-port yielding, and `useExcalidrawChangeHandler.test.ts:164-202` covers the
bridge three ways — bridges when space is held, refuses a `scrollToContent`-sized
jump, refuses when space is not held. Both escape hatches are among the
better-covered code in the app. The claim came from reading a call site instead
of the hook, and survived one repetition before anyone opened the test files.

**Done when:** middle-drag either pans the map or the hint stops offering it —
Excalidraw's `canvasPanning` string is overridable in the locale layer if
declining is the answer.
**Size:** small either way; it is a product call before it is a change.

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

1. **Merge `feat/map-rotation`, and run the app before you do.** It is the
   only done work not on `main`, and everything on it was verified by reading
   source and by tests — nobody has opened the editor. The claims most worth a
   live check are the ones a test cannot make: that the compass is clickable
   where it sits (bottom-left, z-index 10, above `.atlasToolOverlay`), that
   two-finger twist reaches the map through the Excalidraw plate, and that a
   turned map draws its annotations turned.
2. **FU-1** — the PRD job that isn't met. Blocked on one decision from MIXI
   (third registry `kind`, or its own lifecycle outside the registry) and it
   wants a plan of its own rather than a row here.
3. **FU-15** — build config, do it when something else is compiling.
4. **FU-7** — scope only. **FU-11** — observe only.

FU-2 dropped from third to last when the claim behind it collapsed, got blocked
outright when MIXI asked for rotate and tilt, was unblocked by the decision to
drop tilt, and is now done. It moved three times without a user ever being able
to tell.

The split inside FU-14 held up in the doing. RT-0 *removed* a behaviour and
went first on its own; everything after it *added* one, and every commit in
between was safe to stop at.
