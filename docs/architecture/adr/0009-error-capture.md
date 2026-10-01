<!-- ADR-0009-MARKER: error-capture -->

# ADR-0009: Error Capture Strategy for Hosted Instance

- **Status:** Accepted
- **Date:** 2026-05-11
- **Phase:** 4 (MVP self-host), T18
- **Supersedes:** none
- **Superseded by:** none
- **Related:** ADR-0006 (telemetry — establishes the default-zero policy this ADR carves an explicit opt-in into), ADR-0007 (storage dual-mode), ADR-0008 (share-link encoding)

## Context

ADR-0006 commits the default build to zero call-home, zero analytics, no required API keys. That policy is non-negotiable for the GH-Pages tier and the default self-host build.

But Phase 4 introduces a "Show HN" hosted demo (the project maintainers' own deployment on their own infrastructure) and a self-host tier where some operators may *want* error visibility — these are deployments where the operator, not the FOSS project, is the data controller. Without any error-capture layer, a hosted instance running into a 500 has no record beyond pino's stdout — usable only if you happen to have shell access at the moment of failure.

The choice is between:

1. **Sentry hosted SaaS.** Fast setup (`Sentry.init({ dsn })`), zero ops burden, mature stacktrace UI, free tier covers small instances. Sends payloads to a third-party data processor (Sentry GmbH / Functional Software). Operators in GDPR jurisdictions must document the processor in their privacy notice.
2. **Self-hosted Sentry / GlitchTip.** Zero third-party egress, but adds a service to run (Postgres, Redis, worker pool) and a UI to maintain. Same library on the client side.
3. **OpenTelemetry → Grafana Cloud / self-hosted Tempo.** More general (traces + metrics + logs), more ops work, much larger learning curve. Better answer for a multi-service deployment; over-spec for a single Fastify process.
4. **Pino-only, no error-capture layer.** Logs to stdout, operator pipes to wherever they want. Zero new code, zero new deps. Loss of crash visibility unless the operator ships logs somewhere.

## Decision

Atlasdraw ships a **Sentry-opt-in hook in `apps/storage`** wired in `index.ts`:

```ts
if (config.SENTRY_DSN) {
  Sentry.init({
    dsn: config.SENTRY_DSN,
    beforeSend(event) {
      if (event.request?.headers) {
        delete event.request.headers["authorization"];
        delete event.request.headers["Authorization"];
      }
      if (event.user?.ip_address) {
        delete event.user.ip_address;
      }
      return event;
    },
  });
}
```

Properties:

- **Default off.** `SENTRY_DSN` env unset → `Sentry.init` is never called → no third-party network call, no opt-out trap. Matches ADR-0006's default-zero posture.
- **Operator-controlled.** A hosted operator who wants error capture sets `SENTRY_DSN` in their compose env. No code change.
- **PII scrubbing built in.** `beforeSend` strips `Authorization` headers and request IPs before payload submission. This is the minimum scrub; operators with stricter privacy obligations should review Sentry's PII docs and extend the hook.
- **No client-side Sentry in `atlas-app`.** Only the server has the hook. The GH-Pages casual tier has no Sentry — operator-irrelevant, and shipping Sentry there would contradict ADR-0006.
- **`@sentry/node@^8`** declared as a regular dependency. The `init` no-op path adds ~250 KB to the storage server image — acceptable for an opt-in capability. Tree-shaking is not viable here because the init code path is the use case.

Phase 4–5 demos use Sentry hosted SaaS. Phase 6 re-evaluates against self-hosted Sentry / GlitchTip if a self-host operator files a GDPR-driven request to remove the SaaS path. The decision is reversible — swapping DSN to point at a self-hosted Sentry is one env-var change.

## Consequences

**Positive:**

- Immediate error visibility for the hosted Show HN demo. Stack traces, breadcrumbs, release versioning all surface without custom code.
- Zero impact on the default build's posture per ADR-0006. Operators who do not set `SENTRY_DSN` see no behavioral or network change.
- PII scrubbing happens at the source (server-side `beforeSend`), not at the Sentry UI. Reduces the data ever transmitted.

**Negative / accepted costs:**

- Operators who set `SENTRY_DSN` accept a data processor in their privacy notice. The project documents this requirement in the self-host README.
- Sentry's SDK bundle is non-trivial (~250 KB in the storage server image). This is amortized at runtime — startup overhead is negligible — but it shows up in the Docker layer.
- The `beforeSend` scrub is *manual* and *minimal*. Adding new request fields (custom headers, query params with secrets) without updating the scrub will leak them to Sentry. A test that asserts the scrub hook strips `Authorization` would catch the simplest regression; it is not yet written (gap, see Follow-ups).
- No client-side capture means atlas-app errors (failed `fetch`, render exceptions) are not auto-reported. Hosted operators who want this in Phase 6+ will add an `atlas-app` Sentry init separately.

## Follow-ups

- **Scrub-hook regression test.** Asserts a synthetic event with `Authorization` and `ip_address` has both stripped after `beforeSend`. ~10 lines. Deferred to a follow-up commit; not blocking T18 close.
- **Health probe extension.** `/health` is a liveness probe only. Readiness — adapter connection check — is a future option if compose orchestration grows to require it.
- **OpenTelemetry path for Phase 6+.** When a second service (realtime relay) lands, traces across the two services become more valuable than per-service error capture alone. Re-evaluate the OTel option at Phase 6 kickoff.
- **Self-hosted Sentry / GlitchTip migration trigger.** Phase 6 gate: if a self-host operator files a GDPR-blocking request, swap the hosted DSN out and document the path. No code changes anticipated beyond env reconfiguration.

## Alternatives Considered

1. **Self-hosted Sentry / GlitchTip in Phase 4** (rejected) — adds infrastructure burden (Postgres+Redis+workers+UI) for the FOSS project's own demo. Defers to Phase 6 when the operational complexity is amortized over more usage data.
2. **OpenTelemetry → Grafana Cloud** (rejected for Phase 4) — over-spec for a single Fastify process. Re-evaluate at Phase 6 if a second service joins the deployment.
3. **No error-capture layer (pino-only)** (rejected) — the Show HN demo needs *some* server-side error trail. Pino-only requires operators to wire log shipping themselves; this is a higher onboarding bar than `SENTRY_DSN=...`.
4. **On-by-default with a "telemetry" opt-out toggle** (rejected — contradicts ADR-0006) — opt-out defaults are widely understood as adversarial; the project's trust posture demands opt-in.
5. **Custom JSON-to-file error sink** (rejected) — reinvents pino's job. Pino already lands stack traces in stdout/stderr; a custom sink would be a worse pino.

## Verification

- `code/apps/storage/src/index.ts:21-35` — Sentry init gated by `config.SENTRY_DSN`.
- `code/apps/storage/src/config.ts` — `SENTRY_DSN: z.string().optional()` in `BaseSchema`.
- `code/apps/storage/src/logger.ts` — pino instance exported with `{ service: "@atlasdraw/storage" }` base. Consumed by Fastify's `logger` parameter; route handlers can `import { logger }` directly.
- `code/apps/storage/src/routes/health.ts` — `/health` returns `{status, uptime, storageMode}`.
- Smoke: `SENTRY_DSN= STORAGE_MODE=sqlite-fs DATA_DIR=/tmp/x node dist/index.js` starts with no Sentry init log (DSN absent = no-op).
