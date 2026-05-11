# HANDOFF-expertise — 2026-05-10 session sidecar

Structured mulch records inherited by the next agent. Domain priming + session deltas.

## Domain priming (`ml prime --domain meta architecture`)

# Project Expertise (via Mulch)

## meta (22 records, updated 59m ago)
- [convention] correction: first handoff attempt was incomplete — did not dispatch record-extractor and skipped som... (mx-391d6f)
- [convention] Peer-vs-parent discriminator for wave task assignment: when deferring missing work into an existing ... (mx-537417)
- [convention] Subagent workers reliably hand-wave verification failures as 'out of scope' or 'pre-existing baselin... (mx-2ad5f6)
- [convention] Two pre-dispatch artifacts cut Worker brief failure rate sharply: (1) PRE-SPIKE — when the plan name... (mx-7ef9cf) [relates to: mx-372bdb, mx-537ae1]
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

## architecture (7 records, updated 3d ago)
- [convention] Data layer IDs use dl:${crypto.randomUUID()} format; mint at call site, NOT inside registry — T11, T... (mx-417b33)
- [convention] No single state/store.ts in atlas-app — pattern is per-concern Zustand stores. (mx-01984d)
- [convention] App.tsx is a one-liner <MapEditor /> — the actual change-site for any Excalidraw composition is code... (mx-3342d8)
- [convention] Data-layer FeatureCollections live in MapLibre sources at runtime, not in any registry. (mx-91343d)
- [convention] AtlasdrawDocument.scene typed via structural alias SceneElement = { id: string; type: string; versio... (mx-4b9e4e)
- [convention] Data-layer FeatureCollection mirroring lives in LayerRegistry actions (registerDataLayer, convertAnn... (mx-fcce7f)
- [convention] Excalidraw v0.18 vendored Scene.replaceAllElements ALWAYS validates fractional indices via validateF... (mx-cc3214)

## Quick Reference

- `mulch search "query"` — find relevant records before implementing
- `mulch prime --files src/foo.ts` — load records for specific files
- `mulch prime --context` — load records for git-changed files
- `mulch record <domain> --type <type> --description "..."`
  - Types: `convention`, `pattern`, `failure`, `decision`, `reference`, `guide`
  - Evidence: `--evidence-commit <sha>`, `--evidence-bead <id>`
- `mulch doctor` — check record health

... and 70 more records across 2 domains (use --budget <n> to show more)

# 🚨 SESSION CLOSE PROTOCOL 🚨

**CRITICAL**: Before saying "done" or "complete", you MUST run this checklist:

```
[ ] 1. mulch learn              # see what files changed — decide what to record
[ ] 2. mulch record <domain> --type <type> --description "..."
[ ] 3. mulch sync               # validate, stage, and commit .mulch/ changes
```

**NEVER skip this.** Unrecorded learnings are lost for the next session.

## Session deltas (`ml diff --since 3be3d90~1`)


Expertise changes since 3be3d90~1

infrastructure (1 change):
  + [pattern] mx-ce83b8 anti-pattern-string-throw

meta (23 changes):
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
  + [decision] mx-e2deba retro: atlasdraw-phase3-w2w3 — acceptance tests surface serialization contracts that plan reviews miss
  + [decision] mx-c41631 file:skill-creator/scripts/run_loop.py: AUTO-MERGE:safe
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
  - [decision] mx-e2deba retro: atlasdraw-phase3-w2w3 — acceptance tests surface serialization contracts that plan reviews miss

