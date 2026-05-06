# Mulch expertise — Phase 3 closure (Phase 4 priming)

_Generated: 2026-05-06T18:24:12Z — sidecar to HANDOFF.md_


## Domain: data

# Project Expertise (via Mulch)

## data (9 records, updated 2m ago)
- [decision] Yjs over Automerge for data-layer CRDT: Yjs wins on perf (frequent small mutations, 100-10k features), deeper plugin ecosystem (y-websocket,... (mx-638e2d)
- [decision] Felt importer is read-only API-only GeoJSON snapshot — no binary container: Felt has no binary container format. (mx-20a675)
- [failure] togeojson package deprecated. @mapbox/togeojson ^0.16.2 is the maintained fork. → Use @mapbox/togeojson ^0.16.2 in packages/data. (mx-ac9ab3)
- [failure] geojsonhint package archived. → Use @placemarkio/check-geojson in packages/data. (mx-b2e40d)
- [failure] FSA (File System Access API) assumed as primary persistence path — wrong. → IndexedDB is primary path. (mx-3cac9d)
- [convention] skeleton package bootstrap on first non-trivial code: when first real code lands in a previously-ske... (mx-65ab4f)
- [failure] Blob.type silently dropped through zip writer — ZIP format has no per-entry MIME field. → accepted-by-design: pin test to empty string; derive MIME from filename extension in consumers (mx-d16fa9)
- [failure] styleRef:null round-trips inconsistently across the two writers — atlasdraw.ts (zip) does JSON.strin... → unresolved — both writers frozen; consumers must handle both {} and null as 'no style ref' (mx-ed9854)
- [decision] idb (typed) + custom trailing+ceiling debounce for atlasdraw persistence — not idb-keyval + lodash: Excalidraw's own LocalData.ts uses idb-keyval (line 20-27) + lodash debounce (line 118). (mx-2e17ca)

## Quick Reference

- `mulch search "query"` — find relevant records before implementing
- `mulch prime --files src/foo.ts` — load records for specific files
- `mulch prime --context` — load records for git-changed files
- `mulch record <domain> --type <type> --description "..."`
  - Types: `convention`, `pattern`, `failure`, `decision`, `reference`, `guide`
  - Evidence: `--evidence-commit <sha>`, `--evidence-bead <id>`
- `mulch doctor` — check record health

# 🚨 SESSION CLOSE PROTOCOL 🚨

**CRITICAL**: Before saying "done" or "complete", you MUST run this checklist:

```
[ ] 1. mulch learn              # see what files changed — decide what to record
[ ] 2. mulch record <domain> --type <type> --description "..."
[ ] 3. mulch sync               # validate, stage, and commit .mulch/ changes
```

**NEVER skip this.** Unrecorded learnings are lost for the next session.

## Domain: meta

# Project Expertise (via Mulch)

## meta (32 records, updated 2m ago)
- [decision] writing-plans: REVIEW:skill-removed: status=ORPHANED xrefs=OK(10evals) value=REVIEW:skill-removed (mx-9ca4d1)
- [decision] writing-skills: REVIEW:skill-removed: status=ORPHANED xrefs=OK(0evals) value=REVIEW:skill-removed (mx-e64ebb)
- [decision] file:skill-creator/scripts/improve_description.py: REVIEW:may-be-redundant: status=DRIFTED:adopted(24) xrefs=N/A value=REVIEW:may-be-redundant (mx-0a2fee)
- [decision] file:skill-creator/scripts/run_loop.py: REVIEW:may-be-redundant: status=DRIFTED:adopted(40) xrefs=N/A value=REVIEW:may-be-redundant (mx-2d5aff)
- [convention] Cross-worker dep additions must serialize, not parallelize — when two parallel workers both add depe... (mx-372bdb)
- [convention] Serialize auditor after actor — when an actor (builder/demo agent) modifies install state, the audit... (mx-537ae1)
- [convention] File triage seeds mid-session as findings surface, not deferred to handoff prose — each blocker gets... (mx-a174c9)
- [convention] correction: first handoff attempt was incomplete — did not dispatch record-extractor and skipped som... (mx-391d6f)
- [convention] Always use absolute paths in Bash tool calls — shell cwd persists across Bash calls in agent threads... (mx-0d9feb)
- [convention] Peer-vs-parent discriminator for wave task assignment: when deferring missing work into an existing ... (mx-537417)
- [convention] correction: plan literals diverge from codebase — pre-state divergences in subagent briefs before di... (mx-e9dc63)
- [convention] Subagent workers reliably hand-wave verification failures as 'out of scope' or 'pre-existing baselin... (mx-2ad5f6)
- [convention] Two pre-dispatch artifacts cut Worker brief failure rate sharply: (1) PRE-SPIKE — when the plan name... (mx-7ef9cf) [relates to: mx-372bdb, mx-537ae1]
- [convention] Plan literals go stale within 24h of authoring when a parallel wave ships — Phase 2 plan was authore... (mx-d9ab91)
- [convention] When plan claims to 'extend interface with X+Y', grep current types.ts first — X or Y may already be... (mx-ce5d92)
- [convention] Types-only files land before any consumer task — T01 pattern: when multiple downstream tasks (T11/T1... (mx-364d3c)
- [convention] opus-audit-post-wave4 document is the canonical Phase 2 pre-dispatch audit, following the same templ... (mx-6eac5e)
- [convention] correction: plan literals omit src/ path segment — every atlasdraw package (tools, data, geo, basema... (mx-8ec7b9)
- [convention] pre-dispatch scrub catches integration-seam absence, not just plan-literal drift — Wave 1 scrub foun... (mx-d4f376)
- [convention] clarification: triage skill verdict shape for bucket-A holds — removing needs-triage label without c... (mx-3422c1)
- [convention] advisor catches what regex extracts miss — first scrub draft called T05 and T08 clean based on regex... (mx-d3616b)
- [convention] Barrel export as stub signal — when a package's barrel (index.ts) has not been touched by any consum... (mx-9caad1)
- [convention] correction: plan literals reference phantom files — beyond src/ path segment omission (mx-8ec7b9), W... (mx-619182)
- [decision] wave-N absorption: absorb phase residue into single hardening sprint rather than fragmenting per phase: When a phase is declared done but leaves gating residue (unfinished tasks, unmet acceptance criteria... (mx-7857de)
- [convention] correction: plan-literal drift is recursive — the mx-e9dc63 lesson does not inoculate even the plan-... (mx-04ac8d)
- [convention] Test file placement is partial-by-package, not project-wide: geo pkg (code/packages/geo/src/) uses C... (mx-e9408d) [relates to: mx-e9dc63]
- [convention] Audit pre-conventions code when a conventions skill lands — atlasdraw-ui-conventions skill (auto-boo... (mx-43333a)
- [convention] Commit dirty file before dispatching a worker that will touch it — if a file has unrelated uncommitt... (mx-714b96)
- [convention] buildGeoAnchorHandler factory pattern for React-free hook testability — useGeoAnchor.ts exports a fa... (mx-8e3209)
- [convention] Name functions by their return type, not their input type — inferGeometryType (MapEditor.tsx:53) nam... (mx-592d38)
- [convention] Grep lockfile before assuming yarn add is needed — OQ-W4-2 resolution: @playwright/test was already ... (mx-d802af) [relates to: mx-cfac0b]
- [convention] correction: plan-literal drift includes API-shape drift, not just path drift — T11 plan said Promise... (mx-744b7e)

## Quick Reference

- `mulch search "query"` — find relevant records before implementing
- `mulch prime --files src/foo.ts` — load records for specific files
- `mulch prime --context` — load records for git-changed files
- `mulch record <domain> --type <type> --description "..."`
  - Types: `convention`, `pattern`, `failure`, `decision`, `reference`, `guide`
  - Evidence: `--evidence-commit <sha>`, `--evidence-bead <id>`
- `mulch doctor` — check record health

... and 35 more records across 1 domain (use --budget <n> to show more)

# 🚨 SESSION CLOSE PROTOCOL 🚨

**CRITICAL**: Before saying "done" or "complete", you MUST run this checklist:

```
[ ] 1. mulch learn              # see what files changed — decide what to record
[ ] 2. mulch record <domain> --type <type> --description "..."
[ ] 3. mulch sync               # validate, stage, and commit .mulch/ changes
```

**NEVER skip this.** Unrecorded learnings are lost for the next session.

## Domain: architecture

# Project Expertise (via Mulch)

## architecture (27 records, updated 2m ago)
- [pattern] dual-canvas-pointer-toggle: Two stacked rendering surfaces: MapLibre GL canvas underneath, Excalidraw canvas on top. (mx-2ae129)
- [pattern] annotation-vs-data-layer: Annotation layer = Excalidraw elements (ephemeral, screen-anchored, drawn). (mx-8beeb7)
- [pattern] worker-prelude-sandbox: Web Worker plugins: null fetch, XHR, WebSocket, and importScripts in prelude before plugin entry poi... (mx-4c0cfe)
- [decision] Single-player mode is first-class deployment: WebSocket opt-in via [realtime] enabled=true in config.toml. (mx-a6b4d4)
- [decision] Hosted flagship by v1.0, no open-core split: Plausible-model: all features in OSS under AGPL. (mx-21c19d)
- [decision] Phase 1 extended to 4 weeks; all subsequent phases shifted +1: Event routing across stacked canvases (MapLibre + Excalidraw pointerEvents) is a high-churn Excalidr... (mx-9fc72d)
- [reference] Safari URL hash limit for share-via-URL: Safari URL hash limit ~50,000 chars. (mx-d0a4a6)
- [failure] Demo install regressed monorepo typecheck — apps/atlas-app skeleton install upgraded TypeScript via ... → unresolved — three candidates: ignoreDeprecations:5.0 in tsconfig.base.json (fastest, punts deprecat... (mx-e1ef85)
- [decision] firebase-project/ KEEP through Phase 2 boundary: 4 files, 34 lines total, zero monorepo references, pristine upstream Excalidraw firestore deployment... (mx-136917)
- [decision] keep local — no GitHub push or commit until atlasdraw-6e33 resolved: User explicit instruction: no gh repo create, no git push, no commit this session. (mx-8afd1a)
- [decision] demo wired into apps/atlas-app skeleton, not a standalone testbed: apps/atlas-app already had package.json + tsconfig; cheaper to extend than scaffold a new testbed. (mx-a07bb7)
- [failure] Excalidraw v0.18 viewBackgroundColor is an AppState field, not a top-level prop — expected: <Excalid... → Pass via initialData.appState: <Excalidraw initialData={{ appState: { viewBackgroundColor: 'transpar... (mx-5ac4fe)
- [convention] New app workspace consuming @excalidraw/excalidraw source requires three setup steps: (1) declare @e... (mx-f72985)
- [reference] excalidraw-imperativeapi-onchange-pattern: ExcalidrawImperativeAPI.onChange(callback) returns an UnsubscribeCallback (types.ts:971). (mx-1e3d96)
- [pattern] excalidraw-initialdata-module-scope-const: Hoist Excalidraw initialData object to module scope as a const (EXCALIDRAW_INITIAL_DATA) rather than... (mx-f7139e)
- [decision] atlasdraw tools dispatch independently of Excalidraw tool system via overlay: Excalidraw v0.18 has no customTools prop (confirmed by vendored source grep). (mx-682f8a)
- [failure] Excalidraw v0.18 customTools prop does not exist — expected: <Excalidraw customTools={...}/> accepte... → Atlas-side dispatch via overlay (mx-682f8a): useAtlasdrawTool + .atlasToolOverlay div + seedToElemen... (mx-12ac3f)
- [pattern] appState-newElement-draft-guard: appState.newElement is the Excalidraw field that signals an element is being actively drafted (betwe... (mx-95b179)
- [decision] Zustand+immer for cross-component reactive state; module-singleton for tool-internal state: Wave 2 LayerRegistry decision (user-confirmed Option A): Zustand+immer for LayerRegistry because it ... (mx-5ac6f6)
- [convention] Data layer IDs use dl:${crypto.randomUUID()} format; mint at call site, NOT inside registry — T11, T... (mx-417b33)
- [reference] customData-data-escape-hatch-seedToElement: customData._data escape-hatch in seedToElement.ts — T14 plan literal said radiusKm lives at customDa... (mx-060ade)
- [pattern] capture-phase native listener for deeper-DOM third-party event interception: When a third-party component (e.g. (mx-8ec4d1) [relates to: mx-44be9f]
- [pattern] multi-system mutation atomicity: pure-compute → may-throw+rollback → in-memory → destructive-last: When a single operation mutates multiple systems (map source/layer, in-memory registry, external sce... (mx-925b76) [relates to: mx-5ac6f6]
- [reference] Excalidraw handleAppOnDrop location — App.tsx:2147,11872: Excalidraw v0.18 drop handling lives in two places in code/packages/excalidraw/components/App.tsx: t... (mx-c03919) [relates to: mx-8ec4d1]
- [convention] No single state/store.ts in atlas-app — pattern is per-concern Zustand stores. (mx-01984d)
- [convention] App.tsx is a one-liner <MapEditor /> — the actual change-site for any Excalidraw composition is code... (mx-3342d8)
- [convention] Data-layer FeatureCollections live in MapLibre sources at runtime, not in any registry. (mx-91343d)

## Quick Reference

- `mulch search "query"` — find relevant records before implementing
- `mulch prime --files src/foo.ts` — load records for specific files
- `mulch prime --context` — load records for git-changed files
- `mulch record <domain> --type <type> --description "..."`
  - Types: `convention`, `pattern`, `failure`, `decision`, `reference`, `guide`
  - Evidence: `--evidence-commit <sha>`, `--evidence-bead <id>`
- `mulch doctor` — check record health

# 🚨 SESSION CLOSE PROTOCOL 🚨

**CRITICAL**: Before saying "done" or "complete", you MUST run this checklist:

```
[ ] 1. mulch learn              # see what files changed — decide what to record
[ ] 2. mulch record <domain> --type <type> --description "..."
[ ] 3. mulch sync               # validate, stage, and commit .mulch/ changes
```

**NEVER skip this.** Unrecorded learnings are lost for the next session.

## Domain: excalidraw-api

# Project Expertise (via Mulch)

## excalidraw-api (4 records, updated 2m ago)
- [reference] CaptureUpdateAction enum uppercase as-const literals: code/packages/element/src/store.ts:38-69 defines CaptureUpdateAction as 'as const' with values NEVER... (mx-725d48) [relates to: mx-04ac8d]
- [reference] Excalidraw v0.18 atlas-side UI slot APIs: Verified atlas-side UI slot APIs in v0.18: (1) renderTopLeftUI prop — injects into Excalidraw toolba... (mx-228e29)
- [convention] MainMenu DefaultItems live at main-menu/DefaultItems.tsx (kebab-case path), not mainMenu/. (mx-025e8a)
- [convention] <MainMenu.DefaultItems.LoadScene> and <SaveToActiveFile> are closure-bound to internal actions — no ... (mx-30002e)

## Quick Reference

- `mulch search "query"` — find relevant records before implementing
- `mulch prime --files src/foo.ts` — load records for specific files
- `mulch prime --context` — load records for git-changed files
- `mulch record <domain> --type <type> --description "..."`
  - Types: `convention`, `pattern`, `failure`, `decision`, `reference`, `guide`
  - Evidence: `--evidence-commit <sha>`, `--evidence-bead <id>`
- `mulch doctor` — check record health

# 🚨 SESSION CLOSE PROTOCOL 🚨

**CRITICAL**: Before saying "done" or "complete", you MUST run this checklist:

```
[ ] 1. mulch learn              # see what files changed — decide what to record
[ ] 2. mulch record <domain> --type <type> --description "..."
[ ] 3. mulch sync               # validate, stage, and commit .mulch/ changes
```

**NEVER skip this.** Unrecorded learnings are lost for the next session.

## Domain: infrastructure

# Project Expertise (via Mulch)

## infrastructure (25 records, updated 2m ago)
- [decision] Fastify v5 over v4 for apps/storage: Fastify v4 EOL June 2025. (mx-7d393a)
- [failure] COOP/COEP headers required for SharedArrayBuffer break cross-origin tile CDNs (Cloudflare R2, tile.o... → Use postMessage at 30Hz for cross-thread coord sync. (mx-c13e6d)
- [failure] yarn add <pkg> in a workspace can re-resolve transitive deps and de-hoist a root-level devDep that w... → After ANY yarn add in a workspace, re-run yarn workspace-level typecheck/build at the orchestrator l... (mx-66df05)
- [failure] pre-commit secret-scan false-positive on vendored WASM binary — expected clean pass, got 'potential ... → used --no-verify with user authorization; no allowlist path exists in hook today (mx-8d7ade)
- [convention] vendored fork .git backup: when inlining an upstream fork (option C), move embedded .git via mv to a... (mx-87637c)
- [failure] seeds CLI flag misspelling — expected --label and priority 'medium', got generic error. → used --labels P2 in subsequent calls (mx-808a0c)
- [convention] GitHub repo creation one-shot: rename master→main BEFORE gh repo create (still local, no remote, ful... (mx-52935c)
- [pattern] anti-pattern-catch-all: anti-pattern cluster [catch-all]: 53 findings across code/packages/excalidraw/subset/woff2/woff2-bin... (mx-b8f196)
- [pattern] anti-pattern-console-only-error: anti-pattern cluster [console-only-error]: 87 findings across code/excalidraw-app/data/localStorage.... (mx-a04614)
- [pattern] anti-pattern-fire-and-forget: anti-pattern cluster [fire-and-forget]: 142 findings across code/packages/excalidraw/components/App.... (mx-73b4a7)
- [pattern] anti-pattern-silent-catch: anti-pattern cluster [silent-catch]: 55 findings across code/packages/excalidraw/components/App.tsx(... (mx-af8ee8)
- [pattern] anti-pattern-todo-density: anti-pattern cluster [todo-density]: 9 findings across code/packages/math/src/point.ts(1) code/packa... (mx-1d491c)
- [pattern] anti-pattern-untested-churn: anti-pattern cluster [untested-churn]: 11 findings across code/setupTests.ts(1) code/scripts/woff2/w... (mx-e4312e)
- [pattern] anti-pattern-impact-scope: anti-pattern cluster [impact-scope]: 440 findings across code/scripts/updateChangelog.js(1) code/scr... (mx-8b6345)
- [failure] tsconfig.base.json ignoreDeprecations:"5.0" masked 5+ pre-existing TS errors — expected: suppresses ... → unresolved — candidates: remove ignoreDeprecations entirely (forces addressing all deprecated patter... (mx-f86441)
- [failure] Phase 1 typecheck baseline was never clean — atlas-app tsconfig paths:{} + tools rootDir isolation +... → identified in post-wave4 opus audit; requires: remove paths:{} override in atlas-app/tsconfig.json, ... (mx-be26db)
- [failure] atlas-app/tsconfig.json paths:{} fully overrides inherited base paths — TS extends merges tsconfig k... → remove or populate paths in atlas-app/tsconfig.json explicitly; do not use empty paths:{} as a no-op... (mx-a8793a)
- [convention] anti-pattern detector must be scoped to atlasdraw-owned paths only — running detector across all of ... (mx-3cfa41)
- [failure] husky postinstall expects code/.git that no longer exists — git was hoisted to repo root; husky 7.0.... → verify artifacts directly (ls node_modules/@types/geojson) before assuming install failed. (mx-281e73)
- [convention] LSP diagnostic noise during background worker writes is ignorable: LSP shows phantom syntax errors a... (mx-04231d)
- [failure] yarn workspace add lockfile race — @turf/distance install pruned vite-plugin-checker hoisting; build... → ran bare 'yarn install' to re-hoist; build restored. (mx-cdd75c)
- [failure] vitest globals:false defeats RTL automatic cleanup — expected: React Testing Library's afterEach(cle... → Add explicit import { afterEach } from 'vitest'; import { cleanup } from '@testing-library/react'; a... (mx-af40b4)
- [convention] CLI tsconfig must include ../data/src/shpjs.d.ts to compile — when @atlasdraw/cli imports from @atla... (mx-3c2203)
- [convention] CLI base tsconfig needs "types":["node"] when using node globals — base tsconfig has no types field,... (mx-de40e2)
- [convention] vitest 3.0.6 dropped --reporter=basic — use default reporter. (mx-48b101)

## Quick Reference

- `mulch search "query"` — find relevant records before implementing
- `mulch prime --files src/foo.ts` — load records for specific files
- `mulch prime --context` — load records for git-changed files
- `mulch record <domain> --type <type> --description "..."`
  - Types: `convention`, `pattern`, `failure`, `decision`, `reference`, `guide`
  - Evidence: `--evidence-commit <sha>`, `--evidence-bead <id>`
- `mulch doctor` — check record health

# 🚨 SESSION CLOSE PROTOCOL 🚨

**CRITICAL**: Before saying "done" or "complete", you MUST run this checklist:

```
[ ] 1. mulch learn              # see what files changed — decide what to record
[ ] 2. mulch record <domain> --type <type> --description "..."
[ ] 3. mulch sync               # validate, stage, and commit .mulch/ changes
```

**NEVER skip this.** Unrecorded learnings are lost for the next session.

## Domain: tools

# Project Expertise (via Mulch)

## tools (13 records, updated 2d ago)
- [decision] classifyTool: toolType !== 'hand' is the only pass-through — selection is drawing mode: Wave 3b atlasdraw-dd91 option (a): isDrawingMode = toolType !== 'hand'. (mx-e71fb0)
- [decision] classifyTool: only 'hand' is pass-through (supersedes selection-also-pass-through): Wave 3a shipped classifyTool returning false for both 'hand' AND 'selection' per plan literal — mean... (mx-94e363) [supersedes: mx-d75e98]
- [convention] pre-dispatch integration-seam scrub: before dispatching N parallel workers that produce element shap... (mx-7aac47)
- [convention] yarn workspace add lockfile race: yarn workspace <pkg> add <dep> prunes hoisted packages; after any ... (mx-136723)
- [convention] module-level singleton state for AtlasdrawTool: 6 of 7 Wave 1b tools (PolygonTool, FreehandTool, Arr... (mx-d06b22)
- [convention] tool hand-off boundary: when a tool wants to hand off control to another tool (e.g. (mx-dde696)
- [convention] vitest jsdom env for tools using DOM globals: tools-package vitest env was originally node; tools us... (mx-28e173)
- [decision] multi-worker wave bundled into single commit: Wave 1a and Wave 1b each bundled all worker outputs into one commit (17 new files + 2 modified in Wa... (mx-e02f82)
- [decision] tool test files colocated with source, not __tests__/: OQ-W1-4 resolved: tool tests live alongside source files (e.g. (mx-0605c8)
- [failure] scrub draft confident-incorrect on absence — initial Wave 1b scrub claimed T05/T08 were clean based ... → advisor review caught the miss; T08 brief was corrected before dispatch. (mx-b84751)
- [reference] wave1-pre-dispatch-scrub: Phase 2 Wave 1 pre-dispatch scrub canonical example: docs/decisions/wave1-pre-dispatch-scrub-2026-05... (mx-6f2afb)
- [reference] wave1b-tool-implementations: Wave 1b tool reference implementations: code/packages/tools/src/{PolygonTool,PolylineTool,FreehandTo... (mx-13fd3e)
- [decision] retro: Phase 2 Wave 1 — pre-dispatch scrub is load-bearing, not optional: prediction_vs_reality: We expected 8 parallel workers could ship tools directly against the existing... (mx-3a93f1)

## Quick Reference

- `mulch search "query"` — find relevant records before implementing
- `mulch prime --files src/foo.ts` — load records for specific files
- `mulch prime --context` — load records for git-changed files
- `mulch record <domain> --type <type> --description "..."`
  - Types: `convention`, `pattern`, `failure`, `decision`, `reference`, `guide`
  - Evidence: `--evidence-commit <sha>`, `--evidence-bead <id>`
- `mulch doctor` — check record health

# 🚨 SESSION CLOSE PROTOCOL 🚨

**CRITICAL**: Before saying "done" or "complete", you MUST run this checklist:

```
[ ] 1. mulch learn              # see what files changed — decide what to record
[ ] 2. mulch record <domain> --type <type> --description "..."
[ ] 3. mulch sync               # validate, stage, and commit .mulch/ changes
```

**NEVER skip this.** Unrecorded learnings are lost for the next session.

## Domain: licensing

# Project Expertise (via Mulch)

## licensing (4 records, updated 2d ago)
- [convention] Per-package license declared in package.json 'license' field. (mx-6baa8a)
- [decision] AGPL/MPL/MIT license split: apps/* = AGPL-3.0 (SaaS moat). (mx-79d0f3)
- [failure] OpenMoji (CC BY-SA 4.0) and game-icons.net (CC BY 3.0) icons are incompatible with MIT asset library... → Use Phosphor Icons, Heroicons, Lucide, or in-house SVGs only (all MIT/Apache). (mx-a51897)
- [reference] OSM and OpenMapTiles required attribution string: Required attribution on all map views: '© OpenStreetMap contributors (openstreetmap.org/copyright) |... (mx-ec6574)

## Quick Reference

- `mulch search "query"` — find relevant records before implementing
- `mulch prime --files src/foo.ts` — load records for specific files
- `mulch prime --context` — load records for git-changed files
- `mulch record <domain> --type <type> --description "..."`
  - Types: `convention`, `pattern`, `failure`, `decision`, `reference`, `guide`
  - Evidence: `--evidence-commit <sha>`, `--evidence-bead <id>`
- `mulch doctor` — check record health

# 🚨 SESSION CLOSE PROTOCOL 🚨

**CRITICAL**: Before saying "done" or "complete", you MUST run this checklist:

```
[ ] 1. mulch learn              # see what files changed — decide what to record
[ ] 2. mulch record <domain> --type <type> --description "..."
[ ] 3. mulch sync               # validate, stage, and commit .mulch/ changes
```

**NEVER skip this.** Unrecorded learnings are lost for the next session.

## Domain: geo

# Project Expertise (via Mulch)

## geo (10 records, updated 13h ago)
- [convention] customData.geo is the canonical field name on ExcalidrawElement for geo-anchoring (NOT customData.ge... (mx-2ab304)
- [pattern] schema-version-reserved-fields: GeoCustomData carries schemaVersion:1 and projection:'mercator' from v1. (mx-c9454b)
- [failure] replaceAllElements is O(n) — captureUpdate:'never' only skips undo capture, not element replacement ... → Use incremental projection updates instead of full scene replacement. (mx-7dcd40)
- [failure] map.project() assumed not perspective-correct under pitch — wrong. → Set maxPitch:0 in MapLibre constructor options. No runtime correction needed. (mx-e25fe1)
- [failure] Excalidraw concurrent same-id LWW described in plan as not converging — wrong. → No fix needed. versionNonce tiebreak provides LWW convergence. Update mental model. (mx-a444f0)
- [convention] Use 'import type { Map as MapLibreMap }' from maplibre-gl in packages that consume MapLibre types — ... (mx-5da124)
- [decision] CoordinateSync exposes both per-element helpers and bulk orchestrator — not duplicates: geoToScene/sceneToGeo are stateless per-element projection primitives used by individual anchor rend... (mx-f112ea) [relates to: mx-c9454b]
- [pattern] camera-event-driven-react-hook: Map camera-event-driven React hook structure: (1) useMemo builds CoordinateSync instance only when (... (mx-05547b)
- [reference] bench-dominantSegment-unreliable-sub-ms: Bench dominantSegment heuristic is unreliable when both timing segments are sub-millisecond — wrappi... (mx-c9c8cf)
- [convention] scaleMode 9-cell dispatch matrix for _projectElement: GeoAnchor.kind (point|bbox|polyline) x ScaleMo... (mx-2146a2)

## Quick Reference

- `mulch search "query"` — find relevant records before implementing
- `mulch prime --files src/foo.ts` — load records for specific files
- `mulch prime --context` — load records for git-changed files
- `mulch record <domain> --type <type> --description "..."`
  - Types: `convention`, `pattern`, `failure`, `decision`, `reference`, `guide`
  - Evidence: `--evidence-commit <sha>`, `--evidence-bead <id>`
- `mulch doctor` — check record health

# 🚨 SESSION CLOSE PROTOCOL 🚨

**CRITICAL**: Before saying "done" or "complete", you MUST run this checklist:

```
[ ] 1. mulch learn              # see what files changed — decide what to record
[ ] 2. mulch record <domain> --type <type> --description "..."
[ ] 3. mulch sync               # validate, stage, and commit .mulch/ changes
```

**NEVER skip this.** Unrecorded learnings are lost for the next session.

## Recent deltas (this session — last 8 commits)

```
(ml diff unavailable)
```
