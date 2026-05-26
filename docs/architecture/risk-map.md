# Atlasdraw -- Risk Map

**Status: Code-verified.** Aggregated from Wave 1-3 diagnostics (2026-05-15).
Replaces the prior speculative edition (which predicted risks from plans; this
edition traces every claim to source code).

> Sources: `domain.md`, `ecosystem.md`, `infrastructure.md`, `subsystems.md`,
> `atlas-app/{behavior,components,contracts,modules}.md`,
> `storage/{behavior,components,contracts,modules}.md`.

---

## 1. Risk Inventory

### FATAL (blocks action)

| # | Risk | Severity | Dimension(s) | Affected Subsystems | Fix Complexity | Source |
|---|------|----------|-------------|--------------------|---------------|--------|
| F1 | **No E2E CI for map+canvas rendering** | Fatal | Readiness, Spatial | Editor SPA (atlas-app), Geospatial Engine, Map Renderer | Hard (infrastructure + test suite) | `infrastructure.md` SSITest Infrastructure |
| F2 | **MapEditor.tsx god module (1538 lines, 10+ responsibilities)** | Fatal | Spatial, Tangle Complexity | Editor SPA (atlas-app) | Hard (refactor wave before Phase 7) | `atlas-app/components.md` SS1 |
| F3 | **Storage quota race condition (count-then-insert not atomic across requests)** | Fatal | Flow Impact, Readiness | Storage Server | Medium (serializable isolation or advisory lock) | `storage/behavior.md` SS2.2 |
| F4 | **remoteSave stale-state gap (IDB succeeds, server fails, dirty=false)** | Fatal | Flow Impact, Temporal (contemporary) | Editor SPA (persistence), Storage Server | Medium (add remote-state indicator, retry queue) | `atlas-app/behavior.md` SS6.2 |
| F5 | **No DB migration framework (schema created inline on first start)** | Fatal | Readiness, Temporal (contemporary) | Storage Server | Medium (add Kysely, Prisma Migrate, or flyway) | `infrastructure.md` SSInfrastructure Risks |
| F6 | **Excalidraw fork divergence (no upstream git remote, manual merge only)** | Fatal | Temporal (fossil), Tangle Complexity | Vendored Excalidraw Kernel | Hard (add upstream remote, establish merge cadence) | `ecosystem.md` SSEcosystem Risks |

### WARNING (flag but proceed)

| # | Risk | Severity | Dimension(s) | Affected Subsystems | Fix Complexity | Source |
|---|------|----------|-------------|--------------------|---------------|--------|
| W1 | **21K `any` type escapes (vendored Excalidraw boundary)** | Warning | Spatial, Tangle Complexity | All 11 subsystems (concentrated in Vendored Kernel) | Hard (systemic, requires dedicated wave) | `infrastructure.md` SSEra Markers |
| W2 | **Orphaned blob risk (no transaction wrapping blob write + DB insert)** | Warning | Flow Impact, Temporal (contemporary) | Storage Server | Medium (wrap S3/fs + DB in saga pattern or 2PC) | `storage/behavior.md` SS1.2 |
| W3 | **Stripe idempotency in-memory only (lost on restart, no multi-replica)** | Warning | Constraint Ordering, Temporal (contemporary) | Storage Server | Medium (add Redis-backed store; Redis config path exists) | `storage/behavior.md` SS1.5 |
| W4 | **15+ dead Excalidraw env vars in `.env.*`** | Warning | Temporal (fossil), Readiness | Editor SPA (config) | Easy (prune .env files, confirm atlas-app ignores them) | `infrastructure.md` SSEnvironment |
| W5 | **Husky pre-commit disabled (lint-staged commented out)** | Warning | Readiness, Temporal (fossil) | Root (CI/Husky) | Easy (uncomment, verify lint-staged config) | `infrastructure.md` SSLocal CI |
| W6 | **Cross-session identity leak in IndexedDB (remoteMapId persists)** | Warning | Flow Impact, Temporal (contemporary) | Editor SPA (persistence) | Medium (namespace keys by workspace or document) | `atlas-app/behavior.md` SS3.3 |
| W7 | **Sentry vestigial (loads at boot, zero telemetry from any handler)** | Warning | Readiness, Temporal (contemporary) | Storage Server | Easy (wire `captureException` into Fastify error handler) | `storage/modules.md` SSSentry |
| W8 | **CollabWrapper.tsx dead code (exported, zero importers)** | Warning | Spatial, Temporal (contemporary) | Editor SPA | Easy (remove file and remaining references) | `atlas-app/modules.md` SSDeadwood |
| W9 | **workspaces.ts + billing.ts dead code in self-host (always 404)** | Warning | Spatial, Temporal (contemporary) | Storage Server (routes) | Easy (conditionally register routes) | `storage/modules.md` SSDeadwood |
| W10 | **Yarn Classic v1 EOL (no PnP, no Corepack, degrading compatibility)** | Warning | Temporal (fossil), Readiness | Root (toolchain) | Hard (migrate to Yarn 4 or pnpm) | `ecosystem.md` SSEcosystem Risks |
| W11 | **Storage Postgres pool never closed (no graceful shutdown handler)** | Warning | Flow Impact, Temporal (contemporary) | Storage Server | Easy (register `process.on('SIGTERM', () => pool.end())`) | `storage/behavior.md` SS3 |
| W12 | **No rate limiting on any endpoint** | Warning | Readiness, Temporal (contemporary) | Storage Server | Medium (add `@fastify/rate-limit`) | `storage/contracts.md` SS7.6 |
| W13 | **Realtime server single-instance by default (Redis adapter opt-in)** | Warning | Constraint Ordering, Temporal (contemporary) | Collaboration Relay | Medium (document multi-instance requirements) | `infrastructure.md` SSInfrastructure Risks |
| W14 | **Realtime rooms ephemeral (5 min TTL, setPersistence is TODO)** | Warning | Flow Impact, Temporal (contemporary) | Collaboration Relay | Medium (wire setPersistence in yjs-server.ts) | `infrastructure.md` SSInfrastructure Risks |
| W15 | **CoordinateSync scroll lock fragility (scroll=identity enforced on each onChange)** | Warning | Tangle Complexity, Flow Impact | Geospatial Engine, Editor SPA | Medium (add invariant enforcement layer) | `atlas-app/contracts.md` SS3.2 |
| W16 | **Two independent ID systems (nanoid storage rows vs ULID manifests)** | Warning | Tangle Complexity, Temporal | Storage Server, Data Interchange | Medium (document cross-reference contract) | `storage/contracts.md` SS3 |
| W17 | **MapLibre source/layer rollback not atomic on drop failure** | Warning | Flow Impact | Editor SPA, Map Renderer | Easy (improve try/catch rollback) | `atlas-app/contracts.md` SS3.5 |
| W18 | **YjsLayer + MapLibre source lifecycle race (source may not exist on setData)** | Warning | Flow Impact | Editor SPA, Collaboration Protocol | Medium (presence check before setData) | `atlas-app/contracts.md` SS3.6 |

### INFO (note only)

| # | Risk | Severity | Dimension(s) | Affected Subsystems | Fix Complexity | Source |
|---|------|----------|-------------|--------------------|---------------|--------|
| I1 | **AssetLibraryPanel incomplete (console.log in production, no apparent resolver)** | Info | Spatial, Temporal (contemporary) | Editor SPA | Low (remove debug logging) | `atlas-app/components.md` SS8 |
| I2 | **LayerPanel drag-reorder UNSAFE pointer handler (HACK comment)** | Info | Spatial, Temporal (contemporary) | Editor SPA | Low (implement proper DnD) | `atlas-app/components.md` SS5 |
| I3 | **Comments-anchor-picker vanilla store (second state pattern beyond Zustand)** | Info | Tangle Complexity | Editor SPA | Low (document or migrate to Zustand) | `atlas-app/components.md` SS8 |
| I4 | **ID_RE regex duplicated 4x across maps.ts, share.ts, both adapters** | Info | Readiness | Storage Server | Easy (extract shared utility) | `storage/components.md` SSWeaknesses |
| I5 | **isNotFoundError helper duplicated in maps.ts and share.ts** | Info | Readiness | Storage Server | Easy (extract to shared module) | `storage/components.md` SSWeaknesses |
| I6 | **`ignoreDeprecations: "6.0"` in storage tsconfig** | Info | Temporal (fossil) | Storage Server | Easy (verify and remove) | `storage/components.md` SSQuality |
| I7 | **No lazy-loading (all 21 components statically bundled)** | Info | Readiness | Editor SPA | Medium (React.lazy for dialogs) | `atlas-app/modules.md` SSRisks |
| I8 | **Workspace table created unconditionally in self-host** | Info | Spatial | Storage Server | Easy (gate on MANAGED_MODE) | `storage/components.md` SSDead Code |
| I9 | **Storage types manually mirrored in atlas-app (no shared types package)** | Info | Tangle Complexity, Readiness | Storage Server, Editor SPA | Medium (publish types-only sub-package) | `storage/modules.md` SType Duplication |
| I10 | **Expired share tokens never cleaned (permanent table growth)** | Info | Flow Impact | Storage Server | Low (periodic cleanup or maintenance note) | `storage/behavior.md` SS3 |

---

## 2. Prioritization

### Tier 1: Maximum impact, minimum prerequisites (this week)

| # | Action | Unlocks | Effort |
|---|--------|---------|--------|
| 1 | **W5: Re-enable Husky pre-commit** | Catches regressions before they land | Minutes |
| 2 | **W4: Prune 15+ dead Excalidraw env vars** | Removes config noise, prevents accidental data egress | Minutes |
| 3 | **W8: Remove CollabWrapper.tsx** | Eliminates confusing dead module | Minutes |
| 4 | **W7: Wire Sentry into Fastify error handler** | Enables operational observability | Minutes |
| 5 | **W11: Register pool.end() on SIGTERM** | Plugs resource leak | Minutes |
| 6 | **I4/I5: Deduplicate ID_RE and isNotFoundError** | Reduces maintenance burden | Minutes |
| 7 | **F4: Add remoteSave failure indicator** | Closes known data-integrity gap | Hours |

### Tier 2: Medium effort, high pay-off (next sprint)

| # | Action | Unlocks | Effort |
|---|--------|---------|--------|
| 8 | **F5: Add DB migration framework** | Enables safe schema evolution | Days |
| 9 | **F3: Make quota check atomic** | Enables safe concurrent multi-tenant POSTs | Days |
| 10 | **W3: Move Stripe idempotency to Redis** | Enables multi-replica billing | Days |
| 11 | **W6: Namespace IndexedDB keys** | Prevents cross-session identity confusion | Days |
| 12 | **W12: Add rate limiting** | Basic DoS protection | Hours |

### Tier 3: Structural changes (next quarter)

| # | Action | Unlocks | Effort |
|---|--------|---------|--------|
| 13 | **F1: Add E2E CI (Playwright, map+canvas critical path)** | Enables safe refactoring of rendering stack | Weeks |
| 14 | **F2: Decompose MapEditor.tsx** | Enables Phase 7 without breaking core | Weeks |
| 15 | **F6: Establish Excalidraw upstream sync cadence** | Reduces merge cost drift | Weeks |
| 16 | **W1: Systemic `any` reduction wave** | Enables type-safe refactoring across boundaries | Months |

---

## 3. Risk Clusters

### Cluster A: Data Integrity

Risks that compound: if you trust any one, you might trust the wrong thing.

```
F4 (remoteSave stale gap)
  +-- User sees "saved" but server blob is stale
       +-- W2 (orphaned blobs) means blob may also be missing
            +-- W3 (Stripe idempotency in-memory) means billing events
                can double-process on restart
```

**Surface:** 3 flow basins (Save/Load, Collaboration, Billing).  
**Break-glass:** F4 + W2 fix first; W3 only when Stripe is active.

### Cluster B: Architecture Inertia

Risks that compound: each makes the others harder to fix.

```
F2 (MapEditor god module)
  +-- Any refactor hits lines across 10+ responsibilities
       +-- W1 (21K any escapes) means TypeScript won't catch broken contracts
            +-- F1 (no E2E CI) means no safety net after refactor
```

**Surface:** 1 subsystem (Editor SPA) but all 5 flow basins.  
**Break-glass:** F1 (E2E CI) is the gating fix -- without it, MapEditor decomposition is blind surgery.

### Cluster C: Fork Rot

Risks that compound: delay increases cost monotonically.

```
F6 (Excalidraw fork, no git remote)
  +-- W10 (Yarn Classic v1 EOL) blocks installing newer Excalidraw deps
       +-- W1 (21K any escapes) obscures where the fork patched what
```

**Surface:** Vendored Kernel (30+ inherited deps).  
**Break-glass:** W10 (Yarn upgrade) unblocks tooling; then F6 (upstream remote) enables the merge.

### Cluster D: Operational Blindness

Risks that compound: each creates a gap only the next outage reveals.

```
W7 (Sentry vestigial -- zero telemetry)
  +-- F5 (no DB migration framework) means manual DDL
       +-- Migration error is invisible because no monitoring
            +-- F1 (no E2E CI) means pre-deploy validation is manual
```

**Surface:** Storage Server + CI.  
**Break-glass:** W7 (Sentry wiring) cheapest; F5 (migration framework) prevents the category.

---

## 4. Mitigation Difficulty vs Impact Matrix

```
                    HIGH IMPACT
                        |
          F1 (E2E CI)   |   W5 (Husky), W4 (env prune)
          F2 (MapEditor)|   W8 (CollabWrapper), W11 (pool.end)
          F6 (fork)     |   W7 (Sentry), F4 (remoteSave)
          W10 (Yarn)    |   W12 (rate limit)
          ------------- | -----------------------------
          HARD          |   EASY
          ------------- | -----------------------------
          W1 (21K any)  |   W6 (IDB identity leak)
          F3 (quota)    |   W3 (Stripe Redis)
          W13 (realtime)|   F5 (migration framework)
          W14 (rooms)   |   W17 (layer rollback)
                        |   W2 (blob transactions)
                        |   I4/I5 (dedup)
                    LOW IMPACT
```

**Top-right quadrant (high impact, easy fix) -- do these first:**
W5, W4, W8, W11, W7, F4, I4/I5.

**Top-left quadrant (high impact, hard fix) -- plan structural work:**
F1 (E2E CI), F2 (MapEditor), F6 (fork), W10 (Yarn).

**Bottom-right quadrant (low impact, easy fix) -- do when convenient:**
I6 (ignoreDeprecations), I10 (token cleanup docs).

**Bottom-left quadrant (low impact, hard fix) -- defer or live with:**
W1 (full `any` cleanup months of work), W13/W14 (acceptable for v1

---

## 5. Risk Distribution Summary

### By Subsystem

| Subsystem | Fatal | Warning | Info | Total |
|-----------|-------|---------|------|-------|
| Editor SPA (atlas-app) | 2 (F2, F4) | 6 (W1, W6, W8, W15, W17, W18) | 4 (I1, I2, I3, I7) | 14 |
| Storage Server | 2 (F3, F5) | 5 (W2, W3, W7, W9, W11, W12) | 5 (I4, I5, I6, I8, I10) | 14 |
| Vendored Excalidraw Kernel | 1 (F6) | 1 (W1) | 0 | 2 |
| Geospatial Engine | 0 | 1 (W15) | 0 | 1 |
| Map Renderer (basemap) | 0 | 1 (W17) | 0 | 1 |
| Collaboration Relay | 0 | 2 (W13, W14) | 0 | 2 |
| Data Interchange | 0 | 1 (W16) | 0 | 1 |
| Root (CI/toolchain) | 0 | 2 (W5, W10) | 0 | 2 |

### By Dimension

| Dimension | Count | Examples |
|-----------|-------|---------|
| **Spatial** (where located) | 8 | MapEditor, storage, fork boundary |
| **Temporal: fossil** (inherited) | 5 | Excalidraw fork, Yarn Classic, dead env vars, Husky disabled, `var` declarations |
| **Temporal: contemporary** (shipped this cycle) | 21 | remoteSave gap, quota race, blob tx, Stripe idempotency |
| **Temporal: emerging** (Phase 7+) | 0 | (covered by Phase 7 planning) |
| **Flow Impact** | 10 | remoteSave, blob tx, quota race, realtime ephemeral |
| **Tangle Complexity** | 6 | MapEditor, any escapes, CoordinateSync, ID systems |
| **Readiness** (test/interface coverage) | 10 | No E2E, no migration, Sentry, Husky, rate limiting, dedup |
| **Constraint Ordering** | 2 | Stripe idempotency, realtime single-instance |

---

## 6. Acceptable & Partially-Mitigated Risks

### Acceptable (documented trade-offs)

- **W1 (21K `any` escapes)** -- accepted cost of Excalidraw fork. Systemic reduction is a v2.0 goal.
- **W10 (Yarn Classic EOL)** -- acceptable while `--frozen-lockfile` works in CI.
- **W13 (realtime single-instance default)** -- Redis path exists; document when to enable.
- **W14 (ephemeral rooms)** -- acceptable for v1; persistence is Phase 7 scope.

### Partially Mitigated

| Risk | Existing mitigation | Gap |
|------|-------------------|-----|
| W3 Stripe idempotency | In-memory Set with 30-day TTL | Lost on restart; multi-replica unsafe |
| W4 dead env vars | `VITE_BUILD_TARGET=hosted` build arg | `excalidraw-app` may still read them |
| W7 Sentry | `Sentry.init()` runs, DSN respected, auth-header scrubbed | No `captureException` wiring |
| W6 IDB identity leak | Single key overwrite prevents unbounded growth | No namespace isolation between documents |
