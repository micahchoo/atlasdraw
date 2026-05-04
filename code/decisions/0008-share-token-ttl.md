# ADR 0008: Share Token TTL

**Status:** Accepted  
**Date:** 2026-05-03

## Context

Phase 4 introduces share-via-link (read-only, optionally password-protected). Embedded instances need a token model for temporary access control. Considered options:

1. **JWT with expiry claim** — Self-contained, no server lookup. Revocation requires key rotation.
2. **Opaque random + DB lookup** — Compact UX, instant revocation, per-token granularity.
3. **Signed URLs** — AWS-style; requires key management and URL length constraints.

## Decision

Adopt **opaque random tokens with 30-day TTL:**

- Token format: 32-byte URL-safe random (base64url encoding)
- Storage: Postgres `share_tokens` table
- Schema:
  ```sql
  (token_hash TEXT PRIMARY KEY,
   map_id UUID NOT NULL,
   role ENUM('viewer', 'commenter'),
   expires_at TIMESTAMP NOT NULL,
   revoked BOOLEAN DEFAULT FALSE,
   created_by UUID,
   created_at TIMESTAMP DEFAULT NOW())
  ```
- TTL: 30 days hardcoded (future ADR can introduce per-workspace policy)
- Revocation: UPDATE row `revoked = true` (instant)

On every share-token request, hash token and look up in table. Check `revoked` and `expires_at` before granting access.

## Consequences

### Positive
- Simple UX: share a link, revoke instantly
- No key rotation overhead
- Per-token granularity (can revoke one link, keep others active)
- Database-backed, suitable for self-hosted deployments

### Negative / Risks
- **Database lookup latency** — Every share access queries Postgres (< 5ms typical)
- **Hardcoded TTL** — Future per-workspace policy requires schema migration
- **Storage overhead** — One row per share (negligible at scale)

**Mitigation:**
- Add index on `(token_hash, expires_at)` for fast lookup
- Cache `share_tokens` in Redis (optional, Phase 4 Task 12)
- Document TTL in user UI: "This link expires in 30 days"

## References

- Phase 4 plan (share-via-link feature)
- phase-4-research-notes.md Q6 (token model analysis)
