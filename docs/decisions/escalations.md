# Atlasdraw — Project-Level Escalations

**Purpose:** Decisions that surfaced during phase-plan research and require maintainer authority to resolve. These are structurally distinct from the pre-plan Q1–Q13 decisions (see `open-questions-resolution.md`) — they emerged from implementation research and carry phase-blocking implications.

Each entry records: the finding that forced escalation, the options with scope impact, the recommendation, and the gate condition before the blocked task can execute.

---

## E-01 — Yjs Encryption Boundary (Phase 5 / Phase 6)

**Date escalated:** 2026-05-03  
**Escalated by:** open-questions-resolver (Phase 5 research); shape-incorporator (structural triage)  
**Blocking:** Task 8 execution (Phase 5 plan — `packages/data/src/yjs-crypto.ts` wiring)  
**Research source:** `docs/decisions/phase-5-research-notes.md` § OQ-1  
**Plan section:** Phase 5 plan OQ-1 (see `docs/superpowers/plans/2026-05-03-atlasdraw-phase-5-realtime.md`)

---

### Finding

Phase 5 Task 6 specifies using `y-websocket`'s `setupWSConnection` to manage the Yjs relay (server holds an authoritative `Y.Doc` per room, handles SyncStep1/SyncStep2 catch-up for late joiners). Phase 5 Task 8 specified AES-GCM encryption of Yjs binary updates on the same room key used for scene payloads.

These two specifications are **mutually exclusive**:

- `setupWSConnection` calls `syncProtocol.readSyncMessage(decoder, encoder, serverDoc, ...)` which applies inner update bytes directly to the server `Y.Doc`.
- Encrypting the inner payload before sending means `Y.applyUpdate` receives ciphertext → server `Y.Doc` corrupts → late-joiner SyncStep2 catch-up delivers corrupted state.
- The original plan description "encrypt only inner payload, leave `messageType` plaintext" was verified to be unworkable with standard `setupWSConnection`.

This is a **structural conflict between Tasks 6 and 8**, not a bug in either task independently.

---

### Three Options

| Option | Description | Task 6 impact | Task 8 Phase 5 scope | Phase 6 implication |
|---|---|---|---|---|
| **(A) Server trusted, no layer E2EE** | Yjs updates flow plaintext to relay. Scene/comment remain E2EE via Socket.IO (Task 10). Awareness is always plaintext per spec §5.3. | No change — `setupWSConnection` as designed | `yjs-crypto.ts` removed from Phase 5; encryption handled by `scene-crypto.ts` (Task 10) only | Explicit threat-model documentation required |
| **(B) Custom log-replay relay** | Replace `setupWSConnection` with a custom upgrade handler that stores opaque update blobs (no server `Y.Doc`). Late joiners receive stored blobs; client applies updates to local `Y.Doc` without server touching plaintext. | Task 6 Step 1 fully rewritten — no `setupWSConnection`, custom catch-up protocol | `yjs-crypto.ts` implemented and wired as specified | Preserves data-layer E2EE; adds ~1 week implementation; requires own SyncStep1/2 substitute |
| **(C) Defer layer E2EE to Phase 6** | Phase 5 ships Option A. `yjs-crypto.ts` is created as a stub (API + tests, not wired into y-websocket path). ADR documents threat model. Phase 6 evaluates Option B as a tracked backlog item. | No change | Stub only — `encryptUpdate`/`decryptUpdate` API exists and is tested; not imported by `yjs-server.ts` or `CollabState` | Phase 6 work item: evaluate Option B; if selected, wire `yjs-crypto.ts` and replace `setupWSConnection` |

---

### Recommendation

**Option (C) — Phase 5 ships server-trusted; threat model documented; Phase 6 evaluates Option B.**

Rationale:
- Option (A) is architecturally sound for Phase 5 scope (matches Hocuspocus, y-sweet, and Liveblocks production practice — relay operators are trusted infrastructure).
- Option (B) is the correct long-term answer for self-hosted deployments where the maintainer does not want to trust the relay, but it adds a week of risky custom protocol work to Phase 5 that is already a large phase.
- Option (C) captures the stub API (so Phase 6 can wire it without a new file) and requires an honest ADR so no one is surprised that the relay can read layer ops in Phase 5.

The stub (`yjs-crypto.ts`) is safe under all three options — it is purely an API + tests with no live wiring. Task 8 can proceed as a stub regardless of which option the maintainer chooses.

---

### Gate Condition

Before **Task 8** is executed as anything more than a stub:

- [ ] Maintainer selects Option A, B, or C.
- [ ] If Option A: `decisions/0007-yjs-e2ee-threat-model.md` is written, reviewed, and merged.
- [ ] If Option B: Phase 5 plan is re-scoped to account for the Task 6 rewrite; schedule impact assessed.
- [ ] If Option C (recommended): `decisions/0007-yjs-e2ee-threat-model.md` is written; Phase 6 plan backlog receives an explicit E2EE evaluation task.

**Task 8 as stub (Option C) may proceed without this gate.** Only wiring the stub into the live y-websocket path requires the gate to be closed.

---

### What Phase 6 Must Own (if Option C selected)

Appended to Phase 5 → Phase 6 contract:

1. **Wire `setPersistence({bindState, writeState})`** from `@y/websocket-server/utils` to storage API `/api/maps/:id` (PUT/GET). In-memory TTL eviction in Phase 5 `yjs-server.ts` is the placeholder.
2. **Evaluate Option B relay rewrite** — decide whether to wire `yjs-crypto.ts` (in-scope Phase 6) or accept server-trusted relay as permanent (close with explicit decision in ADR `0007`).
3. If Option B is selected in Phase 6: replace `setupWSConnection` with custom log-replay handler; wire `yjs-crypto.ts`; update convergence + stress E2E tests.

---

*This escalation is complete when the maintainer gate conditions above are resolved and the gate is closed in this file with a decision date and signature.*

---

### Decision (2026-05-11) — RESOLVED

**Selected:** Option C — defer Yjs-layer E2EE to Phase 6 evaluation.

**Decided by:** maintainer (micahalex7), confirmed via AskUserQuestion in check-handoff resumption session.

**Implications confirmed:**

- Phase 5 plan ships unchanged — its existing Phase 5 Scope Limitation language (server-trusted relay, `yjs-crypto.ts` as stub, ADR `0007-yjs-e2ee-threat-model.md` as constraint-setting deliverable) is now load-bearing rather than provisional.
- `packages/data/src/yjs-crypto.ts` lands as stub only (API + tests, not wired into y-websocket path).
- `setupWSConnection` from `y-websocket` is the relay primitive for Phase 5. No custom log-replay handler.
- Threat-model ADR `0007-yjs-e2ee-threat-model.md` is now a Phase 5 Task 0 hard requirement (must merge before any Phase 5 code).
- Phase 6 inherits two work items: (1) wire `setPersistence` to storage API; (2) evaluate Option B relay rewrite (commit or formally close).
- **E-02 is unblocked** — Phase 7 Tasks 9/10 (SnapshotStore, DiffEngine) may proceed on the plaintext-Y.Doc assumption. See E-02 decision block below.

**Gate checkboxes (closed):**

- [x] Maintainer selects Option A, B, or C → **C**
- [x] If Option C (recommended): `decisions/0007-yjs-e2ee-threat-model.md` is written → **deferred to Phase 5 Task 0**; ADR is itself a Phase 5 hard-gate deliverable, not a precondition for selecting C.
- [x] Phase 6 plan backlog receives an explicit E2EE evaluation task → tracked via Phase 5 → Phase 6 contract row in plan (line 54).

**Seed closures:**
- `atlasdraw-4f26` (HELD: Maintainer decision on E-01) → `outcome:success` 2026-05-11.
- `atlasdraw-fef0` (HELD: E-02 gate) → closed in tandem; see E-02 decision block.

---

## E-02 — Phase 7 Snapshot/Diff Dependency on E-01 Resolution

**Date escalated:** 2026-05-03  
**Escalated by:** shape-incorporator (Phase 7 structural triage)  
**Blocking:** Phase 7 Task 9 (SnapshotStore) and Task 10 (DiffEngine) execution — conditional on E-01 outcome  
**Research source:** `docs/decisions/phase-7-research-notes.md` § W1C-1; `docs/decisions/escalations.md` § E-01  
**Plan section:** Phase 7 plan Phase Boundary Consumes (Yjs doc row); Tasks T9, T10

### Finding

Phase 7 versioning (Tasks 9 and 10) calls `Y.encodeStateAsUpdate(doc)` to produce snapshot bytes and `DiffEngine.diff(a, b)` to compare two snapshots. Both assume the Y.Doc contains plaintext CRDT state.

If E-01 resolves as **Option B** (custom log-replay relay with client-side encryption), the Y.Doc at rest will contain encrypted Yjs update blobs. `Y.encodeStateAsUpdate` on such a document produces ciphertext bytes. Snapshot storage of ciphertext is valid; however, `DiffEngine` operating on two ciphertext blobs cannot produce a meaningful structural diff without decryption. The current `DiffEngine` design assumes plaintext state.

This is not a blocker if E-01 resolves as Option A or Option C (server-trusted relay, plaintext Y.Doc) — which is the current recommended path.

### Gate Condition

- [ ] Before Phase 7 Task 10 (DiffEngine) is implemented: confirm E-01 resolution.
  - If Option A or C: no change to Task 10. Gate closed.
  - If Option B: DiffEngine must operate on decrypted snapshots. Task 10 contracts require a `decryptSnapshot(bytes, key): Uint8Array` step before diff, and key-management scope must be defined.

**Tasks 9 and 10 may proceed assuming Option A/C until E-01 is formally closed.** If E-01 resolves as Option B, re-open this gate before Task 10 execution.

*This escalation is informational until E-01 is closed.*

---

### Decision (2026-05-11) — RESOLVED

**E-01 closed as Option C (server-trusted relay, plaintext Y.Doc).** Phase 7 Tasks 9 (SnapshotStore) and 10 (DiffEngine) proceed under the plaintext-Y.Doc assumption — no `decryptSnapshot` step required, no key-management scope to define. Gate closed.

**Re-open trigger:** if Phase 6 evaluates Option B and selects it, this gate re-opens before Phase 7 Task 10 implementation and `DiffEngine` contracts must add a decryption step.

**Seed closure:** `atlasdraw-fef0` (HELD: E-02 gate) → `outcome:success` 2026-05-11.

---

## E-03 — GeoAnchor Type Shape Inconsistency (Phases 3 and 5 consumer contracts)

**Date escalated:** 2026-05-03  
**Escalated by:** cross-phase-auditor  
**Blocking:** Phase 3 plan execution (Task consuming `GeoAnchor` from Phase 2); Phase 5 plan execution (Task consuming `GeoAnchor` type)  
**Research source:** `docs/decisions/cross-phase-audit.md` § MISMATCH-1, MISMATCH-3, MISMATCH-5  
**Plan sections:** Phase 3 "Consumes from Phase 2" table; Phase 5 "Consumes from Phases 1–4" table

---

### Finding

Phase 1 defines `GeoAnchor` as a discriminated union in `packages/geo/types.ts`:

```ts
type GeoAnchor =
  | { kind: "point"; lng: number; lat: number; zRef: number }
  | { kind: "bbox"; west: number; south: number; east: number; north: number; zRef: number }
  | { kind: "polyline"; coordinates: Array<[number, number]>; zRef: number };
```

The field on `ExcalidrawElement` is `customData.geo` (not `customData.geoAnchor`).

Two downstream consumer plans describe a different shape:

- **Phase 3 "Consumes from Phase 2"**: lists `GeoAnchor` as `{ lng: number, lat: number, zoom: number, projection: 'EPSG:4326' }` (flat object, no `kind`, no `zRef`, wrong field name `customData.geoAnchor`).
- **Phase 5 "Consumes from Phases 1–4"**: lists `GeoAnchor` as `{lng, lat, zoom, bearing}` (flat object, introduces `bearing` field that has no provenance in Phase 1 or Phase 2 type definitions).

These are incompatible with the authoritative definition. If a Phase 3 or Phase 5 task is executed against the described consumer shape, the serialization code will produce an incorrect schema.

Additionally, Phase 3 attributes `LayerRegistry` to source `packages/geo` when Phase 2 produces it at `apps/atlas-app/state/store.ts` (Zustand slice); the type definition lives in `packages/data/layer-registry.ts`.

---

### Two Options

| Option | Description | Impact |
|---|---|---|
| **(A) Consumer plans are documentation drift** | The authoritative type is Phase 1's discriminated union. Phase 3 and Phase 5 consumer tables contain stale/draft text that was never reconciled. Execution agents must read `packages/geo/types.ts` as source of truth, not the consumer table shape. | Blocks task execution only if a worker reads the consumer table literally. Low implementation risk if workers cross-reference the producing phase. |
| **(B) Phase 1 type was changed post-plan** | The Phase 1 type was revised and the Phase 1 plan was not updated, but Phase 3/5 capture the revised shape. | Unlikely — Phase 1 manifest explicitly exports the discriminated union; tech spec §3.1 matches Phase 1. |

---

### Recommendation

**Option A is almost certainly correct.** The tech spec §3.1 and Phase 1 artifact manifest both define the discriminated union. Phase 3 and Phase 5 consumer tables contain documentation drift — likely written against an earlier flat prototype that was superseded by the spec §3.1 decision.

The `bearing` field in Phase 5's shape has no source; it should be dropped. The `zoom` field in Phase 3/5 maps to `zRef` in Phase 1 (the zoom level at creation time).

---

### Gate Condition

Before any Phase 3 task that serializes `GeoAnchor` to the `.atlasdraw` file format:

- [ ] Maintainer confirms the authoritative `GeoAnchor` shape is the Phase 1 discriminated union (as defined in tech spec §3.1 and `packages/geo/types.ts`).
- [ ] Phase 3 consumer table corrected to match (the plan itself must not be edited per audit instructions — this correction goes into the executing-plans agent's pre-work checklist or a companion ADR).
- [ ] Phase 5 consumer table corrected similarly; `bearing` field dropped or sourced.

**Phase 3 and Phase 5 tasks that do NOT touch GeoAnchor serialization may proceed without this gate.**

*This escalation requires a one-sentence maintainer confirmation before the affected serialization tasks execute.*
