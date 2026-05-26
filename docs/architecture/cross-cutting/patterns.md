# Cross-Cutting Patterns

**Status:** Wave 4 synthesis — derived from Wave 1-3 code-verified documentation (domain, ecosystem, infrastructure, subsystems, and all 11 subsystem quadrants).

**Date:** 2026-05-15

**Previous version:** Speculative, pre-code patterns document (May 3). This revision replaces all prior content with code-verified findings.

---

## 1. Cross-Subsystem Patterns

### 1.1 Hub-and-Spoke Coupling (Structural Dominant)

The single most defining architectural pattern: **atlas-app is the sole consumer of all packages; packages have minimal mutual coupling.**

| Edge | Direction | Coupling | Evidence |
|------|-----------|----------|----------|
| tools -> geo | types only | Weak | `Coordinate` type import from `@atlasdraw/geo` |
| cli -> data | runtime | Moderate | `@atlasdraw/data` is a runtime dependency of `@atlasdraw/cli` |
| protocol -> realtime | types only | Weak | `@atlasdraw/protocol` is the only atlas package imported by realtime |
| storage -> (none) | none | Zero | Storage server imports zero `@atlasdraw/*` packages |
| basemap -> (none) | none | Zero | `@atlasdraw/basemap` has zero atlas-internal dependencies |

The system is better understood as **a set of independent modules consumed by a monolithic SPA** than as layered subsystems. This was the primary correction from the speculative subsystems document.

**Risk:** LOW. The hub is a 1538-line god module (MapEditor.tsx) that drains all cross-subsystem communication through event handler wiring. Splitting MapEditor would not change the coupling structure — it would just reorganize the hub internally. The risk is not architectural rigidity but **composition surface fragility**: one file touches every contract surface.

### 1.2 Fork Boundary (Disciplined)

The vendored Excalidraw (`packages/excalidraw`) is separated from atlas-owned code by three independent boundaries:

- **Variable declarations:** 16,805 `var` on vendored side, zero `var` in any atlas-owned package
- **State management:** Zustand (3 stores) in atlas-app, jotai only in vendored Excalidraw
- **Type safety:** ~21K `any` escapes in vendored, vs. systemic-but-bounded `any` in atlas-app (53 of 56 source files)

**Risk:** LOW. The boundary is clean and exhaustive. However, the boundary negotiation layer (glue code in MapEditor.tsx and hooks/) is where most `any` escapes in atlas-app originate, and these are systemic, not incidental — Excalidraw's loose type surface forces the escape. The three `any` roots are Excalidraw type boundary, Yjs observer patterns (untyped callbacks), and File System Access API (not yet standardized).

### 1.3 Dual Realtime Protocol

Two independent communication channels coexist in collaboration flows:

| Channel | Scope | Persistence | Conflict Resolution |
|---------|-------|-------------|---------------------|
| Socket.IO | Scene updates, camera, cursor, comments | Ephemeral (not stored on relay) | LWW per field |
| y-websocket (Yjs) | Data layer CRDT mutations | In-memory with TTL (5 min default) | CRDT merge |

Both share types from `@atlasdraw/protocol`. The relay never inspects payload content (ADR-0010). This pattern was listed in the prior subsystems doc as a fault line and remains so.

**Risk:** MEDIUM. The dual protocol was introduced incrementally (Socket.IO in Phase 5, Yjs sync in Phase 6) and the ordering between Socket.IO scene updates and Yjs data layer sync is undocumented. Concurrent edits to both scene and data layer could produce inconsistent client states. Phase 6 Wave 3 added more Yjs-backed features (comments), widening the fault line.

### 1.4 Configuration Fragmentation

Configuration is split across four independent systems with no shared schema:

1. **Build-time env injection** (`VITE_*`) — validated loosely via `import.meta.env` casts
2. **Storage config** (`config.ts`) — Zod-validated discriminated union, enforced at startup
3. **Realtime env** — no validation (plain `process.env` reads)
4. **Inherited Excalidraw envs** — legacy variables from upstream vendored code

**Risk:** LOW. The split follows deployment topology (frontend vs server vs upstream). The main issue is that there is no single source of truth for configuration keys across the monorepo — environment variable naming conventions differ (`VITE_STORAGE_BASE_URL` vs `STORAGE_BASE_URL` vs Docker compose env vars).

### 1.5 No Auth Model

Identity and authentication are absent from the architecture:

- **Storage server:** No bearer tokens, no user identity. The workspace middleware (global `preHandler`) reads `X-Workspace-ID` header, but does not authenticate the caller. Workspace scoping is a tenancy boundary, not an auth boundary.
- **Share tokens:** The only access control mechanism. Token minting is unauthenticated (anyone with the map ID can create a share token). Token expiration is hardcoded (30 days default).
- **Self-host mode:** No auth at all. `MANAGED_MODE=false` bypasses workspace and billing routes entirely.

**Risk:** MEDIUM-HIGH. By design for v1 (self-host assumed trusted network). However, adding authentication later requires deep architectural changes to the middleware chain, config validation, and adapter layer. The workspace middleware is structurally positioned to accept auth, but no auth provider exists.

### 1.6 No Observability Stack

Observability is present in skeleton form only:

- **Sentry** is initialized in storage when `SENTRY_DSN` is set, but no route handler or `setErrorHandler` routes errors to it. The SDK produces zero telemetry under normal operation.
- **Health checks** are partial. Storage serves `/health`. A `health.ts` exists in realtime's src directory but is not wired as a route.
- **Structured logging** uses pino on both storage and realtime, but there is no centralized log aggregation across services.
- **Distributed tracing** is absent — no OpenTelemetry, no Jaeger.

**Risk:** MEDIUM. Acceptable for single-developer self-host. Becomes a debugging bottleneck in multi-service hosted deployments.

---

## 2. Type System Fragmentation

The codebase has three independent type domains with no shared schema or automatic contract validation:

### 2.1 Domain Inventory

| Domain | Location | ID Format | Naming | Validated By | Purpose |
|--------|----------|-----------|--------|-------------|---------|
| **Storage** | `apps/storage/src/types.ts` | nanoid(21) | `snake_case` | Hand-rolled regex (`ID_RE`) | Envelope metadata |
| **Document** | `packages/data/src/manifest-schema.ts` | ULID (26 chars) | `camelCase` | Zod schema | Document payload |
| **Protocol** | `packages/protocol/src/` | N/A (event typenames) | `camelCase` | TypeScript | Wire format |

### 2.2 Field Naming Divergence

| Concept | Storage | Data/Manifest |
|---------|---------|---------------|
| Record ID field | `id` (nanoid(21)) | `manifest.id` (ULID) |
| Timestamp | `created_at` | `createdAt` |
| Visible name | (none — no title field) | `title` |
| Byte size | `byte_size` | (not tracked) |
| Owner | (none) | (none — neither layer) |

### 2.3 The Opaque-Blob Invariant

The storage server **never parses the blob content** it stores. `MapRecord` describes envelope metadata (where the blob is, how big it is, which workspace owns it). `AtlasdrawDocument` describes payload (what is inside the atlasdraw file). These are genuinely different concerns, and the parallel type hierarchies are correct by design.

**Risk:** LOW-MEDIUM. The parallel hierarchies are correct, but schema drift between storage snake_case fields and data package camelCase fields is possible without compile-time checking. If a future feature requires the storage server to inspect manifest content (e.g., search by title), this invariant breaks.

---

## 3. ID Scheme Conflicts

Two independent ID schemes coexist, with no shared generation utility:

| Scheme | Format | Length | Used By | Purpose |
|--------|--------|--------|---------|---------|
| nanoid(21) | `[A-Za-z0-9_-]{21}` | 21 chars | Storage (MapRecord.id, ShareToken.token) | Persistent record IDs |
| ULID | `[0-9A-HJKMNP-TV-Z]{26}` | 26 chars | Data/Manifest (Manifest.id) | Document IDs |
| Excalidraw element IDs | Opaque string | variable | Excalidraw elements | Scene element references |
| Yjs client IDs | Integer | numeric | Yjs peers | CRDT identity |

**Critical finding:** The storage server assigns a nanoid(21) to each map record (DB row). The blob itself contains a manifest with a completely different ULID. There is no contract ensuring they match or relate — the blob's manifest ID is opaque to the storage server. This is a byproduct of the opaque-blob invariant (Section 2.3).

**Risk:** LOW. Each ID scheme is appropriate for its domain. The mismatch between storage and manifest IDs is architecturally correct for v1. The real risk is if someone assumes they are interchangeable.

---

## 4. Lifecycle Management Gaps

### 4.1 Resource Inventory

| Resource | Subsystem | Managed? | Cleanup | Gap |
|----------|-----------|----------|---------|-----|
| Postgres connection pool | Storage | No | Relies on process death | `pool.end()` never called |
| SQLite database connection | Storage | No | Relies on process death | DB instance never closed |
| S3 buckets | Storage | Lazy | Created on first `putBlob` | No teardown |
| Realtime rooms | Realtime | TTL (5 min) | Last-client-disconnect + timer | `setPersistence` is TODO; rooms ephemeral |
| Share tokens | Storage | None | Table grows without bound | No GC job, no DELETE endpoint |
| Orphaned blobs | Storage | None | N/A | Write-before-insert pattern on createMap |
| IDB FSA handles | Atlas-app | Per-session | Persisted across sessions | RemoteMapId stickiness — cross-session identity leak |
| Excalidraw global transformer | Atlas-app | Manual | `setExportElementTransformer(null)` on unmount | Not scoped to instance |

### 4.2 Systemic Gaps

1. **No graceful shutdown.** Neither storage nor realtime registers SIGTERM/SIGINT handlers. Connection pools drain implicitly on process death.
2. **No resource reconciler.** Orphaned blobs, expired share tokens, and disconnected Yjs documents accumulate. Only Yjs has TTL-based eviction.
3. **No cross-subsystem lifecycle coordination.** Storage and realtime are independent processes with no shared lifecycle protocol. A map load in atlas-app requires two independent TCP connections (HTTP to storage, WebSocket to realtime), each with independent failure and retry semantics.

**Risk:** MEDIUM. Acceptable for v1 self-host. Becomes operational debt in managed/hosted mode where persistent storage grows without GC.

---

## 5. Error Handling Inconsistency

### 5.1 Per-Subsystem Patterns

| Subsystem | Pattern | Validation | Error Propagation |
|-----------|---------|------------|-------------------|
| Storage | Per-route try/catch + `isNotFoundError()` (string prefix check) | Zod only at startup; hand-rolled `ID_RE` regex in routes | Default Fastify 500 for uncaught |
| Atlas-app | Ad-hoc catch in persistence/import flows | TypeScript compile-time only | Unhandled promise rejections |
| Tools | `UnsupportedConvertElementError` class | TypeScript only | Thrown to caller |
| Data | Zod schemas for deserialization validation | Zod on read | Thrown errors |
| Protocol | No error handling (pure type defs) | TypeScript only | N/A (no runtime) |
| Realtime | Socket.IO error events, try/catch in room lifecycle | Minimal | Logged via pino; error events to client |
| CLI | Commander error handling | Commander arg validation | `process.exit(code)` |
| SDK | Promise rejection via PostMessage | TypeScript only | Rejected promises to host |

### 5.2 Systemic Issues

1. **No unified error type.** Each subsystem defines its own error taxonomy. Storage uses `isNotFoundError()` (string prefix check). Tools define `UnsupportedConvertElementError`. There is no `@atlasdraw/errors` or shared error base class.
2. **Sentry is initialized but not wired** (Section 1.6).
3. **No structured error response format.** Storage returns error strings directly as response bodies. Atlas-app errors are UI-only (toast notifications). No machine-readable error codes exist.

**Risk:** MEDIUM. Acceptable for a single-developer project. Becomes a debugging bottleneck in multi-service deployments where error provenance matters.

---

## 6. State Management Fragmentation

### 6.1 Patterns by Subsystem

| Pattern | Used By | Rationale |
|---------|---------|-----------|
| Zustand stores (3) | Atlas-app (layerRegistry, collab, persistence) | Central state for editor |
| Vanilla store + `useSyncExternalStore` | Atlas-app (comments-anchor-picker) | Avoids context provider dependency in MapEditor |
| Jotai atoms | Excalidraw (vendored) | Inherited upstream pattern |
| Yjs CRDT shared types | Atlas-app data layers | Multi-user consistency |
| Module-level variables | Realtime (YjsServer rooms map) | Simple server-side state |
| Map-based handler storage | SDK (subscription handlers) | Per-subscription lifecycle |
| Stateless (no module state) | CLI, geo, tools | Pure function design |

### 6.2 Observations

The fragmentation follows subsystem boundaries cleanly. No subsystem mixes patterns internally. The only notable divergence is the vanilla comments-anchor-picker store in atlas-app, which explicitly bypasses Zustand to avoid inserting a context provider into the component tree. This is a pragmatic choice, not an inconsistency.

**Risk:** LOW. Each pattern fits its subsystem's needs. The fragmentation is architectural, not accidental.

---

## 7. Knot Complement — Parallelism Opportunities

### 7.1 Current Serialization Points

| Serialization | Subsystems | Why Coupled |
|---------------|------------|-------------|
| Storage blob write -> DB record update | Storage | Transactional intent (blob must exist before record points to it) |
| IndexedDB save -> Remote storage save | Atlas-app + Storage | Dirty-bit guard prevents concurrent saves |
| Socket.IO connect -> Yjs connect | Atlas-app + Realtime | Scene state must arrive before data layer can render |
| Map load -> Data layer load | Atlas-app + Storage + Data | Serial by flow design |
| CLI commands | CLI | Single-process synchronous design |

### 7.2 Genuinely Parallel (Not Exploited)

- **Storage adapter operations:** SQLite queries and blob I/O could be parallelized within a single request (read blob while reading DB record). Current implementation serializes: DB lookup -> blob fetch -> response.
- **CLI render commands:** Must be spawned as separate processes for concurrency. The CLI has no internal parallelism.
- **Yjs document + Socket.IO room creation** on the realtime server could run in parallel rather than sequentially.

### 7.3 Structural Parallelism (By Design)

The hub-and-spoke architecture means that all packages can be developed, tested, and deployed independently from each other. The only deployment coupling is that atlas-app references them at build time (npm workspace + TypeScript project references). No runtime coordination is needed between packages.

**Risk:** LOW. Current serialization is correct for v1. Parallelism optimization is premature until profiling shows actual bottlenecks.

---

## 8. Cross-Frame Synthesis (Origami x Stratigraphy)

### 8.1 Era-Distance Weighted Crossings

Era distances (from atlas-app stratigraphy, estimated by phase introduction):

| Crossed Pairs | Era Distance | Surface | Assessment |
|---------------|-------------|---------|------------|
| Geo (Era 1) <-> Protocol (Era 5) | 4 | CoordinateSync state via CollabState | Largest origami fold. The CoordinateSync state machine was designed in Era 1 for local MapLibre-Excalidraw sync but its output now flows through Protocol types into the realtime relay. Structurally sound but undocumented — no single document describes how CoordinateSync state flows through the protocol layer. |
| Tools (Era 2) <-> Protocol (Era 5) | 3 | Tool-emitted events via CollabState | Minimal — tools emit seeds, protocol carries diff events. No fold. |
| Data (Era 3) <-> Protocol (Era 5) | 2 | YjsLayer CRDT over y-websocket | The fold is clean because Yjs handles serialization. Data layer states are transmitted via Yjs sync protocol, not custom wire format. |
| Basemap (Era 4) <-> Protocol (Era 5) | 1 | Style switching via CollabState | Weak coupling — basemap style is a property transmitted in manifest, not a realtime concern. |

**Predicted response growth after cuts:** If CoordinateSync were extracted from `@atlasdraw/geo` into its own package (e.g., `@atlasdraw/coordinate-sync`), the fold distance would collapse from 4 to 0, simplifying the contract surface. The fold exists because geo was the natural home for coordinate logic, and protocol was added later for realtime. Given current coupling, extraction is not justified — the fold is one file and one protocol event type.

### 8.2 Stream Capture Analysis

Stream captures identified across subsystems — endorheic basins that could be absorbed into larger flows:

| Stream | Currently In | Capture Candidate | Driver | Urgency |
|--------|-------------|-------------------|--------|---------|
| Style system | basemap (style-compiler + style-builder) | Separate `@atlasdraw/style` package | Maputnik integration | Low |
| Yjs layer wrapper | data (YjsLayer class) | Yrs/WASM backend | Performance | Medium |
| CoordinateSync | geo | atlas-app CollabState (partially captured) | Realtime protocol | Low |
| Storage types | storage (isolated by design) | OpenAPI/schema sharing | Multi-client | Low |

The style system and Yjs layer wrapper are truly endorheic — self-contained with no current cross-subsystem influence. The CoordinateSync is a **partial capture**: designed for local MapLibre-Excalidraw sync but later partially absorbed into the collab flow. Its state machine is still local (in `geo`), but its output flows through protocol and realtime.

### 8.3 Fault Lines Spanning Subsystems

| Fault Line | Spans | Type | Width Trend |
|------------|-------|------|-------------|
| Fork boundary (var/const) | Excalidraw vs all atlas-owned | Stylistic + type safety | **Stable** (no mixing) |
| State management (zustand/jotai) | Atlas-app vs Excalidraw | Library choice | **Stable** (follows fork boundary exactly) |
| Dual realtime protocol | Atlas-app + Protocol + Realtime | Protocol divergence | **Widening** (Phase 6 added Yjs-backed comments alongside Socket.IO corridor) |
| Tsconfig composite boundary | All packages (separate project refs) | Build system | **Stable** |
| ID scheme (nanoid vs ULID) | Storage vs Data | Architectural | **Stable** (by design) |
| DB schema (SQLite vs Postgres) | Storage adapters | Implementation divergence | **Stable** (same columns, different types) |

The dual realtime protocol fault line is the only one showing signs of widening. Each Phase 6 wave adds more surface area where both protocols must coexist without an explicit ordering contract.

---

## 9. Confidence Assessment

| Pattern | Confidence | Basis |
|---------|-----------|-------|
| Hub-and-spoke coupling | HIGH | Verified against import graphs of all 11 subsystems |
| Fork boundary | HIGH | Exhaustive grep of all packages (var/const/jotai/any) |
| Dual realtime protocol | HIGH | Flow traces verified against source |
| Type system fragmentation | HIGH | Direct comparison of types.ts vs manifest-schema.ts |
| ID scheme conflict | HIGH | Verified type definitions in both subsystems |
| Lifecycle management gaps | HIGH | All storage flows and atlas-app behavior traces verified |
| Error handling inconsistency | HIGH | Per-route error analysis of storage; atlas-app failure modes verified |
| State management fragmentation | HIGH | Inventory across all subsystems verified |
| Configuration fragmentation | MEDIUM | 3 of 4 config systems verified; Excalidraw legacy vars inferred |
| No auth model | HIGH | Storage routes, middleware, share token flow verified |
| Cross-frame synthesis | MEDIUM | Era distances estimated from git history; origami fold is analytical inference |
| Parallelism opportunities | MEDIUM | Serialization points identified from flow traces; actual profiling needed |
| No observability | HIGH | Sentry, health checks, logging verified against source |
| DB schema fragmentation | HIGH | Both adapter schemas compared directly |

---

## 10. Summary

### Highest-Risk Patterns (recommended for Phase 7+)

1. **No auth model** (Section 1.5) — Adding auth later requires deep architectural changes to storage middleware, config, and adapter layer. The workspace middleware is positioned for it but no provider exists. This is the highest-impact pattern to address before multi-tenant hosted mode.

2. **Lifecycle management gaps** (Section 4.2) — No graceful shutdown, no resource GC, no cross-subsystem lifecycle coordination. Acceptable for self-host v1, becomes operational debt in hosted mode.

3. **Dual realtime protocol fault line** (Section 8.3) — Widening with each Phase 6 wave. Socket.IO-to-Yjs ordering is undocumented and untested.

4. **No observability** (Section 1.6) — Sentry is scaffolded but not wired. Debugging production issues in multi-service deployment requires manual log spelunking across two pino instances.

### Patterns to Preserve (Correct by Design)

1. **Hub-and-spoke coupling** (Section 1.1) — Correct architecture for the problem domain. Packages are independently deployable. The risk is not the pattern but the 1538-line MapEditor.tsx and its single-file fragility.

2. **Fork boundary discipline** (Section 1.2) — Three independent boundaries all cleanly enforced. No mixing. This is the gold standard for vendored-dependency management in a monorepo.

3. **Storage type isolation** (Section 2.3) — The opaque-blob invariant is correct. Storage types describe envelope, not payload. Schema sharing (OpenAPI) could be added without breaking this invariant.
