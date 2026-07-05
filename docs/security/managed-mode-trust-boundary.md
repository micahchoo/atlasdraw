# Managed-mode trust boundary

**Status:** authoritative as of 2026-07-04.
**Applies to:** `apps/storage` and `apps/realtime` when `MANAGED_MODE=true`.
**Source:** `/tend` trust-boundary sweep (`SECURITY.md`, Issue 1).

## TL;DR

Atlasdraw is **self-host-first and single-tenant**. The default posture
(`MANAGED_MODE=false`) is the supported, tested one: one trusted operator, one
tenant, no cross-tenant boundary to enforce.

`MANAGED_MODE=true` turns on the *surface* of multi-tenancy — the
`X-Workspace-ID` header, `workspace_id` columns, per-workspace quotas, Stripe
billing — but **does not enforce cross-tenant isolation**. It is not
production-safe for hosting mutually-untrusting tenants and must not be exposed
to untrusted users in its current form.

This is a deliberate, documented boundary, not an oversight: per ADR-0010 the
relay is a trusted component, and the per-request ownership enforcement that
managed mode would need ("Wave 3 A13b") was scoped but never built.

## What managed mode does NOT enforce

Each item below is a live gap **only in `MANAGED_MODE=true`**; none affect the
default self-host build. Ledger rows refer to `SECURITY.md`.

1. **Map read/write is not workspace-scoped (row 1).** `GET /maps/:id` and
   `PUT /maps/:id` resolve a map by id alone — they never compare the map's
   stored `workspace_id` to the caller's `X-Workspace-ID`. Any caller with any
   accepted workspace header can read or overwrite any map by knowing its
   21-char id.

2. **Share-token minting is not ownership-checked (row 2).**
   `POST /maps/:id/share` mints a 7-day public read token for any existing map
   id, regardless of which workspace owns it. The resulting `/share/:token`
   link then serves the map and its blob unauthenticated.

3. **The realtime relay authenticates nothing (row 3).** `/yjs/:roomId` accepts
   any path as a document name; the Yjs data-layer and comment documents are
   **plaintext** (ADR-0010 Option C). Any client that knows a `roomId` can read
   and write another room's data layers and comments. Socket.IO scene/comment
   payloads remain end-to-end encrypted (opaque `{iv, ciphertext}` blobs), so
   their *content* stays confidential, but room membership and the plaintext
   Yjs docs are not protected. The "workspace ACL at the path-routing boundary"
   referenced in `yjs-server.ts` does not exist.

4. **Workspace enumeration is open (row 4).** `GET /api/workspaces` returns
   every workspace row (id + plan) with no authentication — Phase 6 shipped
   with no user-auth layer in front of it.

5. **Billing checkout is not caller-scoped (row 8).**
   `POST /api/billing/checkout` trusts the `workspaceId` in the request body and
   never checks it against the caller's `X-Workspace-ID`. Payment is still
   required, so the practical impact is limited, but a caller can drive a
   checkout that credits a different workspace.

6. **Webhook replay protection is in-memory (row 9).** Stripe webhook
   idempotency is tracked in a per-process `Map`, lost on restart and not shared
   across instances. Acceptable for single-instance v1; a replay landing during
   a restart window (or on another instance) can reprocess.

## What IS safe

- **Self-host default (`MANAGED_MODE=false`)** — single trusted tenant; none of
  the above apply. This is the supported deployment.
- **Stripe webhook signature verification** is present and correct
  (`constructEvent` on the raw body; 400 on missing/invalid signature).
- **Id validation** — every map id and share token is checked against
  `^[A-Za-z0-9_-]{21}$`; share tokens are unguessable 21-char nanoids with
  expiry and orphan handling.
- **Sentry** (opt-in) scrubs Authorization headers and request IPs before send.

## If you need real multi-tenant hosting

Turning managed mode into a production multi-tenant service requires building
the enforcement layer that was deferred:

- Thread workspace-ownership checks through `getMap` / `updateMap` /
  `createShareToken` and the `/yjs` upgrade handler (reject when the resource's
  `workspace_id` ≠ the caller's workspace).
- Scope `GET /api/workspaces` to the authenticated user.
- Add a real user-authentication layer in front of the `X-Workspace-ID` header
  (today the header is trusted verbatim — it is an assertion, not a credential).
- Move webhook idempotency to shared storage (Redis / DB).

Until that work lands, keep `MANAGED_MODE=false` for any internet-facing or
multi-user deployment.
