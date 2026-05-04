# Atlasdraw — Evolution

**Status: Speculative.** Derived from PHASES.md, phase plans, and cross-phase audit.
No code exists.

This document predicts how Atlasdraw's architecture will change over its Phase 0–7 lifetime,
where stratigraphic faults will form, and where re-evaluation checkpoints are warranted.

Cross-references: `risk-map.md` (technical risks), `subsystems.md` (boundary evolution).

---

## Phase Timeline

| Phase | Calendar | Name | Architecture milestone |
|-------|----------|------|----------------------|
| 0 | Week 1 | Baseline | Monorepo scaffolded; CI green; license files; ADRs 0001–0006 |
| 1 | Weeks 2–5 | Geo Foundation | `packages/geo` + `packages/basemap` functional; CoordinateSync; benchmark gate |
| 2 | Weeks 6–8 | Tools & Data Layers | `packages/tools` (7 annotation tools); `packages/data` (GeoJSON data layers); layer panel |
| 3 | Week 9 | File Format | `.atlasdraw` ZIP container; IndexedDB persistence; CSV/KML/SHP import; fuzz test |
| 4 | Weeks 10–11 | MVP / Self-Host | `apps/storage` (Fastify + Postgres/MinIO); `apps/atlas-app` share API; docker-compose; **Show HN** |
| 5 | Weeks 12–15 | Real-time | `apps/realtime` (Socket.IO + y-websocket); cursor presence; Yjs data-layer sync |
| 6 | Weeks 16–25 | v1.0 | `packages/sdk` (embed); comments; Maputnik style editor; Felt importer; hosted mode; Stripe |
| 7 | Months 7–12 | v1.5 | Plugin API (`packages/plugin-host`); mobile field collection; versioning; PostGIS; QGIS bridge; AI styling |

(PHASES.md)

---

## Era Markers

### Era A: Single-file (Phases 0–3, Weeks 1–9)

The architectural shape is simple: a fork of Excalidraw extended with geo capabilities.
No server required. The canonical storage unit is a `.atlasdraw` file on disk.

**What the code will look like:** `atlas-app` imports from `packages/geo`, `packages/basemap`,
`packages/tools`, `packages/data`. All logic lives close to the surface. The layer panel and
toolbar are Phase 2 additions, but they are relatively direct compositions of existing packages.

**What "old code" looks like by Phase 7:** Anything written in Phase 1 that did not
anticipate the Yjs CRDT data model (Phase 5) or the workspace abstraction (Phase 6). State that
was scoped to a single session and assumed no persistence layer. The `LayerRegistry` Zustand
slice from Phase 2 (`apps/atlas-app/state/store.ts`) will feel like a Phase 1 artifact when
Phase 5 introduces a Yjs-backed equivalent for shared rooms.

---

### Era B: Server-backed (Phases 4–5, Weeks 10–15)

The Show HN moment (Phase 4) is the structural inflection point: `apps/storage` and the share
API make the product a client–server system for the first time. Phase 5 adds `apps/realtime`.

**What changes architecturally:** The trust boundary moves. Before Phase 4, there is no server;
all state is local. After Phase 4, the storage service is a persistence authority. After Phase 5,
the realtime relay becomes a coordination authority for shared rooms. These are new trust zones
that did not exist in Era A.

**What "old code" looks like by Phase 7:** The Phase 4 `STORAGE_MODE=sqlite-filesystem` branch
of `apps/storage` will be a maintenance burden. It was introduced for the minimal stack (Q10)
but will receive fewer iterations than the `postgres-minio` path. By Phase 7, the filesystem
storage mode may be semi-abandoned — present but undertested.

---

### Era C: Platform (Phases 6–7, Weeks 16–Months 12)

Phase 6 adds the hosted-flagship operational layer (workspaces, billing, multi-tenant auth).
Phase 7 adds the plugin extension API — turning Atlasdraw from an application into a platform.

**What changes architecturally:** The AtlasdrawAPI (introduced in Phase 6 as the embed SDK
surface) becomes the plugin contract in Phase 7. `packages/sdk` and `packages/plugin-host` both
depend on this API — it is now a published interface with ADR-governed stability requirements
(ADR 0005, Q11).

**What "old code" looks like by Phase 7:** The `packages/excalidraw` vendored fork. By Phase 7,
the fork will have been through ~8 months of monthly merges. The `upstream-patches.md` list will
have grown. Any patch that has caused merge conflicts more than once per quarter is a candidate
for refactoring to reduce surface area. By Phase 7, there will likely be one or two patches that
are borderline — maintained but painful.

---

## Predicted Stratigraphic Faults

Stratigraphic faults are points in the codebase where two architectural eras meet — code written
under different assumptions that now shares a boundary. These are the highest-maintenance seams.

### Fault 1: `packages/excalidraw` vs. `packages/geo` / `packages/tools`

**Nature:** The vendored Excalidraw fork (Era A, frozen vendor risk) vs. the new packages built
on top of it. Every new Atlasdraw-specific feature must live outside `packages/excalidraw` (to
reduce upstream merge surface) but must call into it for element creation and scene updates.
Over time, the boundary between "what Excalidraw owns" and "what Atlasdraw owns" becomes harder
to maintain as geo features grow.

**Predicted migration boundary:** By Phase 7, some Phase 1–2 code that was placed inside
`packages/excalidraw` (tuned defaults, hit-testing adjustments) will be identified as belonging
in `packages/tools` or `apps/atlas-app`. Partial migration is likely — a stratigraphic fault
between the patched upstream code and the new packages. This is the highest-probability fault.

**Signal to watch:** The length of `upstream-patches.md` and the frequency of merge conflicts
in `packages/excalidraw/src/` (renderer, tool handling). If conflicts concentrate in the same
files quarter after quarter, those files are fault candidates.

---

### Fault 2: `apps/atlas-app` state vs. Yjs data-layer state

**Nature:** Phase 2 introduces `LayerRegistry` as a Zustand slice in `apps/atlas-app/state/store.ts`.
Phase 5 introduces a Yjs-backed data layer for shared rooms. These are two different state models
for the same conceptual domain (data layers). The composition — when is state in Zustand, when
in Yjs — will be a recurring maintenance question.

**Note:** This is also documented as MISMATCH-2 in the cross-phase audit (Phase 3 incorrectly
lists `LayerRegistry` source as `packages/geo` when Phase 2 produces it at `apps/atlas-app`).
This naming confusion is an early indicator of the fault.

**Predicted migration boundary:** By Phase 7, there will likely be a hybrid: Zustand as the
single-player local store, Yjs as the shared store for collaborative rooms. The `LayerRegistry`
abstraction will need to dispatch to the appropriate backend. This seam is load-bearing — tests
must cover both paths.

---

### Fault 3: `apps/storage` minimal stack vs. full stack

**Nature:** Phase 4 ships two storage modes (`sqlite-filesystem` and `postgres-minio`). The
minimal stack is introduced for "try it" use cases (Q10). Over time, the full stack receives
Phase 5–7 features (workspace model, comment threads, versioning) that are difficult or
impossible to implement in the sqlite-filesystem mode.

**Predicted migration boundary:** By Phase 6–7, the `sqlite-filesystem` code path will be a
maintained stub — present but receiving only minimal feature backfill. Operators who started
on the minimal stack and want Phase 6 features will need to migrate to the full stack. This
is the predicted operational fault.

---

### Fault 4: `atlas-app` as stream capture zone

**Nature:** `apps/atlas-app` is the composition hub. As new features ship in Phases 5–7
(workspace UI, plugin manager, mobile field collection route, AI styling panel), `atlas-app`
will be the natural landing zone for code that probably belongs in packages.

**Predicted behavior:** By Phase 7, `apps/atlas-app/components/` will contain some logic that
belongs in `packages/tools` or `packages/data` but was placed directly in the app for speed.
This is the "stream capture" pattern described in `subsystems.md`.

**Signal to watch:** Components in `apps/atlas-app` that directly import from external geocoding
or routing services (should be in `packages/data`), or components that contain coordinate math
(should be in `packages/geo`).

---

## Recommended Re-evaluation Points

These are milestone moments where the architecture should be evaluated against real code, not just plans.

### Post-Phase-1 benchmark gate (Week 5)

**What to evaluate:**
- Does `GeoAnchor` type shape match between Phase 1 definition and Phase 3 consumer expectations?
  Resolve MISMATCH-1, -3 before Phase 3 ships. This is the most time-sensitive evaluation.
- Does the CoordinateSync benchmark pass all edge cases (pinch zoom, DPR > 1, resize)?
- Is `packages/geo` appropriately narrow, or did Phase 1 pull too much logic into `atlas-app`?

**Action if not:** Phase 3 file format should be frozen. Any `GeoAnchor` type correction before
Phase 3 is cheap. After Phase 4 (public Show HN), a file format change requires migration.

---

### Post-Phase-3 file format freeze (Week 9)

**What to evaluate:**
- Is the `.atlasdraw` ZIP manifest schema stable enough to call v0.1? After Show HN (Phase 4),
  files will be distributed publicly. Breaking the format requires a migration story.
- Are all known mismatches (MISMATCH-1, -3, -5) resolved in the round-trip fuzz test?
- Does the `packages/data` round-trip test cover the `GeoAnchor` field correctly?

**Action if not:** Delay Phase 4 Show HN until the file format is frozen. A broken public file
format is harder to fix than a delayed release.

---

### Post-Phase-5 collab E2EE decision (Week 15)

**What to evaluate:**
- Has E-01 resolved? ADR 0007 should be in Accepted status, not Pending.
- If E-01 resolves as Option B (true E2EE), does Phase 6 scope include the rework?
  Does this affect Phase 7 DiffEngine (E-02)?
- Is the `yjs-crypto.ts` stub wiring complete, or is it still deferred into Phase 7?

**Action if not:** Phase 6 hosted-flagship ships with plaintext collaboration if E-01 is still
unresolved. This is a security property gap that must be disclosed in the hosted-mode documentation.

---

### Post-Phase-7 v2 milestone (Month 12)

**What to evaluate:**
- Is the Excalidraw upstream merge still within the Q6 threshold? Has the hard-exit been
  triggered? If the monthly merge cost has grown beyond 2 hours, evaluate the thin-wrapper
  alternative now rather than in another quarter.
- Is the `LayerRegistry` state model (Zustand vs. Yjs) clear? Or has the fault grown into a
  maintenance burden?
- Has the `apps/atlas-app` stream capture been significant enough to warrant an extraction
  sprint before v2 planning?
- Is `packages/plugin-host` Worker sandboxing sufficient for the plugin ecosystem that has
  formed? If community plugins exist, security auditing is warranted.

**Action if not:** Version 2 architecture discussion should be grounded in the fault map above.
The cheapest time to correct a stratigraphic fault is before the next major version adds more
layers on top.
