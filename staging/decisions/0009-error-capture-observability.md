# ADR 0009: Error Capture and Observability Baseline

**Status:** Accepted  
**Date:** 2026-05-03

## Context

Cross-phase audit GAP-6: the hosted instance has no observability planned before Show HN. Operators would run blind: no logs, no error tracking, no health signals. A minimal baseline is required for production readiness.

## Decision

Establish baseline observability stack (Phase 4 Task 18):

1. **Structured logging** — `pino` JSON logger in `apps/storage` and `apps/realtime`. Log format:
   ```json
   {"level":"info","timestamp":"2026-05-03T...", "msg":"...", "context":{...}}
   ```

2. **Health endpoint** — GET `/health` on `apps/storage` returns:
   ```json
   {
     "status": "ok|degraded|error",
     "version": "1.0.0",
     "db": {"status":"ok", "latency_ms":2},
     "blob":{"status":"ok", "latency_ms":5}
   }
   ```

3. **Error capture** — Optional Sentry-equivalent (or self-hosted GlitchTip) integration:
   - Configure via `[observability] sentry_dsn = "..."` in config
   - OFF by default (per ADR 0006 telemetry policy)
   - Captures: unhandled exceptions, 5xx responses, slow database queries (>1s)

4. **No tracing in v1** — OpenTelemetry is deferred to v1.5. Span overhead conflicts with demo performance goals.

## Consequences

### Positive
- First-run docker-compose users see clean console output
- Operators can parse JSON logs via `docker compose logs --json`
- Health endpoint enables Kubernetes/systemd monitoring
- Optional external error tracking without forcing vendor lock-in

### Negative / Risks
- **No external service required** — Sentry DSN is optional; can't mandate external account
- **Log volume** — Verbose logging in debug mode may saturate storage (mitigated by log rotation)
- **Health endpoint latency** — Periodic DB/blob checks add ~10ms per request (acceptable for monitoring)

**Mitigation:**
- Configure log level via `LOG_LEVEL` env var (default: info)
- Health checks are cached for 5 seconds
- Self-hosters can verify no call-home behavior by network-isolating the container

## References

- cross-phase-audit.md GAP-6 (observability gap)
- Phase 4 plan Task 18 (observability implementation)
- decisions/0006-telemetry-policy.md (telemetry bounds)
