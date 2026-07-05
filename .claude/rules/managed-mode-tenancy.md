---
scope:
  - code/apps/storage/**
  - code/apps/realtime/**
tags: [security, multi-tenancy, managed-mode]
priority: high
source: hand-written
---

# Managed mode is not multi-tenant-safe — keep it gated + honest

`MANAGED_MODE=true` turns on the *surface* of multi-tenancy (the
`X-Workspace-ID` header, `workspace_id` columns, per-workspace quotas, Stripe
billing) but **enforces no cross-tenant isolation**. This is a deliberate,
documented boundary — the self-host-only posture (single trusted tenant). Full
detail and the current gap list: `docs/security/managed-mode-trust-boundary.md`.

Confirmed unenforced today (do not describe any of these as "handled"):

- `GET/PUT /maps/:id` resolve by id alone — no `workspace_id` ownership check.
- `POST /maps/:id/share` mints a public token for any map id.
- `/yjs/:roomId` accepts any path with no auth; data-layer + comment Y.Docs are
  plaintext (only Socket.IO scene/comment payloads are E2EE).
- `GET /api/workspaces` returns every workspace row with no per-user auth.

## Rules

1. **Never describe deferred enforcement as if it exists.** A security comment
   states what the code *does*. If ownership/auth is absent, write "NOT
   enforced" — never "handled in Wave N" or "relies on the X boundary" when
   that boundary is unbuilt. (This sweep found four such comments; they read as
   false assurances.)

2. **`MANAGED_MODE` defaults off and must stay off by default.** The storage
   boot path warns loudly when it is on (`apps/storage/src/index.ts`). Keep that
   warning if you touch startup.

3. **Adding a managed-mode route?** Either enforce workspace ownership on the
   resource (compare its `workspace_id` to `request.workspace`) *or* add its gap
   to `docs/security/managed-mode-trust-boundary.md` in the same change. Do not
   ship a new managed-mode surface that silently trusts the header.

4. **Real multi-tenant hosting is a build, not a patch.** It requires threading
   ownership checks through the adapter `getMap`/`updateMap`/`createShareToken`
   contracts and the `/yjs` upgrade, plus a real auth layer in front of the
   header. Don't bolt a single-route check on in isolation.
