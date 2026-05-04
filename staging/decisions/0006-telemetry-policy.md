# ADR 0006: Telemetry Policy

**Status:** Accepted  
**Date:** 2026-05-03

## Context

PRD principle §5 states: "no telemetry that calls home." However, the hosted flagship instance benefits from opt-in usage measurement. Must define a clear, enforceable policy that respects self-hosted deployments while enabling product metrics.

## Decision

Adopt a **zero-telemetry default with opt-in for hosted deployments:**

1. **OSS app** — Sends ZERO telemetry by default. No exceptions.

2. **Hosted flagship** — Sends usage analytics only on explicitly opted-in events. Configuration via `[telemetry]` section in environment or admin UI.

3. **Optional heartbeat** — Deployments may opt into anonymous heartbeat that sends only:
   ```json
   {
     "instance_id": "uuid",
     "version": "1.0.0",
     "maps_created_this_week": 42
   }
   ```
   Heartbeat is opt-in at install time. Endpoint is configurable; defaults to off.

4. **Embed SDK** — NEVER sends telemetry, ever. Embedded instances have no observability access.

**Enforcement:**
- Every release is audited for unwanted call-home behavior
- CI guard (post-Phase 3) fails builds that import analytics libraries into OSS build
- Documentation: self-hosters can verify via network isolation of demo container

## Consequences

### Positive
- Self-hosters have full privacy guarantee
- Hosted instance can measure usage without breaking trust
- Simple, enforceable policy

### Negative / Risks
- **Limited product metrics** — Hosted instance cannot see per-user behavior, only aggregates
- **Opt-in bias** — Metrics skew toward engaged users who enable tracking
- **Enforcement burden** — Requires audit discipline

**Mitigation:**
- Telemetry section of tech-spec reviewed before each release
- Optional Sentry integration (ADR 0009) for error capture complements usage metrics
- Dashboard for self-hosters shows locally-computed stats without external calls

## References

- PRD §5 (telemetry principles)
- PRD §10 (heartbeat feature)
- decisions/0009-error-capture-observability.md
