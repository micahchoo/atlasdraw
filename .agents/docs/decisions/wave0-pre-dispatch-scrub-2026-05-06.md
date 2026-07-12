# Phase 4 Wave 0 — Pre-Dispatch Scrub (2026-05-06)

Cross-grep audit of `docs/superpowers/plans/2026-05-03-atlasdraw-phase-4-mvp-self-host.md`
(76KB, 18 tasks, last touched 2026-05-05) against actual codebase state after Phase 3
W2+W3 closure (commit `26cdbc9`). Same artifact class as
`wave1/2/3-pre-dispatch-scrub-2026-05-04.md` — workers must consume this scrub, NOT
the raw plan, until plan amendments land.

Per `mx-04ac8d` / `mx-744b7e`: plan-literal drift is recursive and now includes
API-shape drift (return types, parameter shapes), not just paths. This scrub greps
function signatures, not just file existence.

---

## Section A — Plan-literal drift (12 findings)

### Critical (worker briefs would land in wrong files)

#### D-1 — Path segment drift, recursive (mx-8ec7b9 / mx-04ac8d class)

18/18 plan paths under `apps/…` miss the `code/` prefix; 6/6 atlas-app paths
additionally miss the `src/` segment. Per Phase 2 rule `mx-e9dc63`: all atlas-app
paths are `code/apps/atlas-app/src/...`.

| Plan literal | Actual path |
|---|---|
| `apps/atlas-app/components/AboutDialog.tsx` | `code/apps/atlas-app/src/components/AboutDialog.tsx` |
| `apps/atlas-app/components/BasemapPicker.tsx` | `code/apps/atlas-app/src/components/BasemapPicker.tsx` |
| `apps/atlas-app/components/ShareDialog.tsx` | `code/apps/atlas-app/src/components/ShareDialog.tsx` |
| `apps/atlas-app/hooks/useAutosave.ts` | `code/apps/atlas-app/src/hooks/useAutosave.ts` (and see D-2) |
| `apps/atlas-app/hooks/useShareLink.ts` | `code/apps/atlas-app/src/hooks/useShareLink.ts` |
| `apps/storage/src/index.ts` | `code/apps/storage/src/index.ts` (does not yet exist — see D-11) |
| `apps/storage/src/config.ts` | `code/apps/storage/src/config.ts` |
| `apps/storage/src/types.ts` | `code/apps/storage/src/types.ts` |
| `apps/storage/src/routes/{health,maps,share}.ts` | `code/apps/storage/src/routes/{health,maps,share}.ts` |
| `apps/storage/src/adapters/{sqlite-fs,postgres-minio}.ts` | `code/apps/storage/src/adapters/{sqlite-fs,postgres-minio}.ts` |
| `infra/data/fetch-pmtiles.sh` | `code/infra/data/fetch-pmtiles.sh` (or `infra/` at repo root — decide) |

#### D-2 — `useAutosave` (T13) duplicates Phase 3 T8

Plan T13 (line 699) defines a "Debounced Save with Drain State" hook. But Phase 3
T8 already shipped:

- `code/apps/atlas-app/src/state/persistence.ts:430 startAutoSave(opts)` — debounce + 30s ceiling + sequence-counter snapshot guard
- `code/apps/atlas-app/src/state/persistence.ts:131 PersistenceStore` interface
- `code/apps/atlas-app/src/state/usePersistenceStore.ts:33 usePersistenceStore` Zustand store
- `code/apps/atlas-app/src/components/MapEditor.tsx:470+` autosave wiring + markDirty in onChange

**Re-scope T13** to: "Wire `startAutoSave` into a useEffect with drain state" — ~30
lines, not a hook author. Delete the duplicate hook implementation steps.

The planner could not have known: T13 was authored 2026-05-05; T8 shipped 2026-05-06.

#### D-3 — `code/apps/realtime/` already exists

Phase 5 stub scaffold (commit 2026-05-03) has `package.json` declaring
`@atlasdraw/realtime` AGPL-3.0 with `start: 'TODO: relay server (Phase 5)'`.
Plan T11 references `docker-compose.realtime.yml` but never acknowledges the
prior scaffold. **Risk:** a worker might re-scaffold realtime. **Fix:** plan
amendment line referencing `code/apps/realtime/` and noting it stays a stub
through Phase 4.

### Substantive (require plan amendments)

#### D-4 — ADR path drift

Plan T17 (line 870) writes ADRs to `docs/architecture/adr/0007-storage-dual-mode.md`
+ `0008-share-link-encoding.md` and references `0006-telemetry.md` /
`0009-error-capture.md`. **`docs/architecture/adr/` does not exist.** All existing
ADR-class artifacts live flat in `docs/decisions/`:

```
docs/decisions/
├── cross-phase-audit.md
├── escalations.md
├── excalidraw-ui-surface-audit-2026-05-04.md
├── opus-audit-2026-05-04*.md
├── phase-N-research-notes.md (N=0..7)
└── waveN-pre-dispatch-scrub-2026-05-04.md (N=1..3)
```

**Decide:** create the `docs/architecture/adr/` hierarchy, or keep ADRs flat under
`docs/decisions/` (and rename to match prefix convention). **Recommendation:** keep
flat — naming `0007-storage-dual-mode.md` works in either location, hierarchy adds
no value.

#### D-5 — Excalidraw barrel literal wrong

Plan references `code/packages/excalidraw/index.ts`; actual is
`code/packages/excalidraw/index.tsx` (per `tsconfig.base.json` paths block:
`"@excalidraw/excalidraw": ["./excalidraw/index.tsx"]`).

#### D-6 — Plan blind to Phase 3 prereqs

Zero references in the plan body to:

- FC registry (`atlasdraw-ad27`, mulch `mx-91343d`)
- Scene hydration (`atlasdraw-3601`)
- MainMenu unification (`atlasdraw-9078`, mulch `mx-30002e`)

See Section B below for prereq gate insertion.

#### D-7 — Plan blind to atlas-app `paths:{}` debt

Zero refs to `tsconfig.base paths clobber` / `atlasdraw-dc84`. atlas-app currently
has 1585 latent tsc errors that vite hides. Phase 4 type-hardening on Storage /
Dialog / Share will collide. See Section B Y-2.

#### D-8 — `BasemapRegistry` greenfield, not "extend"

Plan T5 (line 360) reads "**Extend** `BasemapRegistry`" but `grep` shows zero hits
across `code/`. The registry was deferred from Phase 1 T3 per `atlasdraw-2428`.

**Re-word T5** to "Create or Extend `BasemapRegistry`" with explicit scaffold
steps (`packages/basemap/BasemapRegistry.ts`, `packages/basemap/pmtiles-protocol.ts`)
matching the ORIGINAL Phase 1 T3 spec lines 186-189.

#### D-9 — Dialog API not barrel-exported

Plan T14 (`AboutDialog.tsx`) and T8/T9 (`ShareDialog.tsx`) consume an Excalidraw
`Dialog` component. `code/packages/excalidraw/components/Dialog.tsx` exists but is
NOT exported from `index.tsx` (only `TTDDialog` is, lines 361-363). `atlasdraw-50c0`
correctly flagged this. **Decide:** add a barrel export (single-line bump), or
import via internal path (vendored-fork). **Recommendation:** barrel bump — minimal
diff, idiomatic.

### Operational

#### D-10 — No deps installed yet

`fastify`, `@fastify/*`, `pmtiles`, `pmtiles-protocol`, `pino`, `lz-string` — none
in any workspace `package.json`. Plan needs an explicit Wave 0 dep-install task,
respecting lockfile-mutex per Phase 3 lessons (`mx-714b96`, `mx-cfac0b`).

#### D-11 — `code/apps/storage/` directory absent

Plan jumps to T1 storage contracts; needs Wave 0 scaffold task before any T1-T4
dispatch.

#### D-12 — `infra/data/` and `docs/self-host/` absent

T12 (Makefile basemap-world recipe) and T15 (self-host README) need scaffold steps.

---

## Section B — Prior-phase debt landing on Phase 4 (5 prereqs + 2 visible-UX)

### Required Wave 0 gates

| ID | Class | Title | Source phase |
|---|---|---|---|
| `atlasdraw-2428` | B-1 | BasemapRegistry + pmtiles-protocol + style-builder (deferred from P1 T3) | Phase 1 |
| `atlasdraw-ad27` | B-2 | Data-layer FC registry (selectDocument layers gap, mx-91343d) | Phase 3 W2 |
| `atlasdraw-3601` | B-2 | Excalidraw scene hydration on persistence load() | Phase 3 W2 |
| `atlasdraw-9078` | B-2 | MainMenu .excalidraw vs .atlasdraw unification (mx-30002e) | Phase 3 W2 |
| `atlasdraw-50c0` | B-3 | Vendored Dialog API (Share/About/Help) | Phase 4 plan-amendment |

### Should-fix before dispatch

| ID | Class | Title | Risk |
|---|---|---|---|
| `atlasdraw-5cba` | Y-1 | tech-spec.md §10 still says OpenFreeMap default basemap | Doc/code drift contradicts Q3 resolution |
| `atlasdraw-dc84` (closed `rework`) | Y-2 | atlas-app `paths:{}` clobber → 1585 latent tsc errors | Phase 4 type-hardening collision |
| `atlasdraw-04f8` | Y-3 | HELD: Manual corepack enable (Phase 0) | New `code/apps/storage/` workspace install hits this |

### Visible-UX bugs that demos will surface

| ID | Severity | Title |
|---|---|---|
| `atlasdraw-4142` | high | Mixed-geometry GeoJSON FCs render only first feature's geometry style |
| `atlasdraw-76b2` | high | Polyline geo-anchor breaks when zoom > creation zoom (line/arrow/freedraw) |

Phase 4 = self-host + Show HN demo. Both bugs are visible to first-touch users.
**Triage decision needed** on whether to fix in P4 or accept as known issues.

---

## Section C — Verified literals (workers may copy verbatim)

### Phase 3 shipped APIs (consume; do not re-implement)

```ts
// from @atlasdraw/data (code/packages/data/src/index.ts)
export { write, read, AtlasdrawFormatError } from "./atlasdraw";        // line 35
export { writeJSON, readJSON, AtlasdrawJSONError } from "./atlasdraw-json"; // line 38
export { generateThumbnail } from "./thumbnail";                         // line 52
export { parseShapefile, ShapefileParseError } from "./shapefile";       // line 49

// from atlas-app persistence layer (Phase 3 T8/T9 outputs)
// code/apps/atlas-app/src/state/persistence.ts
export interface PersistenceStore { ... }                                 // line 131
export function createPersistenceStore(...): PersistenceStore             // line 162
export function startAutoSave(opts): { stop(): void }                     // line 430

// code/apps/atlas-app/src/state/usePersistenceStore.ts
export const usePersistenceStore = create<PersistenceState>()(...)        // line 33

// code/apps/atlas-app/src/state/selectDocument.ts (T9)
// — note: ships `layers: new Map()` for v1; FC hydration deferred (atlasdraw-ad27)
```

### Excalidraw vendored (existing surface)

```
code/packages/excalidraw/index.tsx                  # NOT index.ts (D-5)
code/packages/excalidraw/components/Dialog.tsx      # exists; NOT in barrel (D-9)
code/packages/excalidraw/components/main-menu/      # kebab-case path (mx-43333a class)
```

### Existing workspace structure

```
code/apps/atlas-app/         # Phase 1-3 surface
code/apps/realtime/          # Phase 5 stub (May 3) — leave alone (D-3)
code/packages/{data,cli,basemap,geo,tools,excalidraw,common,element,math,utils}
```

### Tasks already shipped that Phase 4 plan may double-spec

- T8 IndexedDB autosave (`startAutoSave`) — replaces P4 T13 hook spec (D-2).
- T9 MainMenu items (Save/Open `.atlasdraw`) — P4 T8/T9 must layer on this, not duplicate.
- T11 CLI `convert` subcommand — share-via-link encoder may share `lz-string` stack.
- T12 round-trip acceptance (6 tests) — Phase 4 share-link tests must NOT break this.

---

## Section D — Recommended Wave 0 dispatch sequence

Before T1, materialize these gates in order:

1. **Plan-amendment commit** — fix D-1 / D-2 / D-3 / D-4 / D-5 / D-8 in
   `2026-05-03-atlasdraw-phase-4-mvp-self-host.md`. Add Pre-Work Checklist gates
   for B-1, B-2 (×3), B-3.
2. **Doc-debt commit** — patch `tech-spec.md §10` per `atlasdraw-5cba`. Re-file
   composite-tsconfig refactor seed.
3. **Wave 0 scaffold task** — create `code/apps/storage/` skeleton (package.json
   only, no logic) + `code/packages/basemap/{BasemapRegistry,pmtiles-protocol}.ts`
   stubs. Single worker, no parallelism, lockfile mutex active.
4. **Wave 0 prereq tasks** — dispatch B-2 prereqs (FC registry, scene hydration,
   MainMenu unification) as 3 parallel Action workers per Delegation Protocol.
   Each is bounded to atlas-app; zero cross-worker file overlap.
5. **Wave 0 dep-install** — single worker adds Fastify/pmtiles/lz-string/pino to
   `code/apps/storage/package.json` + `code/apps/atlas-app/package.json`. Lockfile
   mutex.
6. **Visible-UX triage** — decide `atlasdraw-4142` and `atlasdraw-76b2` for P4 or
   defer.
7. Only THEN dispatch T1 (storage contracts) per the plan.

Wave 0 cost estimate: 1 setup commit + 4 worker commits ≈ 5 commits, ~1 session.

---

## Section E — Rule reaffirmation

This is the **fifth confirmed instance** of plan-literal drift in atlasdraw
planning (8ec7b9 → 619182 → 04ac8d → 744b7e → THIS). The lesson is recursive:
each scrub catches a new drift category the prior scrubs didn't anticipate.

**For Phase 5+ planners:** use this scrub artifact as a template. Specifically,
the cross-grep matrix in Section A (plan literal | actual path) catches every
class except behavioral contracts (mx-e2deba) — which only round-trip tests
surface.

**Mulch records to update post-scrub:**
- New convention: "When a plan is authored before the immediately-preceding wave
  ships, the planner is blind to that wave's outputs — re-scrub the plan against
  HEAD after every wave close, before any dispatch."
