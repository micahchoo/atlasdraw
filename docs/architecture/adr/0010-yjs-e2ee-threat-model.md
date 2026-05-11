<!-- ADR-0010-MARKER: yjs-e2ee-threat-model -->

# ADR-0010: Yjs E2EE Threat Model — Server-Trusted Relay (Phase 5)

- **Status:** Accepted
- **Date:** 2026-05-11
- **Phase:** 5 (constraint-setting deliverable; Phase 5 Task 0 hard gate per plan)
- **Supersedes:** none
- **Superseded by:** none
- **Relates to:** ADR-0006 (telemetry policy), ADR-0008 (share-link encoding), E-01 + E-02 (`docs/decisions/escalations.md`)

## Context

Phase 5 introduces optional real-time collaboration. Two independent WebSocket channels run in the same relay process (per Q9 in `open-questions-resolution.md`):

1. **Socket.IO on `/socket.io`** — scene diffs (`SCENE_UPDATE`), comments (`COMMENT`), cursor + camera (`CURSOR`, `MAP_CAMERA_UPDATE`). Per spec §5.3, `SCENE_UPDATE` and `COMMENT` are encrypted via AES-GCM using a room key derived from the URL fragment. Cursor and camera are plaintext by design (low-value, high-frequency).
2. **`y-websocket` on `/yjs/:roomId`** — CRDT binary updates for data layers (Yjs `Y.Doc` per room).

During Phase 5 research (`docs/decisions/phase-5-research-notes.md` § OQ-1), open-questions-resolver identified a structural conflict between two original spec elements:

- **Task 6** uses `y-websocket`'s `setupWSConnection`, which holds an authoritative server-side `Y.Doc` per room and runs `syncProtocol.readSyncMessage(decoder, encoder, serverDoc, ...)`. The server reads inner Yjs update bytes to apply them to its `Y.Doc`, which is then used to serve SyncStep1/SyncStep2 catch-up to late-joining clients.
- **Task 8** specified AES-GCM encryption of Yjs binary updates with the same room key used for scene payloads, so a self-hoster could trust only their own clients with data-layer plaintext.

These are mutually exclusive: encrypting the inner payload before `setupWSConnection` reads it produces ciphertext that `Y.applyUpdate` corrupts; the server's `Y.Doc` diverges from real client state; late-joiner catch-up delivers garbage. This is documented as escalation **E-01** (see `docs/decisions/escalations.md`).

Three options were evaluated. Maintainer selected **Option C** on 2026-05-11. This ADR is the authoritative record of that decision and the resulting threat model.

## Decision

**Phase 5 ships Option C: server-trusted Yjs relay; `packages/data/src/yjs-crypto.ts` lands as stub only (API + tests, not wired into the y-websocket path); Phase 6 inherits a commitment to evaluate Option B (custom log-replay relay).**

Concretely:

- The relay process (`apps/realtime`) runs `setupWSConnection` from `y-websocket` (Phase 5 Task 6). It holds a `Y.Doc` per active room and serves SyncStep1/SyncStep2 to clients.
- `packages/data/src/yjs-crypto.ts` exports `encryptUpdate(update: Uint8Array, key: CryptoKey)` and `decryptUpdate(blob: Uint8Array, key: CryptoKey)`. The API is implemented and unit-tested. **It is not imported by `yjs-server.ts`, `CollabState`, or any client-side `YjsLayer` code in Phase 5.**
- Scene payloads and comments continue to be E2EE via Socket.IO (Task 10) — the data-layer relaxation does not regress the scene/comment posture.
- The threat model below applies; the self-host README + production.md must surface it in a "What the relay can see" disclosure paragraph before Phase 5 ships in a deployable form.

### Out of scope for Phase 5

- Custom log-replay relay (Option B from E-01) — Phase 6.
- End-to-end encryption of Yjs data-layer ops — Phase 6 evaluation; commit or formally close.
- Operator-pluggable key material outside the URL fragment scheme — future ADR.

## Threat Model

### Trust boundaries in Phase 5

```
┌─ Client (browser, user-trusted) ─────────────────────────────────┐
│  Excalidraw scene + comments: AES-GCM encrypted at the          │
│  application layer with room key K (from URL fragment)          │
│  Yjs data-layer ops: plaintext, sent over wss://                │
└──────────────────────────┬───────────────────────────────────────┘
                           │  wss:// (TLS in transit)
                           ▼
┌─ Relay process (apps/realtime, operator-trusted) ────────────────┐
│  Socket.IO channel:                                              │
│    - Reads CURSOR, MAP_CAMERA_UPDATE plaintext                   │
│    - Forwards SCENE_UPDATE, COMMENT ciphertext blindly           │
│    - Cannot decrypt SCENE_UPDATE or COMMENT                      │
│                                                                  │
│  y-websocket channel:                                            │
│    - Holds Y.Doc per room with plaintext geometry + properties   │
│    - Can read, modify, replay any data-layer op                  │
│    - Persistence stub: in-memory TTL eviction (Phase 5);         │
│      storage-backed setPersistence wires in Phase 6              │
└──────────────────────────┬───────────────────────────────────────┘
                           │  (in-memory; no disk in Phase 5)
                           ▼
┌─ Phase 6 storage (postgres + minio, operator-trusted) ───────────┐
│  Yjs state-as-update bytes persisted plaintext                   │
│  Snapshot/Diff (Phase 7) operates on plaintext bytes             │
└──────────────────────────────────────────────────────────────────┘
```

### What the Phase 5 relay can see

| Surface | Plaintext to relay? | Why |
|---|---|---|
| `CURSOR` (x/y/color/username) | Yes | Spec §5.3 — plaintext by design (low-value, high-frequency) |
| `MAP_CAMERA_UPDATE` (lng/lat/zoom/bearing) | Yes | Same — plaintext by design |
| `SCENE_UPDATE` (Excalidraw diffs) | **No** | AES-GCM ciphertext via Socket.IO; relay forwards blindly |
| `COMMENT` (body + author) | **No** | AES-GCM ciphertext via Socket.IO; relay forwards blindly |
| Yjs data-layer ops (FeatureCollection edits) | **Yes** | Plaintext to server `Y.Doc`; this ADR's central trade-off |
| Connection metadata (room id, peer count, timing) | Yes | Inherent to any relay; cannot be hidden |

### Attacker scenarios considered

**A1. Curious operator reads user data.** The operator running the relay reads geometry data (where users mapped trees, where they drew property boundaries). Mitigation: documented; users in privacy-sensitive scenarios must run their own relay or accept Phase 5's posture. Scene + comments remain E2EE.

**A2. Compromised relay host injects ops.** A relay attacker can inject Yjs updates that appear to come from any room participant, causing geometry corruption or false-history. Mitigation: client-side CRDT origin tracking is opaque to the relay, but the relay has equivalent power to a malicious peer; in Phase 5 this is accepted. Phase 6 Option B evaluation should include op-authentication as a sub-question.

**A3. Network observer between client and relay.** TLS terminates at the relay. Without TLS (`ws://` non-prod), data-layer ops are plaintext on the wire. Mitigation: production deployment must use `wss://`; the full-stack compose's Caddyfile (Phase 4 T11) enforces this with `tls {$ACME_EMAIL}`.

**A4. State exfiltration via Phase 6 persistence.** When `setPersistence` wires to `apps/storage`, plaintext Yjs state-as-update bytes will sit in Postgres / MinIO. Mitigation: documented as Phase 6 contract row; operator-encrypted volumes are the recommended response in the production.md hardening checklist.

**A5. Replay or rollback attack.** Relay replays an old `Y.Doc` state to a reconnecting client, effectively rewinding the document. Mitigation: Yjs is monotonic; client merges old state with current local state without loss. Not a Phase 5 risk.

### Out-of-scope threats (Phase 6 or later)

- Cross-tenant relay isolation in a hosted multi-tenant build (Phase 6 hosted flagship).
- Server-side abuse detection on the encrypted Socket.IO channel (Phase 6+; Stripe/auth-adjacent).
- Backup / disaster recovery key custody for Phase 6 persisted Yjs state.

## Consequences

### Immediate (Phase 5)

1. **`packages/data/src/yjs-crypto.ts` ships as stub.** Implementation and tests exist; no production caller imports it.
2. **`apps/realtime/src/yjs-server.ts` uses `setupWSConnection` as-is.** No custom upgrade handler. Persistence is in-memory with TTL eviction; storage wiring is a Phase 6 deliverable (see Phase 5 → Phase 6 contract row in plan §47).
3. **Self-host docs gain a "What the relay can see" disclosure paragraph.** README.md and production.md surface the data-layer trust boundary before any compose-up-able Phase 5 stack ships. Tracked as a Phase 5 doc-task amendment.
4. **`config.toml.example`'s `[realtime]` block ships with an explanatory comment:** "When enabled, the relay process can read your data-layer geometry. See ADR-0010 for the threat model." (Tracked as Phase 5 Task 2 amendment.)
5. **E-02 is unblocked.** Phase 7 SnapshotStore + DiffEngine (Tasks 9/10) proceed on the plaintext-Y.Doc assumption. No `decryptSnapshot` step; no key-management scope to define.

### Phase 6 obligations (inherited)

1. **Wire `setPersistence({bindState, writeState})`** from `@y/websocket-server/utils` to the storage API (`PUT/GET /api/maps/:id`). The in-memory TTL stub is the placeholder.
2. **Evaluate Option B relay rewrite** as a formal Phase 6 work item:
   - If selected: replace `setupWSConnection` with a custom log-replay handler that stores opaque update blobs; wire `yjs-crypto.ts` in client and storage layers; implement substitute SyncStep1/2 protocol; update convergence + stress E2E tests; **re-open E-02** to add `decryptSnapshot` step to Phase 7 DiffEngine contracts and define key-management scope.
   - If formally rejected: amend this ADR with an "Option C made permanent" decision block; close E-01 work item explicitly.
3. **Document the chosen path in this ADR's "Superseded by" or "Updated" field.** Phase 6 decision is permanent — Phase 7 plans inherit the resolution.

### Phase 7 implications

E-02 is closed under Option C — Phase 7 Tasks 9 (SnapshotStore) and 10 (DiffEngine) operate on plaintext bytes. If Phase 6 re-elects Option B, **re-open E-02** and amend Task 10 contracts before implementation.

## Gate

This ADR is **a Phase 5 Task 0 hard gate**. Phase 5 code may not ship without this ADR merged. Specifically:

- [x] ADR written and committed: this file, 2026-05-11.
- [ ] ADR reviewed before Phase 5 first dispatch.
- [ ] Self-host README + production.md updated with "What the relay can see" paragraph (tracked as plan amendment to Task 15-equivalent in Phase 5 docs).
- [ ] `config.toml.example`'s `[realtime]` block updated with ADR-0010 reference (tracked as Phase 5 Task 2 amendment).
- [ ] Phase 6 plan backlog row for Option B evaluation exists when Phase 6 plan is authored.

## Alternatives Considered

### Option A — Server-trusted relay, no `yjs-crypto.ts` stub

`yjs-crypto.ts` is deleted entirely (not shipped at all). Future Phase 6 reconsideration of E2EE starts from scratch.

**Why not:** the stub is cheap (an AES-GCM wrapper, ~50 lines + tests). Keeping it preserves Phase 6's option to wire it without writing it from scratch. The stub is also a useful in-code reminder that the encryption boundary was considered and intentionally not wired. Net cost of keeping it is near zero; option value is non-trivial.

### Option B — Custom log-replay relay (full data-layer E2EE)

Replace `setupWSConnection` with a custom WebSocket upgrade handler that stores opaque update blobs and serves them to late joiners without ever touching plaintext. Client-side `YjsLayer` applies updates locally to its own `Y.Doc`.

**Why not in Phase 5:** adds ~1 week of risky custom-protocol work to an already large phase. The substitute SyncStep1/2 protocol must handle the same edge cases `y-websocket` already solves (multi-update batching, awareness state, late-joiner replay). The implementation cost is justified by the security gain only when a sufficiently large self-host population demands it — Phase 5's goal is to *ship* the collaboration MVP, not to ship the maximally-private version. Phase 6 evaluates it with one Phase 5's worth of real-deployment learnings to draw on.

### "Skip Phase 5, go straight to Option B in Phase 6"

Defer all real-time collaboration to Phase 6.

**Why not:** Phase 5 collaboration is a load-bearing roadmap commitment (week 12-15 in spec). Slipping it to Phase 6 cascades into Phase 6's v1.0 release scope. The cost of shipping a server-trusted relay first and revisiting in Phase 6 is acceptable; the cost of slipping the MVP cycle is not.

## References

- `docs/decisions/escalations.md` — E-01 (resolved 2026-05-11) and E-02 (unblocked 2026-05-11).
- `docs/decisions/phase-5-research-notes.md` § OQ-1 — original conflict analysis.
- `docs/superpowers/plans/2026-05-03-atlasdraw-phase-5-realtime.md` — Phase 5 plan with Scope Limitation language (lines 12–13) and Phase 5 → Phase 6 contract (lines 47–56).
- ADR-0006 (telemetry policy) — zero call-home posture; the data-layer relay disclosure is the one place where the relay's visibility into user data must be explicitly surfaced rather than implicitly silent.
- ADR-0008 (share-link encoding) — the URL-fragment room-key convention reused by Phase 5 `parseRoomFragment`.
