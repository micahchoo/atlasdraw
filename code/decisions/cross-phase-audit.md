# Atlasdraw — Cross-Phase Audit

**Date:** 2026-05-03  
**Auditor:** cross-phase-auditor agent  
**Scope:** Phase plans 0–7, open-questions-resolution.md, escalations.md, PRD.md, atlasdraw-tech-spec.md  
**Status:** Complete

---

## 1. Producer/Consumer Contract Audit

### 1.1 Phase 0 → Phase 1

**Phase 0 produces (relevant to Phase 1):**
- Monorepo workspace skeleton with `packages/geo`, `packages/basemap`, `packages/tools`, `apps/atlas-app`
- `decisions/upstream-patches.md` (empty initial state + CI check)
- `decisions/0004-upstream-merge-policy.md`
- ADR `0006-telemetry.md` (deferred; actually written in Phase 6 per plan)
- License files (`LICENSE-AGPL`, `LICENSE-MIT`, `LICENSE-MPL`, `LICENSING.md`)

**Phase 1 consumes (stated):**
- Monorepo workspace skeleton — matches Phase 0 output. OK.

**Finding:** No mismatch. Phase 1 consumes the workspace skeleton and nothing else from Phase 0.

**NOTE:** ADR `0006-telemetry.md` is listed as a Phase 0 cross-cutting constraint in `open-questions-resolution.md` but is not written until Phase 6. Phase 6 Task 4 correctly writes it before any SDK or hosted-mode tasks. The document is needed at enforce-time (CI guard in Phase 6 Task 27), not at Phase 0, so this is not a blocker — but Phase 0 LICENSING.md should reference the pending telemetry policy intent.

---

### 1.2 Phase 1 → Phase 2

**Phase 1 produces:**
- `packages/geo` public exports: `CoordinateSync`, `GeoAnchor`, `GeoCustomData`, `projectElement`, `geoToExcalidraw`, `excalidrawToGeo`, `bounds`
- `GeoAnchor` type defined as discriminated union: `{ kind: "point"|"bbox"|"polyline"; ... ; zRef: number }`
- `packages/basemap` (`<MapCanvas>`, `BasemapRegistry`)
- `packages/tools/PinTool`
- `apps/atlas-app/components/MapEditor.tsx`
- `bench/results/phase-1-baseline.json`

**Phase 2 consumes (stated):**
- `GeoAnchor` types from `packages/geo/types.ts`: `point | bbox | polyline` discriminated union — **matches Phase 1 definition**. OK.
- `CoordinateSync`, `<MapEditor>`, `BasemapRegistry`, `PinTool` — all match. OK.

**Finding:** Phase 1 → Phase 2 contract is clean. No mismatches.

---

### 1.3 Phase 2 → Phase 3

**Phase 2 produces:**
- `LayerRegistry` Zustand slice at `apps/atlas-app/state/store.ts` (exported as `useLayerRegistry`)
- `packages/geo/geo-anchor.ts` — exports `GeoAnchor` (discriminated union per Phase 1/2 shape)
- `packages/data/geojson.ts`
- Full tool registry (7 tools) at `packages/tools/index.ts`

**Phase 3 consumes (stated):**

| ISSUE | Severity |
|-------|----------|
| **MISMATCH-1 (HIGH):** Phase 3 "Consumes from Phase 2" table lists `GeoAnchor` shape as `{ lng: number, lat: number, zoom: number, projection: 'EPSG:4326' }` — a flat object. Phase 1 defines `GeoAnchor` as a discriminated union `{ kind: "point"\|"bbox"\|"polyline", ..., zRef: number }`. The flat shape matches neither the spec nor the Phase 1 type definition. | HIGH |
| **MISMATCH-2 (MED):** Phase 3 lists `LayerRegistry` source as `packages/geo`. Phase 2 produces it at `apps/atlas-app/state/store.ts` (a Zustand slice, not a `packages/geo` export). The `LayerRegistry` type is in `packages/data/layer-registry.ts`; the state slice is in the app package. | MED |
| **MISMATCH-3 (MED):** Phase 3 lists `element.customData.geoAnchor: { lng, lat, zoom }` as the field shape. Phase 1 defines it as `element.customData.geo: GeoAnchor` (field name `geo`, not `geoAnchor`; structure is discriminated union). | MED |

**Citations:**
- Phase 3 plan, "Consumes from Phase 2" table
- Phase 1 plan, `packages/geo/types.ts` artifact manifest entry; tech spec §3.1

---

### 1.4 Phase 3 → Phase 4

**Phase 3 produces:**
- `AtlasdrawDocument` type with `{ manifest, scene, layers, styleRef, files }`
- `read(blob): Promise<AtlasdrawDocument>` (pure, throws `AtlasdrawFormatError`)
- `write(doc): Promise<Blob>`
- `PersistenceStore` interface: `{ save(doc), load(), onDirty(cb) }`
- `parseCSV(blob): Promise<GeoJSON.FeatureCollection>`

**Phase 4 consumes (stated):**
- `AtlasdrawDocument` type — cited at "Phase 4 share-via-URL". Phase 4 plan uses `read(blob)` before URL encoding. Match. OK.

**Finding:** Phase 3 → Phase 4 contracts match. No mismatches.

---

### 1.5 Phase 4 → Phase 5

**Phase 4 produces:**
- `StorageClient` interface: `createMap`, `getMap`, `updateMap`, `createShareToken`
- `docker-compose.yml` (5 services) with `profiles: ["realtime"]` guard on realtime container
- `docker-compose.minimal.yml` (3 services: web, storage, minio)
- `StorageMode` union: `'postgres-minio' | 'sqlite-fs'`
- `/m/:uuid` share route frozen
- `BasemapRegistry` with 3 styles (for Phase 6 style editor)

**Phase 5 consumes (stated):**
- `Storage API (/api/maps/:id GET/PUT)` from Phase 4, `apps/storage` — matches `StorageClient.getMap`/`updateMap`. OK.
- `docker-compose.yml (5-svc)` from Phase 4, `infra/` — **PARTIAL MISMATCH-4 (LOW):** Phase 5 states "Existing services: web, storage, minio, postgres, caddy" but Phase 4 produces a profiles-guarded file where `realtime` is in profile. The 5-svc description in Phase 5 is accurate (those 5 exist), but it does not mention the profiles guard. This is a documentation precision issue, not a structural conflict.
- `docker-compose.minimal.yml (3-svc)` from Phase 4, `infra/` — "web, storage, minio — no realtime" matches Q10. OK.
- `GeoAnchor type` listed as source `packages/geo/geo-anchor.ts`, shape `{lng, lat, zoom, bearing}` — **MISMATCH-5 (HIGH):** Phase 5 gives `GeoAnchor` shape as `{lng, lat, zoom, bearing}` (flat, adds `bearing`), contradicting Phase 1's discriminated union `{kind, ..., zRef}`. `bearing` does not appear in Phase 1 or Phase 2 type definitions. This is the same category of drift as MISMATCH-1.

**Citations:**
- Phase 5 plan, "Consumes from Phases 1–4" table
- Phase 1 plan, tech spec §3.1

---

### 1.6 Phase 5 → Phase 6

**Phase 5 produces (for Phase 6) — shape-incorporated additions:**
- `yjs-crypto.ts` stub (API + tests, not wired): `encryptUpdate`/`decryptUpdate`
- `setPersistence` wiring contract: Phase 6 must wire `bindState`/`writeState` to storage API
- Threat-model ADR `0007-yjs-e2ee-threat-model.md`
- `apps/realtime` with `/socket.io` and `/yjs/:roomId` endpoints
- In-memory TTL eviction (ROOM_TTL_MS = 300_000ms default)

**Phase 6 consumes (stated):**
- `Yjs WebSocket room` — `apps/realtime` runs `y-websocket` on the same port. OK.
- Phase 6 adds second `Y.Doc` per room for comments. This is additive, no conflict.
- `Docker Compose stack` — `docker-compose.yml` with web + storage + minio. Phase 6 adds `stripe-cli` container. OK.

**Notable:** Phase 6 correctly lists the `setPersistence` wiring obligation as its own work (wires `bindState`/`writeState` per E-01/OQ-2 contract). This cross-phase handoff is well-documented.

**Finding:** Phase 5 → Phase 6 is clean. No structural mismatches.

---

### 1.7 Phase 6 → Phase 7

**Phase 6 produces (for Phase 7):**
- `AtlasdrawAPI` interface (postMessage-safe, ADR 0005 frozen)
- `packages/sdk` embed widget
- `WorkspaceId` workspace abstraction
- `LayerStyle` schema + `style-compiler.ts`
- Comment Yjs doc protocol (second `Y.Doc` per room, versioned schema)

**Phase 7 consumes:**
- `AtlasdrawAPI` postMessage-safe interface — cited as foundation for plugin postMessage bridge. Match. OK.
- `packages/sdk` — plugin sandbox uses `AtlasdrawAPI` via sdk. Match. OK.
- `WorkspaceId` — plugin manifest carries `workspaceId`. Match. OK.
- `LayerStyle` + `style-compiler.ts` — plugin-authored styles. Match. OK.
- Comment Yjs doc protocol — Phase 7 adds comment reactions, thread subscriptions on top. Match. OK.

**Finding:** Phase 6 → Phase 7 contracts are clean.

---

## 2. Tech Stack Consistency

### 2.1 Fastify Version

Phase 4 Shape Changes Summary explicitly records: "Added `apps/storage/package.json` Modify row as Fastify v5.8.x marker" — corrected from an earlier wrong version. The correction applies to Phase 4's `apps/storage`. Phases 5 and 6 add routes to the same `apps/storage` service; no phase specifies a different Fastify version. Phase 5 and Phase 6 plans do not re-assert the Fastify version, meaning they inherit Phase 4's v5.8.x.

**Finding:** No Fastify version drift across plans. The correction was applied only in Phase 4 (where `apps/storage` is built) and inherited silently downstream. LOW risk — if a Phase 5/6 task manually reinstalls or pins Fastify, it could pin a wrong version. Recommend adding a Fastify version assertion to Phase 5 and Phase 6 pre-work checklists.

### 2.2 Yjs Versions

No phase specifies a `yjs` package semver directly; all phases reference `yjs` by name. Phase 5 adds `y-websocket` and `y-protocols`. No version conflicts found.

### 2.3 MapLibre GL JS

All phases reference `maplibregl` without version pinning in the plan text. Phase 1 basemap sets up MapLibre; downstream phases consume it. No version conflicts stated.

---

## 3. Decision Propagation Audit (Q1–Q13)

| Decision | Affected Phases | Verified Applied |
|----------|----------------|-----------------|
| Q1 — Single-player first-class | 4, 5 | Phase 4: `docker-compose.minimal.yml` (3-svc). Phase 5: realtime opt-in via profiles guard. OK. |
| Q2 — Yjs not Automerge | 5 | Phase 5: y-websocket, separate /yjs/ WebSocket. OK. |
| Q3 — Hybrid basemap default | 4 | Phase 4: PMTiles bundled, `BasemapRegistry` defaults to local-pmtiles. OK. |
| Q4 — Hosted flagship v1.0 | 6 | Phase 6: workspace abstraction, Stripe hooks, per-workspace quotas. OK. |
| Q5 — AGPL/MIT/MPL split | 0, 6, 7 | Phase 0: license files created. Phase 6: `packages/sdk` MIT. Phase 7 Task 1: SPDX field in `PluginManifest` (explicitly cites Q5). OK. |
| Q6 — Upstream merge policy | 0, all | Phase 0: `upstream-patches.md` + ADR 0004. No phase that touches `packages/excalidraw` was found to be missing the upstream-patches update obligation. OK. |
| Q7 — Phase 1 = 4 weeks | 1–7 | Phase 1: Weeks 2–5. Phase 2: Weeks 6–8. Phase 3: Week 9. Phase 4: Weeks 10–11. Phase 5: Weeks 12–15. Phase 6: Weeks 16–25. All correctly shifted +1 from spec. Phase 7 does not give a shifted week number; uses "months 7–12" (Weeks 26+). OK for a long milestone phase. |
| Q8 — Phase 1 benchmark gate | 1, 2 | Phase 1: benchmark spike Task 16 in Wave 3. Phase 2: gates on `phase-1-baseline.json` existing. OK. |
| Q9 — Separate WebSocket for Yjs | 5 | Phase 5: `/yjs/:roomId` separate endpoint. OK. |
| Q10 — 3-svc + 5-svc compose | 4 | Phase 4: both files produced. OK. |
| Q11 — AtlasdrawAPI postMessage-safe | 6 | Phase 6: all methods async, structured-clone-compatible, ADR 0005. OK. |
| Q12 — `projection` field in GeoCustomData | 1 | Phase 1: `projection: "mercator"` in `GeoCustomData`; CoordinateSync asserts it. OK. |
| Q13 — Felt importer v1.0 | 6 | Phase 6: `packages/data/felt.ts` task; test fixtures. OK. |

**No silent violations of Q1–Q13 found.** The GeoAnchor shape mismatches (MISMATCH-1, MISMATCH-3, MISMATCH-5) are documentation inconsistencies within the consumer phases, not Q-decision violations.

---

## 4. Wave-Week Timing Verification

| Phase | Spec weeks | Q7-shifted weeks | Plan states |
|-------|-----------|-----------------|-------------|
| 0 | Week 1 | Week 1 | Week 1 |
| 1 | Weeks 2–4 | Weeks 2–5 (+1 extended per Q7) | Weeks 2–5 |
| 2 | Weeks 5–7 | Weeks 6–8 | Weeks 6–8 |
| 3 | Week 8 | Week 9 | Week 9 |
| 4 | Weeks 9–10 | Weeks 10–11 | Weeks 10–11 |
| 5 | Weeks 11–14 | Weeks 12–15 | Weeks 12–15 |
| 6 | Weeks 15–24 | Weeks 16–25 | Weeks 16–25 |
| 7 | (post v1.0) | Weeks 26+ | "months 7–12" (no explicit shifted number) |

**Finding:** All phases 0–6 correctly state the shifted week numbers. Phase 7 omits an explicit week number but describes "months 7–12" which is consistent with Weeks 26+. LOW risk — the omission makes cross-plan scheduling harder but does not block execution.

---

## 5. File Structure Conflicts

No two phase plans claim to create the same file with incompatible responsibilities. Key file ownership:

- `apps/atlas-app/state/store.ts` — Phase 2 creates the Zustand store; downstream phases add to it (Phase 5, Phase 6). Pattern is additive, not conflicting.
- `docker-compose.yml` — Phase 4 creates; Phase 5 adds `realtime` service via profiles guard; Phase 6 adds `stripe-cli`. Additive. No conflict.
- `packages/geo/types.ts` — Phase 1 creates; no downstream phase modifies it (they consume it). No conflict.
- `decisions/0007-yjs-e2ee-threat-model.md` — Phase 5 Task 0 creates it. Phase 6 Task E-01 resolution reads it. No conflict.
- `config.toml` — Phase 4 introduces; Phase 5 adds `[realtime]` section; Phase 6 adds `[billing]`, `[geocoding]`; Phase 7 adds `[field_collect]`, `[plugins]`, `[felt_importer]`. Additive. No conflict.

**Finding:** No file structure conflicts found.

---

## 6. Skill/Codebook Annotation Gaps

**Security-touching tasks that should carry `adversarial-api-testing`:**

| Phase | Task | Has annotation? | Assessment |
|-------|------|----------------|------------|
| 4 | Task 4 — Share Endpoint (`POST /maps/:id/share`) | YES — `adversarial-api-testing` explicitly annotated | OK |
| 5 | Task 8 — yjs-crypto.ts (AES-GCM key management) | Listed as `[BLOCKED/stub]`; no skill annotation for the stub implementation | LOW — stub only; wiring in Phase 6 should annotate adversarial |
| 6 | Task 19 — Stripe webhooks | Need to verify | OPEN — billing endpoints must carry `adversarial-api-testing` |
| 6 | Task 21 — a11y audit | Annotated `shadow-walk` per Wave 3 structure | OK |
| 7 | Task 8 — PluginRegistry + integrity hashing | Carries `test-driven-development`; integrity check is security-critical | LOW — plugin integrity is a security surface; `adversarial-api-testing` gate task missing |

**GAP-1:** Phase 6 Stripe webhook tasks (payment + subscription events) are not explicitly shown to carry `adversarial-api-testing`. Webhook signing verification is a known attack surface (replay, spoofed signature). Recommend adding `adversarial-api-testing` post-implementation gate to the Stripe webhook task.

**GAP-2:** Phase 7 `PluginRegistry.install()` + `PluginIntegrity.hash()` enforce bundle integrity but the plan annotates only `test-driven-development`. A post-implementation `adversarial-api-testing` gate task covering tampered-bundle injection, malicious manifest parsing, and `fetch:<host>` permission bypass would close this surface.

---

## 7. Artifact Manifest Gaps

Spot-checked Phase 1 (most detailed manifest found). The Phase 1 manifest lists 26 artifact paths with task assignments and consumed-by pointers. No tasks in Phase 1 were found that create a file without a manifest entry.

Phase 5 manifest was not as explicitly structured as Phase 1. The `persistence-bindstate.ts` file is noted as "out of scope" in File Structure — this is an intentional deferral, not a gap.

Phase 6 has a more narrative file structure (feature-by-feature sections). No manifest-level gaps were identified in the searched content, but Phase 6's breadth (10 features, 27 tasks) makes an exhaustive per-task manifest harder to cross-check manually.

**GAP-3:** Phase 6 does not have a machine-readable artifact manifest block (`PLAN_MANIFEST_START/END`) like Phase 1. This means automated tooling cannot verify completeness. Recommend adding a Phase 6 manifest block for the executing-plans toolchain.

---

## 8. STILL-OPEN Questions Blocking Downstream Phases

### Phase 5 Open Question — E-01 (Yjs E2EE)
- **Blocks:** Phase 5 Task 8 (wiring, not stub); Phase 6 relay persistence; Phase 7 DiffEngine (if Option B selected)
- **Flagged in Phase 5:** YES (Task 8 marked BLOCKED; E-01 in escalations.md)
- **Flagged in Phase 6:** YES (E-01 "What Phase 6 Must Own" section in escalations.md; Phase 6 inherits wiring obligation)
- **Flagged in Phase 7:** YES (E-02 in escalations.md gates Task 10 DiffEngine)

### Phase 6 Open Question — Felt API Rate Limits
- **Plan section:** Phase 6 plan OQ item 9 — "STILL OPEN — escalated at project level. Block Task 15 Step 2 (production hardening)."
- **Flags:** Flagged in Phase 6 only. Phase 7 does not reference this; it does not consume Felt-imported data.
- **Assessment:** Correctly scoped to Phase 6. No downstream blocker beyond Phase 6.

**NEW ESCALATION — see E-03 appended to escalations.md.**

---

## 9. PRD/Spec Coverage Audit

### Tech Spec Cross-sections

| Spec section | Coverage |
|---|---|
| §3 Coordinate sync | Phase 1 (CoordinateSync, GeoAnchor, projection), Phase 2 (data layers extend it). Covered. |
| §4 Modules (packages layout) | Phase 0 (workspace skeleton), Phase 1–2 (packages/geo, basemap, tools, data). Covered. |
| §5 Collab (Yjs + Socket.IO dual-protocol) | Phase 5. Covered including Q9 dual-socket design. |
| §6 File format | Phase 3. Covered. |
| §7 APIs (Storage, Share, SDK) | Phase 4 (storage + share), Phase 6 (SDK + embed). Covered. |
| §8 Performance budgets | Phase 1 (benchmark gate Q8), Phase 2 (regression +20%), Phase 4 (`size-limit`). Covered. |
| §9 Testing | Phase 1 (E2E browser matrix), Phase 2 (property tests), Phase 4 (smoke test), Phase 5 (E2E collab). Partially covered — see GAP-4. |
| §10 Config (`config.toml`) | Phase 4 introduces; all subsequent phases add sections. Covered. |
| §11 Risks (upstream divergence, perf, E2EE) | Phase 0 (Q6 upstream policy), Phase 5 (E-01 E2EE escalation), Phase 1 (Q8 perf gate). Covered. |
| Spec §10 basemap default (OpenFreeMap as "default") | **GAP-5:** Spec §10 still states OpenFreeMap as the default basemap. Q3 decided hybrid default (PMTiles bundled). Q3 explicitly notes "PRD/spec text describing OpenFreeMap as 'default basemap from OpenFreeMap public tiles' (spec §10) MUST be updated to reflect this hybrid." No phase plan includes a task to update `atlasdraw-tech-spec.md` §10. |

### PRD Coverage

**§7.1 MVP features (inferred from context — PRD §7.1 "MVP" scope):**
- Geo-anchored drawing tools: Phase 1 (PinTool), Phase 2 (7 tools). Covered.
- GeoJSON import/export: Phase 2 (drag-and-drop import), Phase 3 (read/write). Covered.
- PMTiles basemap: Phase 1 (BasemapRegistry), Phase 4 (bundled PMTiles). Covered.
- File format `.atlasdraw`: Phase 3. Covered.
- Docker self-host: Phase 4. Covered.
- Share link: Phase 4. Covered.

**§7.2 v1.0 features:**
- Real-time collaboration: Phase 5. Covered.
- Embed SDK: Phase 6. Covered.
- Comments: Phase 6. Covered.
- Style editor (Maputnik): Phase 6. Covered.
- Felt importer: Phase 6 (Q13). Covered.
- Hosted mode + billing: Phase 6. Covered.

**§7.3 v1.5 features:**
- Plugin API: Phase 7. Covered.
- Mobile field collection: Phase 7. Covered.
- Versioning/history: Phase 7. Covered.
- PostGIS connector: Phase 7. Covered.
- QGIS bridge: Phase 7. Covered.
- AI styling: Phase 7. Covered.

### Cross-cutting Concerns

| Concern | Coverage | Gap? |
|---------|----------|------|
| Telemetry / observability | Phase 0 strips upstream telemetry; Phase 6 writes ADR 0006; Phase 6 Task 27 adds CI guard. ADR policy covers OSS/hosted/embed. Covered — but no Sentry or OpenTelemetry for error tracking on hosted instance. | GAP-6 |
| Accessibility (a11y) | Phase 6 Wave 3 Tasks 21–23 cover a11y. Earlier phases have no a11y tasks. | GAP-7 |
| i18n / l10n | Not present in any phase plan. Excalidraw ships with an i18n system (`useI18n`); new Atlasdraw UI strings (layer panel, share dialog, plugin manager) add to that surface. No plan addresses whether geo-specific strings are added to the i18n catalog. | GAP-8 |
| License compliance CI | Phase 0: each `package.json` declares `"license"` field; CI fails if missing. Phase 7 Task 1: SPDX validation in plugin manifest. Covered. |
| Security boundaries | Phase 4 Task 4 (`adversarial-api-testing`). Phase 7 PluginRegistry. Mostly covered — GAP-1 and GAP-2 above. |
| Error handling / observability on hosted | No phase plan adds structured error logging, distributed tracing, or health endpoints beyond basic Docker healthchecks. | GAP-6 |
| Upstream merge CI | Phase 0: `upstream-patches.md` + CI check. Covered. |
| PRD §10 success metrics (anonymous heartbeat) | ADR 0006 defines the heartbeat protocol. Phase 6 wires the hosted-mode analytics events. The opt-in heartbeat endpoint `https://telemetry.atlasdraw.org` is mentioned in ADR but no phase plan has a task to actually stand up or test that endpoint. | GAP-9 |

---

## 10. Identified Gaps — Summary

| ID | Severity | Description | Blocking |
|----|----------|-------------|---------|
| GAP-1 | MED | Phase 6 Stripe webhook tasks lack `adversarial-api-testing` annotation | No — rework risk |
| GAP-2 | LOW | Phase 7 PluginRegistry install path lacks `adversarial-api-testing` gate | No — polish |
| GAP-3 | LOW | Phase 6 has no machine-readable artifact manifest block | No — tooling gap |
| GAP-4 | MED | No phase establishes a cross-browser visual regression suite for map+draw composition (only functional E2E). The Canvas composite (MapLibre + Excalidraw) is the highest-risk visual surface and has no pixel-level test coverage planned. | No — quality risk |
| GAP-5 | MED | `atlasdraw-tech-spec.md` §10 still describes OpenFreeMap as default basemap. Q3 resolved this as hybrid. No plan task updates the spec. | No — doc debt |
| GAP-6 | MED | No phase plans structured error logging, health endpoints, or distributed tracing for the hosted instance (`apps/storage`, `apps/realtime`). Shows HN demo at Phase 4 has no observability. | No — ops risk |
| GAP-7 | LOW | a11y coverage starts in Phase 6. Phases 1–5 introduce map overlay UI, layer panel, and collab cursors with no a11y checkpoints. | No — accumulates debt |
| GAP-8 | LOW | i18n coverage of new Atlasdraw UI strings not addressed in any plan. Excalidraw's i18n system exists but is not extended. | No — polish |
| GAP-9 | LOW | The opt-in anonymous heartbeat endpoint (`telemetry.atlasdraw.org`) is referenced in ADR 0006 but no phase plan provisions or tests it. | No — ops gap |

---

## 11. New Escalations

See `escalations.md` — E-03 appended.

---

## 12. Cross-Phase Mismatches — Consolidated

| ID | Severity | Phase N | Phase M | Finding |
|----|----------|---------|---------|---------|
| MISMATCH-1 | HIGH | 1 (produces) | 3 (consumes) | `GeoAnchor` shape: Phase 1 defines discriminated union `{kind, ..., zRef}`; Phase 3 consumes as flat `{lng, lat, zoom, projection: 'EPSG:4326'}`. These are incompatible types. |
| MISMATCH-2 | MED | 2 (produces) | 3 (consumes) | `LayerRegistry` source: Phase 2 produces it at `apps/atlas-app/state/store.ts` (Zustand slice); Phase 3 lists source as `packages/geo`. Wrong package attribution. |
| MISMATCH-3 | MED | 1 (produces) | 3 (consumes) | Field name: Phase 1 uses `element.customData.geo` (field `geo`); Phase 3 consumes `element.customData.geoAnchor` (field `geoAnchor`). One of these is wrong. |
| MISMATCH-4 | LOW | 4 (produces) | 5 (consumes) | Phase 5 describes docker-compose.yml as 5 static services; does not mention the `profiles: ["realtime"]` guard that Phase 4 added. Documentation imprecision, not structural conflict. |
| MISMATCH-5 | HIGH | 1 (produces) | 5 (consumes) | `GeoAnchor` shape: Phase 5 consumes as flat `{lng, lat, zoom, bearing}`; Phase 1 defines discriminated union. Same family of drift as MISMATCH-1; `bearing` field has no provenance in Phase 1 or Phase 2 type definitions. |
