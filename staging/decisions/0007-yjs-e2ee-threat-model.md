# ADR 0007: Yjs E2EE Threat Model

**Status:** Proposed (maintainer decision required)  
**Date:** 2026-05-03

## Context

Phase 5 implements realtime collaboration:
- **Scene/camera/cursors** — Encrypted with room key (in URL fragment)
- **Data layers** — Transmitted via Yjs + Socket.IO, currently unencrypted

Excalidraw E2EEs scene payloads at the app level. For feature parity, Yjs updates should also be E2EE'd.

Investigation in Phase 5 revealed a blocker: Yjs protocol expects `setupWSConnection` to call `syncProtocol.readSyncMessage` with raw bytes applied to a server-side `Y.Doc`. Encrypting the payload bytes corrupts the synchronization state.

## Decision

**Three options (maintainer to choose before Phase 5 Task 8):**

**Option A: Server-trusted relay only**
- No Yjs E2EE. Server relays unencrypted Yjs updates.
- Simplest. No protocol overhead. Server operator can read data in transit.
- Consequence: Data-layer events readable to relay operator.

**Option B: Y.Doc-bytes E2EE**
- Encrypt snapshot and update bytes before transmission.
- Relay forwards opaque blobs; server cannot decrypt or apply updates.
- Requires new protocol handler in Yjs (post-Phase 5 work).
- Consequence: Full E2EE but protocol complexity increases.

**Option C: Provisional server-trusted (Phase 5 ships this)**
- Phase 5 ships Option A (server-trusted relay).
- Stub `yjs-crypto.ts` module with `// TODO: E2EE design pending`.
- Phase 6 commits to Option A or B after threat model review.
- Consequence: Defers decision; Phase 5 unblocked; Phase 6 commits direction.

**Recommendation:** Ship Option C in Phase 5. Maintainer decision gate before Phase 6 Task 1.

## Consequences

### Positive (Option C)
- Phase 5 unblocks without E2EE architecture choice
- Gives time for threat model review
- Server-trusted relay is safe for Phase 1 (non-public demo)

### Negative / Risks
- **Delayed security** — E2EE deferred to Phase 6+
- **Architectural debt** — Swapping relay for encrypted protocol may require refactoring
- **User expectation** — Marketing may claim E2EE before it's actually implemented

**Mitigation:**
- Phase 5 documentation clearly states: "collaborative layers are server-trusted in v1"
- Phase 6 threat model review with cryptography expert
- Phase 6 commits to Option A or B; no further deferral

## References

- tech-spec.md §5.3 (collab architecture)
- escalations.md E-01 (Yjs E2EE blocker)
- Phase 5 plan Task 8 (realtime layer)
