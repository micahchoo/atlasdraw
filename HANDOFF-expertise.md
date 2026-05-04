# Project Expertise (via Mulch)

## meta (21 records, updated 35m ago)
- [decision] brainstorming: REVIEW:skill-removed: status=ORPHANED xrefs=OK(7evals) value=REVIEW:skill-removed (mx-bb6e4f)
- [decision] dispatching-parallel-agents: REVIEW:skill-removed: status=ORPHANED xrefs=OK(5evals) value=REVIEW:skill-removed (mx-2d550d)
- [decision] executing-plans: REVIEW:skill-removed: status=ORPHANED xrefs=OK(18evals) value=REVIEW:skill-removed (mx-951339)
- [decision] receiving-code-review: REVIEW:skill-removed: status=ORPHANED xrefs=OK(0evals) value=REVIEW:skill-removed (mx-c88df1)
- [decision] systematic-debugging: REVIEW:skill-removed: status=ORPHANED xrefs=OK(0evals) value=REVIEW:skill-removed (mx-d5fa05)
- [decision] test-driven-development: REVIEW:skill-removed: status=ORPHANED xrefs=STALE(simplify) value=REVIEW:skill-removed (mx-545821)
- [decision] verification-before-completion: REVIEW:skill-removed: status=ORPHANED xrefs=OK(0evals) value=REVIEW:skill-removed (mx-b64124)
- [decision] writing-plans: REVIEW:skill-removed: status=ORPHANED xrefs=OK(10evals) value=REVIEW:skill-removed (mx-9ca4d1)
- [decision] writing-skills: REVIEW:skill-removed: status=ORPHANED xrefs=OK(0evals) value=REVIEW:skill-removed (mx-e64ebb)
- [decision] file:skill-creator/scripts/improve_description.py: REVIEW:may-be-redundant: status=DRIFTED:adopted(24) xrefs=N/A value=REVIEW:may-be-redundant (mx-0a2fee)
- [decision] file:skill-creator/scripts/run_loop.py: REVIEW:may-be-redundant: status=DRIFTED:adopted(40) xrefs=N/A value=REVIEW:may-be-redundant (mx-2d5aff)
- [decision] retro: atlasdraw-planning — cross-phase audit is the highest-value planning artifact: prediction_vs_reality: Expected per-phase plans to be self-consistent; reality was three independent... (mx-7270c4)
- [convention] Cross-worker dep additions must serialize, not parallelize — when two parallel workers both add depe... (mx-372bdb)
- [convention] Serialize auditor after actor — when an actor (builder/demo agent) modifies install state, the audit... (mx-537ae1)
- [convention] File triage seeds mid-session as findings surface, not deferred to handoff prose — each blocker gets... (mx-a174c9)
- [convention] correction: first handoff attempt was incomplete — did not dispatch record-extractor and skipped som... (mx-391d6f)
- [decision] retro: atlasdraw-phase1-wave1 — parallel dispatch saves wall-clock but creates audit timing debt: prediction_vs_reality: Expected 3 parallel workers + parallel Opus audit to produce a clean verified... (mx-ba4db8)
- [convention] Always use absolute paths in Bash tool calls — shell cwd persists across Bash calls in agent threads... (mx-0d9feb)
- [convention] Peer-vs-parent discriminator for wave task assignment: when deferring missing work into an existing ... (mx-537417)
- [decision] retro: atlasdraw-wave1-close — prior-session extractor had already captured most signals; new records are dedup-dependent: prediction_vs_reality: Expected 7 fully-new records across meta/geo/architecture domains; reality wa... (mx-f4b7f9)
- [decision] Stage transition in brainstorm-to-ship: plan → execute: Advanced from plan to execute (mx-06df3c)

## architecture (6 records, updated 1h ago)
- [decision] Single-player mode is first-class deployment: WebSocket opt-in via [realtime] enabled=true in config.toml. (mx-a6b4d4)
- [decision] Hosted flagship by v1.0, no open-core split: Plausible-model: all features in OSS under AGPL. (mx-21c19d)
- [decision] Phase 1 extended to 4 weeks; all subsequent phases shifted +1: Event routing across stacked canvases (MapLibre + Excalidraw pointerEvents) is a high-churn Excalidr... (mx-9fc72d)
- [decision] firebase-project/ KEEP through Phase 2 boundary: 4 files, 34 lines total, zero monorepo references, pristine upstream Excalidraw firestore deployment... (mx-136917)
- [decision] keep local — no GitHub push or commit until atlasdraw-6e33 resolved: User explicit instruction: no gh repo create, no git push, no commit this session. (mx-8afd1a)
- [decision] demo wired into apps/atlas-app skeleton, not a standalone testbed: apps/atlas-app already had package.json + tsconfig; cheaper to extend than scaffold a new testbed. (mx-a07bb7)

## licensing (2 records, updated 4h ago)
- [convention] Per-package license declared in package.json 'license' field. (mx-6baa8a)
- [decision] AGPL/MPL/MIT license split: apps/* = AGPL-3.0 (SaaS moat). (mx-79d0f3)

## geo (4 records, updated 1h ago)
- [convention] customData.geo is the canonical field name on ExcalidrawElement for geo-anchoring (NOT customData.ge... (mx-2ab304)
- [pattern] schema-version-reserved-fields: GeoCustomData carries schemaVersion:1 and projection:'mercator' from v1. (mx-c9454b)
- [convention] Use 'import type { Map as MapLibreMap }' from maplibre-gl in packages that consume MapLibre types — ... (mx-5da124)
- [decision] CoordinateSync exposes both per-element helpers and bulk orchestrator — not duplicates: geoToScene/sceneToGeo are stateless per-element projection primitives used by individual anchor rend... (mx-f112ea) [relates to: mx-c9454b]

## basemap (1 records, updated 1h ago)
- [pattern] hybrid-basemap-default: Bundled minimal PMTiles (world-low-zoom.pmtiles, zoom 0-6, ~200MB) for docker self-host first run. (mx-888336)

## data (2 records, updated 4h ago)
- [decision] Yjs over Automerge for data-layer CRDT: Yjs wins on perf (frequent small mutations, 100-10k features), deeper plugin ecosystem (y-websocket,... (mx-638e2d)
- [decision] Felt importer is read-only API-only GeoJSON snapshot — no binary container: Felt has no binary container format. (mx-20a675)

## sdk (1 records, updated 4h ago)
- [decision] AIStyleClient targets OpenAI Chat Completions shape for BYOK/Ollama compatibility: OpenAI Chat Completions shape is the de-facto API standard. (mx-3d2c6b)

## phase-0-bootstrap (4 records, updated 4h ago)
- [convention] Workspaces array is ['excalidraw-app','packages/*','apps/*'] — upstream 'examples/*' dropped. (mx-78e6ca)
- [convention] corepack enable may fail in restrictive sandboxes; yarn 1.22.22 already on PATH unblocks yarn instal... (mx-799deb)
- [pattern] vendored-upstream-patch-journal: Excalidraw fork vendored at packages/excalidraw. (mx-655050)
- [decision] Quarterly upstream Excalidraw review with hard exit threshold: Continue monthly merges while: merge-time <=2h, no patch broken >1x/quarter, customData field intact... (mx-a4d482)

## infrastructure (1 records, updated 4h ago)
- [decision] Fastify v5 over v4 for apps/storage: Fastify v4 EOL June 2025. (mx-7d393a)

## Quick Reference

- `mulch search "query"` — find relevant records before implementing
- `mulch prime --files src/foo.ts` — load records for specific files
- `mulch prime --context` — load records for git-changed files
- `mulch record <domain> --type <type> --description "..."`
  - Types: `convention`, `pattern`, `failure`, `decision`, `reference`, `guide`
  - Evidence: `--evidence-commit <sha>`, `--evidence-bead <id>`
- `mulch doctor` — check record health

... and 29 more records across 10 domains (use --budget <n> to show more)

# 🚨 SESSION CLOSE PROTOCOL 🚨

**CRITICAL**: Before saying "done" or "complete", you MUST run this checklist:

```
[ ] 1. mulch learn              # see what files changed — decide what to record
[ ] 2. mulch record <domain> --type <type> --description "..."
[ ] 3. mulch sync               # validate, stage, and commit .mulch/ changes
```

**NEVER skip this.** Unrecorded learnings are lost for the next session.

---

## Recent deltas (this session)

Working tree (uncommitted) — record-extractor running in background; deltas land in mulch JSONL.

```
error: too many arguments for 'diff'. Expected 0 arguments but got 1.
```
