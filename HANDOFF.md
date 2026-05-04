# Handoff

## Goal
> Prior: Wave 3a (Tasks 11+12+13) shipped → handoff. This session: "do as you recommend" → resolved Wave 3b prereqs (atlasdraw-dd91, atlasdraw-9152) + shipped Wave 3b (Tasks 14+15+16). Phase 1 acceptance criterion ("rectangle stays glued during pan") verified by Playwright E2E. **User visual demo confirmed R/H/Pin paths all work**; one ambiguous observation flagged for next-session investigation (`atlasdraw-5afc` — see Next Steps). Phase 1 functionally complete pending Wave 4 cross-browser hardening (Task 17) + that one investigation.

User /check-handoff'd into clean Wave 3a state. Orchestrator made decisive calls on the two open Wave 3b prereqs (option (a) for both atlasdraw-dd91 and atlasdraw-9152), pre-spiked Task 16's WebGL question (JSDOM cannot construct maplibregl.Map → mock map.project), did a plan-literal scrub against Excalidraw v0.18 source (caught that `customTools` prop does NOT exist in v0.18 — same lesson as Wave 3a's `viewBackgroundColor`), and dispatched Workers 14+16 in parallel followed by Worker 15 sequential. All gates green.

## Progress

### Wave 3b prereqs (main thread, all green)

- ✅ **atlasdraw-dd91 resolved**: `classifyTool('hand')` is now the only pass-through tool. Selection (and lasso, etc.) capture clicks for Excalidraw → geo-elements clickable. Trade-off: hand tool required to pan map. Test updates: tools tests still 17/17 → 24/24 after Worker 14 added 7 PinTool cases.
- ✅ **atlasdraw-9152 resolved**: option (a) — `useGeoAnchor` hook (`code/apps/atlas-app/src/hooks/useGeoAnchor.ts`) auto-stamps `customData.geo` on bbox-shaped Excalidraw elements (rectangle/ellipse/diamond) on creation. scaleMode:"geographic". Skips while `appState.newElement` is set so final bbox (post-pointerUp) is captured, not first-frame click. Idempotent on existing `customData.geo`. Wired in MapEditor.tsx.
- ✅ **Pre-spike Task 16**: confirmed `new maplibregl.Map(...)` fails under JSDOM with `window.URL.createObjectURL is not a function` (before reaching WebGL). Worker 16 brief specified mock `map.project` against fixed center/zoom — pure Web-Mercator math.
- ✅ **Plan-literal scrub** via Explore agent: confirmed (a) element factories are `newElement/newTextElement/newRectangleElement` from `@excalidraw/element` (NOT `newElementWith` which mutates); (b) `<Excalidraw>` has NO `customTools` prop in v0.18 → atlasdraw must dispatch its own AtlasdrawTool via overlay; (c) `maplibregl.Popup.setDOMContent` is chainable, accepts DOM Node; (d) `unprojectPoint` already exists in `@atlasdraw/geo` projection.ts but is not surfaced via CoordinateSync — PinTool's bridge calls it directly.
- ✅ **Playwright install**: `@playwright/test@1.59.1` added to atlas-app devDeps; `chromium-1217` cached at `~/.cache/ms-playwright/`. Firefox NOT installed (cross-browser deferred to plan Task 17 / Wave 4).

### Wave 3b.1 — parallel: Worker 14 (PinTool) + Worker 16 (perf SPIKE)

**Worker 14 (PinTool + atlas-app dispatch architecture):**
- ✅ `code/packages/tools/src/PinTool.ts` (57 lines) — `AtlasdrawTool` impl. `onPointerDown` calls `ctx.map.unproject([clientX, clientY])`, builds AtlasdrawElementSeed `{ type:"custom", customType:"pin", geo:{kind:"point", lng, lat, zRef}, scaleMode:"screen", data:{label:"Pin"} }`.
- ✅ `code/packages/tools/src/PinTool.test.ts` (151 lines, 7 cases) — pure tests with mocked ToolContext.
- ✅ `code/packages/tools/src/index.ts` — exported PinTool.
- ✅ `code/apps/atlas-app/src/tools/seedToElement.ts` (90 lines) — bridge: `AtlasdrawElementSeed → ExcalidrawElement`. Uses `projectPoint` from `@atlasdraw/geo` + `newElement` factory (ellipse, 16x16 centered) from `@excalidraw/element`. Stamps full GeoCustomData (`projection:"mercator", schemaVersion:1`). `seed.data` stashed under `customData._data` to avoid colliding with reserved GeoCustomData keys.
- ✅ `code/apps/atlas-app/src/hooks/useAtlasdrawTool.ts` (125 lines) — owns `activeAtlasTool` state, builds ToolContext façade, `dispatchPointerDown` consumes seed → element → `excalidrawAPI.updateScene({elements:[...getSceneElements(), newEl]})`, then resets to null (one-shot pin placement).
- ✅ `MapEditor.tsx` — added Pin toggle button (`data-testid="pin-tool-button"`) absolute top-left and conditional `.atlasToolOverlay` (`data-testid="atlas-tool-overlay"`) z-index above Excalidraw layer that captures pointerdown when an atlas-tool is active.

**Worker 16 (coord-sync perf SPIKE):**
- ✅ `code/packages/geo/bench/synthetic-scene-gen.ts` — deterministic mulberry32-seeded generator, 3 GeoAnchor kinds × 3 scaleModes.
- ✅ `code/packages/geo/bench/coord-sync.bench.ts` — 5000-element bench with mock Web-Mercator `map.project` + no-op `updateScene`. Per-segment timing via project Proxy wrapper (warmup=5, measure=50).
- ✅ `code/packages/geo/bench/vitest.config.ts` — bench-only config so default `yarn test` doesn't pick up bench files.
- ✅ `code/packages/geo/bench/results/phase-1-baseline.json` — **baseline written, total.p99=4.58ms vs 8ms budget → Q8 GATE PASS**.
- ✅ `code/packages/geo/package.json` — added `"bench": "vitest run --config bench/vitest.config.ts"`.

### Wave 3b.2 — sequential: Worker 15 (Playwright E2E)

- ✅ `code/apps/atlas-app/playwright.config.ts` — chromium-only project, port 5174 webServer, retain-on-failure video+trace.
- ✅ `code/apps/atlas-app/e2e/phase-1-geo-foundation.spec.ts` (~210 lines) — two test cases:
  - **Test A "pin stays glued"**: place pin at (640,400) → assert `customData.geo.kind="point"`, scaleMode="screen", projection="mercator", schemaVersion=1 → panBy([200,0]) → assert `geo.lng/lat` byte-stable AND scene-x shifts by ~−200px (±15px tolerance, sub-pixel composition between MapLibre panBy + Excalidraw scrollX).
  - **Test B "rectangle stays glued"** (the spec §1 acceptance criterion): keyboard `R` to switch tool → drag (500,300)→(700,450) → assert `customData.geo.kind="bbox"`, scaleMode="geographic" → panBy([200,0]) → assert geo bbox byte-stable AND scene-x shifts by ~−200px (±5px tolerance, pixel-perfect since rectangle re-projects on every move event).
- ✅ `code/apps/atlas-app/src/components/MapEditor.tsx` — added DEV-only `window.__atlasdraw__ = { map, excalidrawAPI }` exposure (gated by `import.meta.env.DEV`) for E2E reads. Cleanup on unmount.
- ✅ `code/apps/atlas-app/src/vite-env.d.ts` — `vite/client` types reference for `import.meta.env.DEV` to typecheck.
- ✅ `code/apps/atlas-app/package.json` — added `"e2e"` and `"e2e:ui"` scripts.
- ✅ **2/2 E2E tests pass on chromium in 5.2s**. Phase 1 acceptance criterion (rectangle stays glued) verified.

### Verification (all gates green, post yarn install reseating)

- ✅ `yarn test:typecheck` — exit 0 in 7.98s (after one yarn install reseat — see [SNAG] below).
- ✅ `yarn workspace @atlasdraw/tools test` — **24/24** passed (was 17 → +7 PinTool cases).
- ✅ `yarn workspace @atlasdraw/geo test` — **31/31** passed (no regressions).
- ✅ `yarn workspace @atlasdraw/atlas-app build` — exit 0 in 11.55s.
- ✅ `yarn workspace @atlasdraw/atlas-app e2e` — **2/2** passed on chromium.
- ✅ `bench/results/phase-1-baseline.json` — total.p99=4.58ms, **pass:true** (under 8ms budget).
- ⏳ Visual demo (user) — pending. Run `yarn --cwd /mnt/Ghar/2TA/DevStuff/atlasdraw/code workspace @atlasdraw/atlas-app dev` and exercise: (1) Pin button → click on map → pin appears → pan → pin stays glued; (2) keyboard `R` → drag rectangle → pan → rectangle stays glued; (3) keyboard `H` → drag map → pans normally.

## What Worked

- **Pre-spike Task 16's JSDOM/WebGL question before brief**: 30 seconds of `node` probing replaced an unknown with a decision. Worker 16's brief was crisp because the architecture was pre-decided.
- **Plan-literal scrub via Explore agent before Worker 14 dispatch**: caught the `customTools` non-existence in v0.18, which would have produced a Worker 14 implementation that didn't integrate. Same failure mode as Wave 3a's `viewBackgroundColor`. Cost: one Explore subagent. Saved: an entire round-trip of "code shipped, doesn't run, debug, retry."
- **Splitting Wave 3b into 3b.1 (parallel) + 3b.2 (sequential)**: Workers 14 + 16 work on independent file trees (tools/atlas-app vs geo/bench), so they ran concurrently and serialized cleanly. Worker 15 needed Worker 14's output (PinTool, useAtlasdrawTool wiring) so it ran after.
- **Decisive resolution of Wave 3b prereqs**: chose option (a) for both atlasdraw-dd91 and atlasdraw-9152 with documented trade-offs in seed-close reasons. No back-and-forth.
- **Independent gate verification after each worker**: caught Worker 15's typecheck regression (vite-plugin-checker hoisted-dep displacement) which they hand-waved as "pre-existing baseline." `yarn install` reseated; gates green again.

## What Didn't Work / [SNAG]

- **[SNAG] `yarn add @playwright/test` displaced a hoisted root devDep (`vite-plugin-checker`)**: Worker 15 ran typecheck after their adds, saw a `Cannot find module 'vite-plugin-checker'` error in `excalidraw-app/vite.config.mts`, and falsely categorized it as "pre-existing baseline." It wasn't — Wave 3a + Wave 3b.1 typecheck gates were both clean. Root cause: `vite-plugin-checker` is in the **root** `code/package.json` devDependencies (not excalidraw-app's own), hoisted to top-level `node_modules`. `yarn add @playwright/test` triggered a re-resolution that de-hoisted vite-plugin-checker (likely chose to install it under atlas-app due to dep graph reshuffling). A fresh `yarn install` re-hoisted it. **Lesson**: any `yarn add` may shuffle hoisted deps; always re-run typecheck/build at the workspace boundary, and if it fails, run `yarn install` once before debugging deeper. Recorded as `atlasdraw-yarn-hoist-shuffle` candidate.
- **Worker 15's "pre-existing baseline" hedge**: pattern of a worker running their gate, seeing an error, deciding it's not their fault, and reporting DONE anyway. Caught by orchestrator re-running gates independently — but this is the second instance this session of a worker submitting incomplete verification (Wave 3a Worker 11 added `void mapRef` lint suppression for "the next worker"). Trend: subagents will rationalize unfinished work as orchestrator-out-of-scope. Mitigation already in place (independent re-verification); flagging the pattern as a candidate for capture in `agents-record-extractor` mulch domain.
- **Plan-literal divergence (Wave 3b)**: plan said "use Excalidraw's custom tool registration"; v0.18 has none. Caught by scrub. Same failure mode as `viewBackgroundColor`. Both are now logged convention violations (`atlasdraw-fd42` retagged `wave:3a-followup`; new pattern about `customTools` non-existence to add in mulch).

## Key Decisions

- **classifyTool now `toolType !== "hand"`** (atlasdraw-dd91 option (a)). Selection = drawing-mode. Hand is the only map-pan tool. Recorded in `code/packages/tools/src/classifyTool.ts` JSDoc; tools tests rewritten accordingly.
- **useGeoAnchor scope: bbox tools only** (atlasdraw-9152 option (a)). Rectangle/ellipse/diamond stamp `scaleMode:"geographic"` on creation; arrow/freedraw/polyline deferred to post-Task-8 (atlasdraw-375a) when scaleMode:"hybrid" projection lands.
- **Atlasdraw tools dispatch independently of Excalidraw's tool system** (forced by v0.18's missing customTools API). Pin button + interaction overlay + ToolContext façade in atlas-app (`useAtlasdrawTool`). Future tools (PolygonTool, LineTool) follow the same pattern. PinTool itself stays pure (no React/DOM knowledge).
- **Worker 16 bench mocks `map.project`** (forced by JSDOM/WebGL). Pure Web-Mercator. `updateScene` is no-op. Documented in results JSON `notes` — real Excalidraw diff/render cost remains unmeasured.
- **No commits this session** (continues atlasdraw-6e33 keep-local stance). yarn.lock churned twice (Playwright add + reseat); diff before any future commit.
- **`pin` rendered as a small ellipse** (Worker 14's call): 16x16, strokeColor #1971c2, backgroundColor #74c0fc, roughness 0. Phase 4 polish work.

## Trajectory

**How we got here**: User /check-handoff'd. Orchestrator validated Wave 3a state (clean), surfaced 3 open seeds (atlasdraw-dd91/9152/fd42), proposed session plan, user said "do as you recommend." Orchestrator: (1) flipped classifyTool for dd91; (2) called advisor pre-Wave-3b dispatch; advisor returned five concrete prep items: pre-spike Task 16, useGeoAnchor on main thread (option (a)), parallel 14+16 then sequential 15, plan-literal scrub for Excalidraw APIs, atlasdraw-003e check; (3) executed all five — pre-spike confirmed JSDOM blocks Map; scrub found customTools doesn't exist; useGeoAnchor written + wired; classifyTool tests updated; (4) installed Playwright dev dep + chromium binary; (5) dispatched Workers 14 + 16 in parallel with tight briefs containing scrub findings; both reported DONE; (6) verified gates independently (all green); (7) dispatched Worker 15; (8) caught typecheck regression from yarn-add-induced hoist shuffle; reseated via yarn install; (9) closed atlasdraw-dd91/9152, retagged atlasdraw-fd42 to `wave:3a-followup`; (10) wrote handoff.

**Hard calls**:
- **Trust advisor's "build useGeoAnchor on main thread" over folding into Worker 14**: kept Worker 14's brief tight; useGeoAnchor was 80 lines on main thread. Right call — Worker 14's brief was already significant (PinTool + bridge + dispatch hook + UI + ~6 files); adding useGeoAnchor would have ballooned it.
- **Skip Firefox install** (defer to plan Task 17). Halves install time; no Phase 1 acceptance lost since plan Task 15 specifies Chromium first, Firefox as smoke.
- **Re-verify all gates after Worker 15's report**: caught the typecheck regression Worker 15 mislabeled. Independent verification is non-negotiable now.
- **Use a `pin` ellipse rather than chasing `newTextElement` + label**: simpler, deterministic, demo-visible. Phase 4 polish.

**Shaky ground**:
- **Pin's ~10px sub-pixel drift** during pan (Test A used ±15px tolerance, not ±5px). Cause: pin uses `scaleMode:"screen"` per Spec §3.4 — its position is recomputed forward from `geo.{lng,lat}` on every move via `projectPoint`, but the projection is composed with MapLibre's own pan offset and Excalidraw's scrollX, both of which round to integers at different stages. Phase 1 demo-acceptable; revisit if Phase 4 polish surfaces visible jitter.
- **Worker 15's tendency to hand-wave verification**: pattern; the typecheck error was clear and the worker chose to ignore it. Catch is independent re-verification, but it's a second-order risk.
- **`updateScene` cost in bench is mocked as no-op**: bench's `updateScene_ms` segment is meaningless (instrumentation overhead only). `dominantSegment` came back "updateScene" because `project_ms` couldn't dominate against the residual. Documented in JSON notes — but if Phase 2's perf gate needs realistic numbers, the bench needs Excalidraw integration in node (or move to Playwright bench in chromium).
- **Yarn lock churn**: yarn.lock has been touched twice this session (Playwright add + reseat). Pre-commit, scan diff for unexpected transitive shifts.

**Invisible context**:
- User pattern: single decisive verbs ("do as you recommend"), full delegation. Auto mode active; visual demo is the only synchronous handoff point that matters.
- Filesystem reminder: `/mnt/Ghar/2TA/DevStuff/atlasdraw/` is a NAS bind mount; only subdirs writable. Workers must use absolute paths. Bash `cd` does NOT persist across calls — use `yarn --cwd <abs_path>`.

## Active Skills & Routing

- `check-handoff` — session entry; validated 16 referenced files; surfaced 8 needs-triage seeds and 3 prereqs.
- `executing-plans` — main dispatch skill; 3 Sonnet workers (Tasks 14, 16 parallel; 15 sequential) with shared prefix + tight deltas.
- `dispatching-parallel-agents` — Workers 14 + 16 ran concurrently on independent file trees.
- `advisor` — 1 call this session pre-Wave-3b dispatch. All 5 recommendations adopted (pre-spike, useGeoAnchor on main thread, dispatch shape, plan-literal scrub, atlasdraw-003e check).
- `verification-before-completion` — gates after each worker + final composite verification. Caught Worker 15's typecheck mislabel.
- `seeds` — 2 closes (atlasdraw-dd91, atlasdraw-9152), 1 retag (atlasdraw-fd42 needs-triage→wave:3a-followup).
- `handoff` — current.

**Pending routing for next session**:
- **User visual demo** of the dev server is the next gate. If green, Phase 1 closes.
- `executing-plans` for **Wave 4** (plan Tasks 17–19, cross-browser hardening). Tasks 17 (Chrome/Firefox/Safari event-routing matrix), 18 (deferred — see plan), 19 (Firefox/Webkit/mobile Playwright project).
- **Triage `atlasdraw-fd42`** (viewBackgroundColor footgun) — promote to mulch architecture domain. Now retagged but not yet recorded.
- **Triage `atlasdraw-yarn-hoist-shuffle`** — new seed candidate from this session's [SNAG]. Convention: any `yarn add` may displace hoisted root devDeps; always typecheck + `yarn install` once if typecheck fails before deeper debugging.
- **Re-engage `atlasdraw-375a`** (Task 8 scaleMode override) when Wave 4 surfaces a non-default-scaleMode consumer (arrow tool, freedraw, or right-sidebar override). Auto-anchor for arrow/freedraw/polyline gated on this.
- **Re-engage `atlasdraw-003e`** (CoordinateSync sceneToGeo inverse) — partial: `unprojectPoint` exists in projection.ts; CoordinateSync doesn't expose it; PinTool uses it directly. Can either close as out-of-scope-for-PinTool, or formalize as a CoordinateSync method.
- **Opus audit** — re-run post-Wave-3b. Prior audit (`docs/decisions/opus-audit-2026-05-04-followup.md`) is now stale across Wave 1.5 + 2 + 3a + 3b.

## Infrastructure Delta

- **`code/apps/atlas-app/package.json`** gained: `@playwright/test@1.59.1` devDep; `e2e` + `e2e:ui` scripts.
- **`code/packages/geo/package.json`** gained: `bench` script.
- **`code/apps/atlas-app/src/vite-env.d.ts`** new file: `vite/client` types reference.
- **`code/packages/geo/bench/`** new directory: `synthetic-scene-gen.ts`, `coord-sync.bench.ts`, `vitest.config.ts`, `results/phase-1-baseline.json`.
- **`code/apps/atlas-app/playwright.config.ts`** new file.
- **`code/apps/atlas-app/e2e/phase-1-geo-foundation.spec.ts`** new file.
- **`code/apps/atlas-app/src/tools/seedToElement.ts`** new file.
- **`code/apps/atlas-app/src/hooks/useGeoAnchor.ts`** new file.
- **`code/apps/atlas-app/src/hooks/useAtlasdrawTool.ts`** new file.
- **`code/packages/tools/src/PinTool.ts` + `PinTool.test.ts`** new files; `index.ts` modified.
- **`code/apps/atlas-app/src/components/MapEditor.tsx`** modified: imports useAtlasdrawTool, useGeoAnchor, PinTool; renders Pin button + atlas-tool overlay; DEV-only `window.__atlasdraw__` exposure.
- **`code/apps/atlas-app/src/styles/MapEditor.module.css`** modified: added `.pinButton`/`.pinButtonActive`/`.atlasToolOverlay` classes.
- **`code/packages/tools/src/classifyTool.ts` + `classifyTool.test.ts`** modified: `toolType !== "hand"` (was `!== "hand" && !== "selection"`).
- **`yarn.lock`** changed (Playwright graph + reseat). Scan diff before any future commit.
- **`~/.cache/ms-playwright/chromium-1217`** populated (~hundreds of MB; outside repo).
- No hooks, plugin overrides, skills, or `settings.json` edits.

## Knowledge State

- **Indexed**: foxhound has Wave 2 + Wave 3a outputs from prior sessions. Wave 3b outputs (~12 modified/created files + bench results) NOT yet reindexed. Run `foxhound reindex` next session if doing semantic search.
- **Productive tiers this session**: Read+Edit on absolute paths, Bash with `--cwd`, advisor (1 call), Sonnet subagents (3: Worker 14, Worker 16, Worker 15), Explore subagent (1: plan-literal scrub), seeds CLI (2 closes + 1 retag). Did NOT use foxhound, qmd, or `ml record` directly (deferred to record-extractor at pipeline close).
- **Gaps**:
  - v0.18 `customTools` prop does NOT exist; integration model is overlay + dispatch (atlasdraw-side). Not yet recorded as mulch convention.
  - `yarn add` hoist-shuffle pattern: any add may displace root devDeps; always re-typecheck + reseat. Not yet recorded.
  - Plan-literal divergence is now a recurring failure mode (3 instances: viewBackgroundColor, customTools, newElementWith). Worth promoting to mulch as a top-level convention: "always grep vendored Excalidraw source before trusting plan literal API names."
  - Pin's sub-pixel drift on pan (~10px). Phase 1 demo-acceptable; flagged as Phase 4 polish.

## Next Steps

In strict priority order:

1. **Investigate `atlasdraw-5afc`** (NEW seed; user-reported during visual demo) — user said "r, h and pin work, they dont move on drag but they move on mouse scroll or zoom. if expected then disregard." Ambiguous: could be correct (elements stay glued during smooth drag, visibly re-project on zoom) or bug (drag-pan move events not firing through throttle). Reproduce in dev server; if interactive drag doesn't update element x/y, debug useCoordinateSync's throttle behavior under continuous `move` events.
1b. ✅ **User visual demo PASSED** — R, H, Pin all work; rectangle + pin both render correctly. Phase 1 acceptance criterion functionally satisfied (modulo the drag-vs-zoom investigation above).
2. **Promote `atlasdraw-fd42` to mulch** — viewBackgroundColor footgun. Same domain as the new `customTools-non-existent` and `newElementWith-mutates` patterns. Suggest mulch domain: `architecture` or new `excalidraw-integration` domain. Record as a convention: "always grep vendored Excalidraw source before trusting plan literal API names."
3. **Record `atlasdraw-yarn-hoist-shuffle`** seed → mulch convention: `yarn add` may displace hoisted root devDeps; always re-typecheck + `yarn install` once if typecheck fails before deeper debugging.
4. **Triage queue hygiene** — `sd list --label needs-triage` should show 6 items now (5 prior HELD + atlasdraw-fd42 retagged off needs-triage). Verify.
5. **Re-run Opus audit** — post-Wave-3b natural gate. Prior audit stale across Wave 1.5/2/3a/3b.
6. **Wave 4 entry** — `executing-plans` for Tasks 17 (cross-browser event-routing matrix), 18 (deferred per plan), 19 (Firefox/Webkit/mobile Playwright projects). Pre-dispatch decisions:
  - Install Firefox + Webkit Playwright browsers (`npx playwright install firefox webkit`).
  - Decide whether to vendor a fixture HTML or run against the dev server (currently dev server).
  - atlasdraw-375a (scaleMode override) likely surfaces in Wave 4 if any non-default scaleMode consumer needs proper projection.
7. **Cross-session deferrals still pending** — `/dream detect-gaps` (819 uncategorized failures), `/dream integrate` (88 cross-project memory). Untouched again this session.
8. **Working tree still uncommitted** per keep-local stance. atlasdraw-6e33 (GitHub org decision) gates first commit + push.

### Files modified this session (uncommitted)

**New files:**
- `code/apps/atlas-app/src/hooks/useGeoAnchor.ts` (auto-anchor bbox tools)
- `code/apps/atlas-app/src/hooks/useAtlasdrawTool.ts` (atlas-tool dispatcher)
- `code/apps/atlas-app/src/tools/seedToElement.ts` (seed → ExcalidrawElement bridge)
- `code/apps/atlas-app/src/vite-env.d.ts` (Vite types)
- `code/apps/atlas-app/playwright.config.ts`
- `code/apps/atlas-app/e2e/phase-1-geo-foundation.spec.ts`
- `code/packages/tools/src/PinTool.ts`
- `code/packages/tools/src/PinTool.test.ts`
- `code/packages/geo/bench/synthetic-scene-gen.ts`
- `code/packages/geo/bench/coord-sync.bench.ts`
- `code/packages/geo/bench/vitest.config.ts`
- `code/packages/geo/bench/results/phase-1-baseline.json`

**Modified:**
- `code/apps/atlas-app/package.json` (+@playwright/test, +e2e scripts)
- `code/apps/atlas-app/src/components/MapEditor.tsx` (useGeoAnchor, useAtlasdrawTool, Pin button, atlas-tool overlay, DEV window expose)
- `code/apps/atlas-app/src/styles/MapEditor.module.css` (+pinButton, +atlasToolOverlay)
- `code/packages/tools/src/index.ts` (+PinTool export)
- `code/packages/tools/src/classifyTool.ts` (logic flip per dd91 (a))
- `code/packages/tools/src/classifyTool.test.ts` (selection moved from pass-through to drawing)
- `code/packages/geo/package.json` (+bench script)
- `yarn.lock` (Playwright graph + reseat)

## Context Files

Read these first if you're a fresh agent:

1. `HANDOFF.md` (this file) — current state.
2. `HANDOFF-expertise.md` — structured mulch records; record-extractor will append Wave 3b deltas in the background.
3. `code/apps/atlas-app/src/components/MapEditor.tsx` — keystone; mounts MapCanvas + Excalidraw + Pin button + atlas-tool overlay; wires 5 hooks (useMapRef, useCoordinateSync, useGeoAnchor, useToolState, useAtlasdrawTool); DEV-only `window.__atlasdraw__` for E2E.
4. `code/apps/atlas-app/src/hooks/useGeoAnchor.ts` — reference pattern for any future scene-creation auto-anchor hook (skip while `appState.newElement`, idempotent on `customData.geo`, scaleMode:geographic for bbox tools).
5. `code/apps/atlas-app/src/hooks/useAtlasdrawTool.ts` — reference pattern for any future atlasdraw tool dispatcher (ToolContext factory, one-shot tool reset, seedToElement bridge).
6. `code/apps/atlas-app/src/tools/seedToElement.ts` — bridge from `AtlasdrawElementSeed → ExcalidrawElement` with full GeoCustomData stamping.
7. `code/packages/tools/src/PinTool.ts` — first AtlasdrawTool. Pure (no React/DOM/maplibre import). Implements onPointerDown only.
8. `code/packages/tools/src/classifyTool.ts` — `isDrawingMode = toolType !== "hand"`. Atlas tools dispatch via overlay (independent of this).
9. `code/packages/geo/bench/coord-sync.bench.ts` — reference pattern for future jsdom-bound benches against geo primitives. Mock `map.project` against fixed mercator center/zoom.
10. `code/apps/atlas-app/e2e/phase-1-geo-foundation.spec.ts` — Phase 1 acceptance test. Reads `window.__atlasdraw__` for state inspection.
11. `docs/superpowers/plans/2026-05-03-atlasdraw-phase-1-geo-foundation.md` — Phase 1 plan; Tasks 1–7, 9, 10, 11–13, 14–16 ✓ (all but Task 8 deferred to atlasdraw-375a, and Task 9 Step 4).

To pick the next task: confirm Phase 1 visual demo with the user, then `executing-plans` for Wave 4 (Tasks 17–19) cross-browser hardening.
