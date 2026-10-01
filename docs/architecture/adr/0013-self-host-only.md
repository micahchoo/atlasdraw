<!-- ADR-0013-MARKER: self-host-only -->

# ADR-0013: Self-Host Only — Delete Managed Mode

- **Status:** Accepted
- **Date:** 2026-10-01
- **Supersedes:** ADR-0011 (hosted-mode telemetry)
- **Amends:** ADR-0007 (storage dual mode): the Postgres/S3 adapter stays; its managed-mode surface goes.
- **Relates to:** `docs/security/managed-mode-trust-boundary.md`, `.claude/rules/managed-mode-tenancy.md`

## Context

`MANAGED_MODE=true` adds workspaces, per-workspace quotas and Stripe billing to
`apps/storage`, and a workspace switcher and billing page to `apps/atlas-app`.
On 2026-07-04 the maintainer chose a self-host-only posture: document the
missing tenant isolation, do not build it.

The architecture audit of 2026-10-01 (storage and app-shell reports) found that
managed mode is not only unsafe, it does not work:

- The client expects a bare workspace array; the server sends `{workspaces: [...]}`.
- The client calls `/api/checkout-session`; the server route is `/api/billing/checkout`.
- The client sends plan `pro-plus`; the server rejects it.
- Caddy strips `/api`, so the Stripe webhook arrives at a path that returns 404.
- Autosave builds its storage client without `getWorkspaceId`, so every remote
  autosave in managed mode gets 401.
- The webhook marks an event processed before it handles it, so one failed
  write loses a paid upgrade.
- Creating a new free workspace bypasses the quota.

No managed-mode user flow completes today. About 35% of non-test storage source
is managed-mode code, and the billing plugin replaces the global JSON parser
even in self-host.

## Decision

Delete managed mode. Atlasdraw is a self-hosted product with one trusted tenant
per deployment.

Remove:

- **Storage:** the workspace and billing routes, the workspace middleware, the
  quota guard, the Stripe dependency and webhook, the `MANAGED_MODE` config, the
  ADR-0011 log events, and the `workspace_id` columns (by a forward migration).
- **Atlas-app:** `WorkspaceSwitcher`, `BillingPage`, the `/billing` route,
  `state/workspace.ts`, the `X-Workspace-ID` wiring in the storage client, and
  the workspace state in `MapEditor` and `App`.
- **Realtime:** workspace prefixes on room and doc names may stay; they cost
  nothing and carry no trust.
- **Docs:** the hosted-tier claims in `CHANGELOG.md`, `PRD.md` and the licence
  ADR (`code/decisions/0002-license-split.md`); then
  `docs/security/managed-mode-trust-boundary.md` and
  `.claude/rules/managed-mode-tenancy.md`, once no code matches their scope.

The deletion runs in phases of five files or fewer, server first, then the
adapter contract, then the client. Each phase keeps `yarn test:typecheck` and
`yarn test` green.

## Consequences

- No working user flow breaks, because none exists.
- About 930 lines of tests go with the code they test.
- Self-host security does not improve by this alone. The share-link write hole
  (`GET /share/:token` returns the map id; `PUT /maps/:id` needs only the id)
  is a self-host defect and is fixed separately, before this deletion.
- A future hosted tier is a new decision. It starts from tenant isolation and
  an auth layer designed first, not from this code. Git history keeps the old
  surface for reference.

## Alternatives considered

**Keep it behind one plugin that loads only when `MANAGED_MODE` is on, and fix
the four route mismatches and the webhook order.** Rejected: it keeps a surface
that is unsafe by design and that nobody runs, and every change to storage
must still reason about it.
