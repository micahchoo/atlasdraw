# Mulch expertise sidecar — Phase 4 Wave 0 + smoke-test handoff

Generated: 2026-05-06T18:59:49-07:00

## Recent deltas (this session, HEAD~16..HEAD)

```

Expertise changes since HEAD~17

architecture (6 changes):
  + [convention] mx-01984d No single state/store.ts in atlas-app — pattern is per-conce...
  + [convention] mx-3342d8 App.tsx is a one-liner <MapEditor /> — the actual change-sit...
  + [convention] mx-91343d Data-layer FeatureCollections live in MapLibre sources at ru...
  + [convention] mx-4b9e4e AtlasdrawDocument.scene typed via structural alias SceneElem...
  + [convention] mx-fcce7f Data-layer FeatureCollection mirroring lives in LayerRegistr...
  + [convention] mx-cc3214 Excalidraw v0.18 vendored Scene.replaceAllElements ALWAYS va...

data (3 changes):
  + [failure] mx-d16fa9 Blob.type silently dropped through zip writer — ZIP format h...
  + [failure] mx-ed9854 styleRef:null round-trips inconsistently across the two writ...
  + [decision] mx-2e17ca idb (typed) + custom trailing+ceiling debounce for atlasdraw persistence — not idb-keyval + lodash

excalidraw-api (3 changes):
  + [convention] mx-025e8a MainMenu DefaultItems live at main-menu/DefaultItems.tsx (ke...
  + [convention] mx-30002e <MainMenu.DefaultItems.LoadScene> and <SaveToActiveFile> are...
  + [convention] mx-58c357 Excalidraw v0.18 UIOptions.canvasActions.export.renderCustom...

infrastructure (3 changes):
  + [convention] mx-3c2203 CLI tsconfig must include ../data/src/shpjs.d.ts to compile ...
  + [convention] mx-de40e2 CLI base tsconfig needs "types":["node"] when using node glo...
  + [convention] mx-48b101 vitest 3.0.6 dropped --reporter=basic — use default reporter...

meta (25 changes):
  + [decision] mx-bb6e4f brainstorming: REVIEW:skill-removed
  + [decision] mx-2d550d dispatching-parallel-agents: REVIEW:skill-removed
  + [decision] mx-951339 executing-plans: REVIEW:skill-removed
  + [decision] mx-c88df1 receiving-code-review: REVIEW:skill-removed
  + [decision] mx-d5fa05 systematic-debugging: REVIEW:skill-removed
  + [decision] mx-545821 test-driven-development: REVIEW:skill-removed
  + [decision] mx-b64124 verification-before-completion: REVIEW:skill-removed
  + [decision] mx-9ca4d1 writing-plans: REVIEW:skill-removed
  + [decision] mx-e64ebb writing-skills: REVIEW:skill-removed
  + [decision] mx-0a2fee file:skill-creator/scripts/improve_description.py: REVIEW:may-be-redundant
  + [decision] mx-2d5aff file:skill-creator/scripts/run_loop.py: REVIEW:may-be-redundant
  + [convention] mx-744b7e correction: plan-literal drift includes API-shape drift, not...
  + [decision] mx-e2deba retro: atlasdraw-phase3-w2w3 — acceptance tests surface serialization contracts that plan reviews miss
  + [convention] mx-cb3eb8 Pre-dispatch scrub recurrence rule: when a phase plan is aut...
  - [decision] mx-bb6e4f brainstorming: REVIEW:skill-removed
  - [decision] mx-2d550d dispatching-parallel-agents: REVIEW:skill-removed
  - [decision] mx-951339 executing-plans: REVIEW:skill-removed
  - [decision] mx-c88df1 receiving-code-review: REVIEW:skill-removed
  - [decision] mx-d5fa05 systematic-debugging: REVIEW:skill-removed
  - [decision] mx-545821 test-driven-development: REVIEW:skill-removed
  - [decision] mx-b64124 verification-before-completion: REVIEW:skill-removed
  - [decision] mx-9ca4d1 writing-plans: REVIEW:skill-removed
  - [decision] mx-e64ebb writing-skills: REVIEW:skill-removed
  - [decision] mx-0a2fee file:skill-creator/scripts/improve_description.py: REVIEW:may-be-redundant
  - [decision] mx-2d5aff file:skill-creator/scripts/run_loop.py: REVIEW:may-be-redundant

```

## Domain priming: meta + architecture + excalidraw-api

# Project Expertise (via Mulch)

## meta (20 records, updated 4h ago)
- [convention] Always use absolute paths in Bash tool calls — shell cwd persists across Bash calls in agent threads... (mx-0d9feb)
- [convention] Peer-vs-parent discriminator for wave task assignment: when deferring missing work into an existing ... (mx-537417)
- [convention] Plan literals go stale within 24h of authoring when a parallel wave ships — Phase 2 plan was authore... (mx-d9ab91)
- [convention] When plan claims to 'extend interface with X+Y', grep current types.ts first — X or Y may already be... (mx-ce5d92)
- [convention] Types-only files land before any consumer task — T01 pattern: when multiple downstream tasks (T11/T1... (mx-364d3c)
- [convention] correction: plan literals omit src/ path segment — every atlasdraw package (tools, data, geo, basema... (mx-8ec7b9)
- [convention] pre-dispatch scrub catches integration-seam absence, not just plan-literal drift — Wave 1 scrub foun... (mx-d4f376)
- [convention] clarification: triage skill verdict shape for bucket-A holds — removing needs-triage label without c... (mx-3422c1)
- [convention] advisor catches what regex extracts miss — first scrub draft called T05 and T08 clean based on regex... (mx-d3616b)
- [convention] Barrel export as stub signal — when a package's barrel (index.ts) has not been touched by any consum... (mx-9caad1)
- [convention] correction: plan literals reference phantom files — beyond src/ path segment omission (mx-8ec7b9), W... (mx-619182)
- [convention] correction: plan-literal drift is recursive — the mx-e9dc63 lesson does not inoculate even the plan-... (mx-04ac8d)
- [convention] Test file placement is partial-by-package, not project-wide: geo pkg (code/packages/geo/src/) uses C... (mx-e9408d) [relates to: mx-e9dc63]
- [convention] Audit pre-conventions code when a conventions skill lands — atlasdraw-ui-conventions skill (auto-boo... (mx-43333a)
- [convention] Commit dirty file before dispatching a worker that will touch it — if a file has unrelated uncommitt... (mx-714b96)
- [convention] buildGeoAnchorHandler factory pattern for React-free hook testability — useGeoAnchor.ts exports a fa... (mx-8e3209)
- [convention] Name functions by their return type, not their input type — inferGeometryType (MapEditor.tsx:53) nam... (mx-592d38)
- [convention] Grep lockfile before assuming yarn add is needed — OQ-W4-2 resolution: @playwright/test was already ... (mx-d802af) [relates to: mx-cfac0b]
- [convention] correction: plan-literal drift includes API-shape drift, not just path drift — T11 plan said Promise... (mx-744b7e)
- [convention] Pre-dispatch scrub recurrence rule: when a phase plan is authored before the immediately-preceding w... (mx-cb3eb8)

## architecture (7 records, updated just now)
- [convention] Data layer IDs use dl:${crypto.randomUUID()} format; mint at call site, NOT inside registry — T11, T... (mx-417b33)
- [convention] No single state/store.ts in atlas-app — pattern is per-concern Zustand stores. (mx-01984d)
- [convention] App.tsx is a one-liner <MapEditor /> — the actual change-site for any Excalidraw composition is code... (mx-3342d8)
- [convention] Data-layer FeatureCollections live in MapLibre sources at runtime, not in any registry. (mx-91343d)
- [convention] AtlasdrawDocument.scene typed via structural alias SceneElement = { id: string; type: string; versio... (mx-4b9e4e)
- [convention] Data-layer FeatureCollection mirroring lives in LayerRegistry actions (registerDataLayer, convertAnn... (mx-fcce7f)
- [convention] Excalidraw v0.18 vendored Scene.replaceAllElements ALWAYS validates fractional indices via validateF... (mx-cc3214)

## excalidraw-api (3 records, updated 4h ago)
- [convention] MainMenu DefaultItems live at main-menu/DefaultItems.tsx (kebab-case path), not mainMenu/. (mx-025e8a)
- [convention] <MainMenu.DefaultItems.LoadScene> and <SaveToActiveFile> are closure-bound to internal actions — no ... (mx-30002e)
- [convention] Excalidraw v0.18 UIOptions.canvasActions.export.renderCustomUI is the official extension point for i... (mx-58c357)

## Quick Reference

- `mulch search "query"` — find relevant records before implementing
- `mulch prime --files src/foo.ts` — load records for specific files
- `mulch prime --context` — load records for git-changed files
- `mulch record <domain> --type <type> --description "..."`
  - Types: `convention`, `pattern`, `failure`, `decision`, `reference`, `guide`
  - Evidence: `--evidence-commit <sha>`, `--evidence-bead <id>`
- `mulch doctor` — check record health

... and 73 more records across 3 domains (use --budget <n> to show more)

# 🚨 SESSION CLOSE PROTOCOL 🚨

**CRITICAL**: Before saying "done" or "complete", you MUST run this checklist:

```
[ ] 1. mulch learn              # see what files changed — decide what to record
[ ] 2. mulch record <domain> --type <type> --description "..."
[ ] 3. mulch sync               # validate, stage, and commit .mulch/ changes
```

**NEVER skip this.** Unrecorded learnings are lost for the next session.
