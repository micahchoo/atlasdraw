# Atlasdraw — Phase Overview

**Last updated:** 2026-05-03  
**Source:** `docs/decisions/open-questions-resolution.md`, `docs/decisions/escalations.md`, phase plans `docs/superpowers/plans/`  
**Audit:** `docs/decisions/cross-phase-audit.md`

---

## TL;DR

Atlasdraw ships across 8 phases spanning roughly 25+ weeks: Phase 0 (Week 1) through Phase 6 (v1.0, Weeks 16–25), followed by Phase 7 (v1.5 milestone bundle, months 7–12). The Show HN moment lands at Phase 4 (Week 11) — one Docker command, a working geo-drawing editor, offline-capable. Real-time collaboration ships at Phase 5 (Week 15). v1.0 with embeds, comments, hosted mode, and the Felt importer ships at Phase 6. v1.5 adds the plugin API, mobile field collection, versioning, PostGIS, and QGIS bridge.

---

## Timeline

All weeks are shifted +1 from the original tech spec per Q7 (Phase 1 extended to 4 weeks). Phase 7 uses milestone months rather than fixed weeks.

| Phase | Weeks | Milestone | Gate |
|-------|-------|-----------|------|
| 0 — Baseline | Week 1 | Monorepo scaffolded, CI green, licenses set | `yarn dev` passes at `localhost:3000` |
| 1 — Geo Foundation | Weeks 2–5 | Rectangle drawn on MapLibre stays geo-anchored during pan/zoom | Benchmark gate: `bench/results/phase-1-baseline.json` passes budget; cross-browser E2E matrix green |
| 2 — Tools & Data Layers | Weeks 6–8 | 7 annotation tools + GeoJSON data layers; layer panel | Phase 1 benchmark regression ≤+20%; `yarn test` green |
| 3 — File Format | Week 9 | `.atlasdraw` ZIP container; IndexedDB persistence; CSV/KML/SHP import | Round-trip fuzz test passes; File System Access save/load works |
| 4 — MVP / Self-Host | Weeks 10–11 | **Show HN** — clone repo, one Docker command, working editor | Smoke test: clone→`docker compose up`→map renders in ≤~10 min first run |
| 5 — Real-time | Weeks 12–15 | Cursor presence + Yjs data-layer sync + E2EE annotations | E2E: two browsers in shared room; cursor freeze <1s during 5MB Yjs catch-up |
| 6 — v1.0 | Weeks 16–25 | Embeds, comments, style editor, Felt importer, hosted mode | All v1.0 features flag-gated and smoke-tested; ADR 0005/0006 merged; Stripe billing smoke |
| 7 — v1.5 | Months 7–12 | Plugin API, mobile field collect, versioning, PostGIS, QGIS bridge, AI styling | Six independent ship gates (one per feature); E-01 resolved before DiffEngine (Task 10) |

---

## Phase Summaries

### Phase 0 — Baseline (Week 1)
Convert the Excalidraw fork into the Atlasdraw monorepo. Add workspace packages (`packages/geo`, `packages/basemap`, `packages/data`, `packages/tools`, `packages/sdk`, `packages/cli`), strip upstream telemetry (Sentry, Firebase, `trackEvent`), write the three-way license split (AGPL/MIT/MPL per Q5), create the upstream-merge policy (Q6), and get CI green. Nothing geo runs yet; this is the foundation every later phase builds on.  
**Key contracts produced:** workspace skeleton with all package stubs; `decisions/upstream-patches.md`; `decisions/0004-upstream-merge-policy.md`; license files.  
**Plan:** `docs/superpowers/plans/2026-05-03-atlasdraw-phase-0-baseline.md`

---

### Phase 1 — Geo Foundation (Weeks 2–5)
The hardest milestone: make a rectangle drawn on MapLibre stay glued to its lat/lng during pan/zoom. Implement `CoordinateSync`, `GeoAnchor` (discriminated union — point/bbox/polyline), all projection transforms, `BasemapRegistry`, `<MapCanvas>`, the `PinTool`, and cross-browser event routing (the extra Q7 week). Ends with a measured benchmark spike (Q8) — p50/p95/p99 frame times on 5k elements recorded as the gate for Phase 2.  
**Key contracts produced:** `packages/geo` public API; `packages/basemap`; `packages/tools/PinTool`; `bench/results/phase-1-baseline.json`.  
**Plan:** `docs/superpowers/plans/2026-05-03-atlasdraw-phase-1-geo-foundation.md`

---

### Phase 2 — Geo-aware Tools & Data Layers (Weeks 6–8)
Add the full annotation toolkit (6 more tools: polygon, polyline, freehand, text, image, measurement), establish the annotation-vs-data-layer architectural split, add GeoJSON drag-and-drop import, layer panel sidebar, and PNG export compositing MapLibre + Excalidraw canvases. Regression benchmark gate: +20% over Phase 1 baseline.  
**Key contracts produced:** `LayerRegistry` Zustand slice; `packages/data/geojson.ts`; full tool registry; PNG export pipeline.  
**Plan:** `docs/superpowers/plans/2026-05-03-atlasdraw-phase-2-tools-data-layers.md`

---

### Phase 3 — File Format & Local Persistence (Week 9)
Define the `.atlasdraw` ZIP container format, implement `read(blob)`/`write(doc)` pure functions, add IndexedDB persistence + File System Access API, and wire CSV/KML/SHP importers. The `PersistenceStore` interface produced here is the slot Phase 5 replaces with Yjs-backed storage.  
**Key contracts produced:** `AtlasdrawDocument` type; `read`/`write` API; `PersistenceStore` interface; `parseCSV`.  
**Plan:** `docs/superpowers/plans/2026-05-03-atlasdraw-phase-3-file-format.md`

---

### Phase 4 — MVP Polish & Self-Host (Weeks 10–11)
The Show HN milestone. Add share-via-URL (hash-encoded, LZ-compressed), UUID-based upload sharing (`apps/storage` Fastify v5 service backed by S3/minio), Docker Compose stacks (5-svc full + 3-svc minimal per Q10), bundled low-zoom PMTiles (`world-low-zoom.pmtiles`, zoom 0–6, Q3), onboarding tooltips, and a README smoke test. Single-player, no realtime dependency.  
**Key contracts produced:** `StorageClient` interface; `docker-compose.yml` (5-svc with realtime profile guard) + `docker-compose.minimal.yml`; `BasemapRegistry` with 3 styles; share link contract (`/m/:uuid`).  
**Plan:** `docs/superpowers/plans/2026-05-03-atlasdraw-phase-4-mvp-self-host.md`

---

### Phase 5 — Real-time Collaboration (Weeks 12–15)
Fork `excalidraw-room` into `apps/realtime`. Wire two protocols per Q9: Socket.IO for scene/camera/cursor events; separate `/yjs/:roomId` WebSocket for Yjs data-layer CRDT. Add cursor presence with username + color. E2EE for annotation traffic via scene-crypto (server-trusted relay, per E-01 Option C recommendation). `yjs-crypto.ts` ships as an API stub only — wiring deferred to Phase 6 pending E-01 resolution.  
**Key contracts produced:** `apps/realtime` (Socket.IO + y-websocket endpoints); `yjs-crypto.ts` stub; ADR `0007-yjs-e2ee-threat-model.md`; in-memory TTL eviction.  
**Escalations:** E-01 (Yjs E2EE) gates Task 8 wiring; E-02 gates Phase 7 DiffEngine if E-01 resolves as Option B.  
**Plan:** `docs/superpowers/plans/2026-05-03-atlasdraw-phase-5-realtime.md`

---

### Phase 6 — v1.0: Embeds, Comments, Style Editor, Felt Importer, Hosted Mode (Weeks 16–25)
Ten-week sprint to v1.0. Delivers: `packages/sdk` embed widget (React + vanilla, postMessage-safe per Q11); second Yjs doc per room for threaded comments; Maputnik-based style editor adding to `BasemapRegistry`; Felt importer in `packages/data/felt.ts` (read-only, Q13); Photon geocoding; hosted multi-tenant mode with workspace abstraction + Stripe billing; ADR 0006 telemetry policy + CI guard. ADR 0005 (`sdk-postmessage-contract.md`) frozen.  
**Key contracts produced:** `AtlasdrawAPI` interface (postMessage-safe, frozen); `packages/sdk`; `WorkspaceId`; `LayerStyle` schema + `style-compiler.ts`; comment Yjs doc protocol.  
**Open question:** Felt API rate limits (OQ-9 in Phase 6 plan) blocks Task 15 Step 2 production hardening.  
**Plan:** `docs/superpowers/plans/2026-05-03-atlasdraw-phase-6-v1-embeds-comments.md`

---

### Phase 7 — v1.5: Field Plugins, Versioning, PostGIS, QGIS Bridge (Months 7–12)
Six quasi-independent features shipped as a milestone bundle, each with its own ship gate. Adds: plugin API (Web Worker + postMessage sandbox, `PluginManifest` with SPDX license validation per Q5, `PluginRegistry` with SHA-256 integrity); mobile field collection route (`POST /api/v1/submit/:layerToken`); local-first AI styling (OpenAI-compat); Yjs snapshot/versioning (`SnapshotStore`, `DiffEngine`); PostGIS layer source; QGIS bridge Python plugin. E-01 must be resolved before Task 10 (DiffEngine) if E-01 selects Option B.  
**Key contracts produced:** Plugin SDK (`registerTool`, `registerLayerType`, `registerStylingFn`); `SnapshotStore` API; mobile submit flow.  
**Plan:** `docs/superpowers/plans/2026-05-03-atlasdraw-phase-7-v1.5-field-plugins.md`

---

## Cross-cutting Concerns

| Concern | Phase(s) | Notes |
|---------|----------|-------|
| **Telemetry policy** | 0 (strip upstream), 6 (ADR 0006 + CI guard) | OSS: zero telemetry. Hosted: opt-in events only. SDK: never. Heartbeat: opt-in, configurable endpoint. |
| **License compliance** | 0 (AGPL/MIT/MPL split, per-package `"license"` CI check), 7 (SPDX in plugin manifest) | Three-way split documented in `LICENSING.md`. CI fails on missing package license field. |
| **Security boundaries** | 4 (share token — `adversarial-api-testing`), 5 (E2EE scope documented in E-01), 6 (Stripe webhooks — see GAP-1), 7 (plugin integrity hashing — see GAP-2) | |
| **Observability / error logging** | Not currently planned | GAP-6: no structured error logging or health endpoints for hosted instance. |
| **Accessibility (a11y)** | 6 (Wave 3, Tasks 21–23) | Phases 1–5 accumulate a11y debt. GAP-7. |
| **i18n** | Not planned | New Atlasdraw UI strings not added to Excalidraw's i18n catalog. GAP-8. |
| **Upstream Excalidraw merges** | 0 (policy + CI check), all phases touching `packages/excalidraw` | Monthly merge ritual; hard exit at Q6 threshold. |
| **Performance budgets** | 1 (benchmark spike, Q8), 2 (regression +20%), 4 (bundle size-limit) | Phase 1 benchmark is the ground truth; Phase 2 gates on it. |

---

## Project-level Constraints (Q1–Q13)

| ID | Constraint | Phases |
|----|-----------|--------|
| Q1 | Single-player is first-class; realtime opt-in via `config.toml` | 4, 5 |
| Q2 | Yjs (not Automerge) for data-layer CRDT | 5 |
| Q3 | Hybrid basemap: PMTiles bundled for self-host, OpenFreeMap only for public demo | 4 |
| Q4 | Hosted flagship ships at v1.0; no open-core split; all features in OSS code | 6 |
| Q5 | AGPL for `apps/*`; MIT for `packages/sdk|cli|geo|data`; MPL for `packages/basemap|tools` | 0, 6, 7 |
| Q6 | Quarterly upstream merge review; hard exit threshold defined in ADR 0004 | 0, all |
| Q7 | Phase 1 = 4 weeks (Weeks 2–5); all downstream phases shift +1 from spec | 1–6 |
| Q8 | Phase 1 benchmark spike gates Phase 2; measured p50/p95/p99 in `bench/results/phase-1-baseline.json` | 1, 2 |
| Q9 | Yjs on separate `/yjs/:roomId` WebSocket, not multiplexed with Socket.IO | 5 |
| Q10 | Ship `docker-compose.minimal.yml` (3-svc) and `docker-compose.yml` (5-svc, profiles-guarded) | 4 |
| Q11 | `AtlasdrawAPI` postMessage-safe from v1.0; all methods async; structured-clone-compatible | 6 |
| Q12 | `projection: "mercator"` reserved field in `GeoCustomData` from Phase 1 | 1 |
| Q13 | Felt importer ships in v1.0 (read-only) | 6 |

---

## Open Escalations

| ID | Status | Blocks | Resolution path |
|----|--------|--------|----------------|
| **E-01** | Open — awaiting maintainer decision | Phase 5 Task 8 wiring (stub may proceed); Phase 6 `setPersistence` wiring; Phase 7 DiffEngine if Option B | Maintainer selects Option A/B/C; write ADR 0007; Phase 6 evaluates Option B if C selected |
| **E-02** | Informational — blocked on E-01 | Phase 7 Task 10 (DiffEngine) if E-01 = Option B | Gate: confirm E-01 resolution before Task 10 |
| **E-03** | Open — awaiting maintainer confirmation | Phase 3 GeoAnchor serialization tasks; Phase 5 GeoAnchor consumption | Maintainer confirms discriminated union (Phase 1/spec §3.1) is authoritative; executing-plans agents for P3/P5 correct their pre-work checklist |

---

## Audit Findings

Full detail in `docs/decisions/cross-phase-audit.md`. Summary:

### Cross-phase Mismatches

| ID | Severity | Phases | Issue |
|----|----------|--------|-------|
| MISMATCH-1 | **HIGH** | P1→P3 | `GeoAnchor` shape: Phase 1 produces discriminated union `{kind, ..., zRef}`; Phase 3 consumer table describes flat `{lng, lat, zoom, projection: 'EPSG:4326'}` |
| MISMATCH-2 | MED | P2→P3 | `LayerRegistry` source: Phase 3 says `packages/geo`; Phase 2 produces it at `apps/atlas-app/state/store.ts` |
| MISMATCH-3 | MED | P1→P3 | Field name: Phase 1 uses `customData.geo`; Phase 3 consumer table says `customData.geoAnchor` |
| MISMATCH-4 | LOW | P4→P5 | Phase 5 does not mention the `profiles: ["realtime"]` guard on `docker-compose.yml` |
| MISMATCH-5 | **HIGH** | P1→P5 | `GeoAnchor` shape: Phase 5 consumer table describes flat `{lng, lat, zoom, bearing}`; `bearing` has no provenance in Phase 1/2 types |

### Coverage Gaps

| ID | Severity | Description |
|----|----------|-------------|
| GAP-1 | MED | Phase 6 Stripe webhook tasks lack `adversarial-api-testing` skill annotation |
| GAP-2 | LOW | Phase 7 PluginRegistry install path lacks `adversarial-api-testing` gate task |
| GAP-3 | LOW | Phase 6 has no machine-readable artifact manifest block |
| GAP-4 | MED | No cross-browser visual regression suite for Canvas composite (MapLibre + Excalidraw) |
| GAP-5 | MED | `atlasdraw-tech-spec.md` §10 still describes OpenFreeMap as default basemap; Q3 resolved hybrid — spec not updated in any plan |
| GAP-6 | MED | No structured error logging, health endpoints, or distributed tracing for hosted instance |
| GAP-7 | LOW | a11y coverage starts Phase 6; Phases 1–5 accumulate unchecked debt |
| GAP-8 | LOW | New Atlasdraw UI strings not added to Excalidraw i18n catalog in any plan |
| GAP-9 | LOW | Opt-in heartbeat endpoint (`telemetry.atlasdraw.org`) referenced in ADR 0006 but no plan provisions or tests it |

---

## Recommended Next Actions

Ordered by impact:

1. **Resolve E-03 (GeoAnchor type mismatch) before Phase 3 execution.** One sentence: confirm `GeoAnchor` is the Phase 1 discriminated union. Add a pre-work checklist item to Phase 3 and Phase 5 executing-plans agents — do not edit the plans themselves. This is the highest-risk unresolved item; a wrong serialization format corrupts `.atlasdraw` files.

2. **Resolve E-01 before Phase 5 Task 8 wiring.** Select Option A, B, or C. Write ADR 0007. If Option C (recommended), add the Phase 6 Option B evaluation task to the Phase 6 backlog now so it does not get lost.

3. **Update `atlasdraw-tech-spec.md` §10** to reflect the Q3 hybrid basemap decision. This is a one-paragraph edit; Q3 explicitly flags it as required. No phase plan owns this task — assign it to whichever agent handles spec maintenance.

4. **Add `adversarial-api-testing` gate task to Phase 6 Stripe webhook work** (GAP-1). Stripe webhook signature verification and replay prevention are high-value attack surfaces for a billing integration; the annotation costs one task and a 30-minute review.

5. **Add observability baseline to Phase 4 or Phase 5** (GAP-6). Before the Show HN moment at Phase 4 Week 11, at minimum: structured JSON error logging (`pino`) in `apps/storage`; a `GET /health` endpoint on each service; Caddy access log forwarding. This is a 1-day task that prevents a blind demo.

6. **Add `adversarial-api-testing` gate task to Phase 7 PluginRegistry** (GAP-2). Plugin bundle installation is a supply-chain attack surface; the integrity hash is present but a post-implementation adversarial sweep (tampered bundle, malicious manifest, permission escalation) should be explicit.

7. **Add a visual regression task to Phase 4 or Phase 5** (GAP-4). The Canvas composite (MapLibre + Excalidraw rendered together) is the highest-risk visual surface and has no pixel-level coverage. A single Playwright screenshot fixture at Phase 4 is cheap and catches projection drift early.

8. **Fix Phase 6 machine-readable artifact manifest** (GAP-3). Add a `PLAN_MANIFEST_START/END` block to the Phase 6 plan so executing-plans tooling can verify completeness programmatically.

9. **Add i18n audit task to Phase 6** (GAP-8). New strings in layer panel, share dialog, plugin manager, and comment UI should be wired into the Excalidraw i18n catalog. A 2-hour audit pass in Phase 6 Wave 3 prevents string literal debt.

10. **Provision the opt-in heartbeat endpoint** (GAP-9). Add a Phase 6 infrastructure task to stand up `telemetry.atlasdraw.org` or document that it uses an existing service (Plausible, self-hosted). Without this, the ADR is aspirational rather than functional.
