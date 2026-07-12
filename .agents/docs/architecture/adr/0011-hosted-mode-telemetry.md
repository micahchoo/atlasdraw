<!-- ADR-0011-MARKER: hosted-mode-telemetry -->

# ADR-0011: Hosted-Mode Telemetry — Opt-In Events for Managed Deployments

- **Status:** Accepted
- **Date:** 2026-05-15
- **Phase:** 6 (Wave 0 — gate for Wave 3 Stripe / hosted-mode work)
- **Supersedes:** none
- **Superseded by:** none
- **Extends:** ADR-0006 (telemetry policy — zero call-home) per its §Follow-ups deferral

## Context

ADR-0006 §Follow-ups stated: *"If a future v1.5+ phase introduces a hosted SaaS tier, the SaaS-only telemetry posture will be a separate ADR — but the FOSS / self-host build must remain at the policy above."*

Phase 6 (Q-P6-1 amended scope, 2026-05-15) introduces a managed-hosting tier — `apps/storage` and `apps/realtime` run with `MANAGED_MODE=true`, Stripe handles billing, and the operator (the Atlasdraw maintainer) needs minimum signal to run the service: how many workspaces exist, are signups working, are quotas being hit, are Stripe webhooks landing.

The original Phase 6 plan (Task 4) framed three tiers — OSS zero, hosted opt-in events, anonymous heartbeat — with an embed SDK clause as a fourth tier. The embed SDK is cut per Q-P6-1; this ADR addresses only the hosted-mode tier. The anonymous-heartbeat tier (a self-hoster pinging `telemetry.atlasdraw.org` with `{instance_id, version, maps_created_this_week}`) is also dropped — operator-side cost (a domain, an endpoint, a privacy policy) exceeds value when the project has no roadmap dependency on the data.

## Decision

The hosted-mode telemetry posture is **strictly additive to ADR-0006** — every clause in ADR-0006 still holds for `MANAGED_MODE=false` deployments and for the `apps/atlas-app` client bundle.

### 1. Default build is unchanged from ADR-0006

`MANAGED_MODE=false` (the self-host and GH-Pages default) → zero telemetry, identical to ADR-0006.

The `apps/atlas-app` client bundle has **no analytics code path at all** — not even gated behind a flag. A self-hoster auditing the bundle finds no `posthog`, `segment`, `mixpanel`, `amplitude`, `ga`, `gtag`, `plausible`, `umami`, or custom-beacon imports. (Verification: ADR-0006 §Verification grep continues to pass.)

### 2. Hosted-mode allows minimum operational signal — server-side only

When `MANAGED_MODE=true` is set on `apps/storage` and `apps/realtime`, the following operator-internal logs are written (not transmitted off-host unless the operator configures a log shipper):

| Event | Triggered by | Payload |
|---|---|---|
| `workspace_created` | Workspace creation route | `{workspaceId, plan, timestamp}` |
| `map_created` | `POST /maps` succeeds | `{workspaceId, mapId, sizeBytes, timestamp}` |
| `share_link_created` | `POST /share` succeeds | `{workspaceId, mapId, ttlDays, timestamp}` |
| `quota_breach` | Per-workspace quota guard rejects | `{workspaceId, quotaType, attemptedValue, limit, timestamp}` |
| `stripe_webhook_received` | `/stripe/webhook` route | `{eventType, customerId, timestamp}` |

These are emitted via the existing `pino` structured logger (Phase 4 T18 / ADR-0009). They live in the operator's log pipeline (stdout → docker logs → operator-chosen aggregator). They do not call out to any third party from the application.

**No client-side beacon.** The atlas-app browser bundle never emits these events. They are derived server-side from the existing route handlers.

### 3. PII boundary

Personally-identifying data permitted in logs (under operator control):

- `customerId` from Stripe — required for billing reconciliation; Stripe holds the email and payment data, not Atlasdraw.
- `workspaceId` — opaque server-issued identifier; not user-facing.

Personally-identifying data **never** permitted:

- Email addresses, names, or profile fields (Stripe is the system of record).
- IP addresses in application logs (the reverse proxy may log these per its own policy; the application code does not).
- Map contents, layer data, comment text, or any user-generated data payloads.
- Cursor positions, viewport coordinates, or any presence data.

### 4. Stripe webhook handler is not "telemetry"

Stripe → Atlasdraw webhook calls are server-to-server billing infrastructure, not user analytics. They are operator-configured, sit behind a webhook signing secret, and exist to keep the subscription state synchronized with the billing source-of-truth. ADR-0006's "no call-home" clause does not apply — these are inbound, not outbound, and originate from the operator's own Stripe account.

Atlasdraw never calls Stripe with user data not already known to Stripe through the customer's own checkout flow (`@stripe/stripe-js` redirect-checkout, not custom-form submission).

### 5. Opt-in and surfacing

Hosted-mode users see a one-line disclosure on workspace creation: *"This hosted Atlasdraw instance logs workspace events for service operation (per ADR-0011)."* with a link to this ADR. There is no opt-out — using the hosted instance implies acceptance of the operational logging; self-hosting is the alternative.

## Consequences

**Positive:**

- Operator can run the hosted tier with reasonable visibility (signups, quota breaches, billing events) without violating the FOSS-tier trust posture.
- The default-build audit story stays clean — `MANAGED_MODE=false` and the client bundle have no analytics code paths.
- Stripe holds billing PII; Atlasdraw does not duplicate it.

**Negative / accepted costs:**

- No client-side product analytics. The operator cannot answer "how do users use the StylePanel" or "which features get clicked." Roadmap signal continues to come from issue triage.
- No cross-instance heartbeat. The upstream project does not know how many self-host instances exist or which version is most-deployed.
- Quota-breach signal is the only proxy for "users are hitting limits"; if a quota is set too conservatively, the operator finds out via logs (not via dashboards). Acceptable for v1.0.

## Verification

- `git grep -ni 'posthog\|segment\|mixpanel\|amplitude\|ga(\|gtag(\|plausible\|umami\|fullstory\|hotjar\|fathom' code/apps/atlas-app/src/` returns zero hits (continuing ADR-0006 §Verification).
- All hosted-mode events emit via `pino` (Phase 4 T18) — no `fetch`, `XMLHttpRequest`, `sendBeacon` calls to external analytics endpoints in `apps/storage/src/` or `apps/realtime/src/`.
- `MANAGED_MODE` env gate: when `false`, hosted-mode event emit paths are dead code (TypeScript narrowing or `if (!config.managed) return;` guards).
- Stripe webhook signing-secret enforcement is unit-tested in Wave 3 A13c.

## Alternatives Considered

1. **No hosted tier; self-host only** (rejected — already decided in product strategy that the hosted flagship funds maintainer time).
2. **Full opt-in client-side analytics on the hosted tier** (rejected) — bundles analytics code into the client, breaks ADR-0006 §Verification (the grep would hit), increases bundle size, and gives users no meaningful "off" position when they're already paying for hosted service.
3. **Anonymous heartbeat for self-host instances** (rejected per §Context above) — operator-side cost exceeds project-side value.

## References

- ADR-0006 — Telemetry policy (zero call-home); this ADR extends its §Follow-ups deferral.
- ADR-0009 — Error capture (opt-in Sentry pathway); orthogonal to this ADR.
- Q-P6-1 — Phase 6 scope amendment dropping the embed SDK; this ADR's §1 reflects the bundle-audit consequence.
- `docs/superpowers/plans/2026-05-15-atlasdraw-phase-6-amended-scope.md` Wave 0 A1 — the dispatch row this ADR satisfies.
