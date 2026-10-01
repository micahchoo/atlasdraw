<!-- ADR-0006-MARKER: telemetry -->

# ADR-0006: Telemetry Policy — Zero Call-Home

- **Status:** Accepted
- **Date:** 2026-05-11
- **Phase:** 0 (backfilled during Phase 4 T17 — AboutDialog already references this ADR)
- **Supersedes:** none
- **Superseded by:** none

## Context

Atlasdraw is positioned as a self-hostable, FOSS-first geo-annotation tool (AGPL-3.0). The casual GH-Pages tier and the self-host tier both load and run in environments where the operator — not the upstream project — is responsible for what data leaves the user's machine.

A "Show HN moment" credibility test depends on being able to state a clear, simple, and accurate telemetry posture *up front*, in the app surface (AboutDialog), without weasel words. Users and self-hosters need to know what the app does and does not phone home, by default and at all.

Competing FOSS tools in this space (Excalidraw, draw.io, JOSM, QGIS, Felt) all take varying positions: some include opt-in analytics, some bundle Sentry, some are silent. The position taken here is one of the harder-to-deviate-from defaults: zero by default, opt-in only.

## Decision

Atlasdraw, in any official build (`atlas-app`, `storage`, `realtime`), performs **no outbound network communication** other than:

1. **User-initiated network operations.** Share-link resolution against a configured storage server, basemap tile fetches against a user-selected remote provider (gated by `[basemap.allow_remote]`; **default changed to `true` on 2026-06-13 — see "Update" below**), explicit "Open from URL" loads.
2. **Configured runtime services in self-host stacks.** Postgres, MinIO/S3, and Redis connections in the `postgres-minio` storage mode are operator-configured; they are not "telemetry" — they are the operator's own infrastructure.

Specifically, Atlasdraw will not:

- Send anonymous usage analytics, page views, click streams, or feature-use beacons.
- Send crash reports, stack traces, or any error payload to any third party by default. (Self-host operators may opt-in to Sentry per ADR-0009; the casual GH-Pages tier never has Sentry wired.)
- Send a "first-run" or "install" ping to any upstream service.
- Require an API key, account, or remote authentication to operate in either tier.
- Fetch update-check manifests from atlasdraw.org or any GitHub release feed at runtime.
- Embed any third-party iframe, pixel, font CDN call, or beacon in the default build.

The AboutDialog states this policy verbatim:

> **Telemetry.** No analytics. No call-home. No required API keys.

That summary, the AGPL-3.0 license badge, the build version, and the build git hash are the four trust signals surfaced in the AboutDialog.

## Update (2026-06-13)

The remote-basemap gate (`VITE_ALLOW_REMOTE_BASEMAPS` / `[basemap.allow_remote]`) **default was flipped from `false` to `true`** (user decision). Rationale: the Bright (OpenFreeMap) and OSM (openstreetmap.org raster) basemaps were silently not rendering out of the box, and the project wants them available by default.

**Privacy implication (accepted):** with the gate on by default, a default build now issues outbound tile requests to third-party hosts (`tiles.openfreemap.org`, `tile.openstreetmap.org`) as soon as a user selects one of those basemaps. Those hosts observe the user's IP and map viewport. This is still *user-initiated* (item 1 above) — no tiles are fetched until a remote basemap is selected, and the offline PMTiles basemaps (Light/Dark) remain the initial default — but it weakens the "no third-party fetches without explicit opt-in" stance for operators who relied on the prior default. Operators who need the original posture set `VITE_ALLOW_REMOTE_BASEMAPS=false`.

The AboutDialog "No call-home" claim is unaffected: it concerns telemetry/analytics/crash-reporting to the *project*, not user-selected tile providers.

## Consequences

**Positive:**

- Users can audit network behavior with `tcpdump`/devtools and find no surprises.
- Self-host operators do not need to add egress firewall rules to enforce the policy — it's the default.
- The policy is short enough to be memorable and verifiable — no fine print.

**Negative / accepted costs:**

- The project will have **no anonymous usage data** to drive feature prioritization. Roadmap decisions must come from issue triage, direct user feedback, and dogfooding.
- Crash visibility for project maintainers is zero by default. When bugs are reported, full reproduction context falls on the reporter. (ADR-0009 covers the opt-in Sentry path for self-hosters who want this; the upstream project does not aggregate.)
- The casual GH-Pages tier has no per-instance Sentry; bugs are silent there unless the user opens an issue.

**Follow-ups:**

- ADR-0009 covers self-host opt-in error capture (Sentry vs self-hosted).
- If a future v1.5+ phase introduces a hosted SaaS tier, the SaaS-only telemetry posture will be a separate ADR — but the FOSS / self-host build must remain at the policy above.

## Alternatives Considered

1. **Opt-out anonymous usage analytics** (rejected) — "opt-out" defaults are widely understood as adversarial. Even Plausible-style "no cookies, no PII" analytics phone home, and a user reading the source must trust the implementation; the cheaper trust signal is to not include the code path at all.

2. **Bundled, on-by-default Sentry** (rejected) — Sentry sends real-user errors to a third-party service. For a self-host-first FOSS tool, this is incompatible with the trust posture. Sentry is allowed as an opt-in (ADR-0009).

3. **Self-hosted analytics endpoint that operators can disable** (rejected for MVP) — adds a code path that must be audited and configured. Cheaper to omit entirely; operators who want analytics can layer Plausible/Umami on the egress side themselves.

## Verification

- AboutDialog renders the policy text verbatim (`atlas-app` T14 tests).
- `git grep -ni 'analytics\|google-analytics\|plausible\|posthog\|amplitude\|mixpanel\|segment\|fullstory\|hotjar\|sentry'` in `code/apps/atlas-app/src/` and `code/apps/storage/src/` returns zero hits in default-build code. Sentry references, if any, are gated behind an opt-in `OBSERVABILITY_DSN` env documented in ADR-0009.
