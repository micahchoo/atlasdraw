# SECURITY.md — Issue 1 trust-boundary sweep

Loop: `sweep-triage-fix-resweep`. Scope: `code/apps/storage/src`,
`code/apps/realtime/src`, `infra/`. Secrets: full git history (`git log -p`).

Phase: **FIX (partial)** — sweep complete (a second pass adds no rows).
The managed-mode rows (1–4, 8, 9) are closed: managed mode is removed and
Atlasdraw is self-host only, one trusted tenant per deployment (ADR-0013,
`docs/architecture/adr/0013-self-host-only.md`). Rows **5, 6, 7** are
mode-independent: they harden a single-tenant self-host that faces the
internet.

Done when every finding at or above the agreed floor reads clean on re-audit
AND a fresh full sweep of both directories adds no rows.

Fix rule: one finding per commit, message references its row; re-audit each.

| # | finding | file | severity | user trust broken | fix commit | re-audit |
|---|---------|------|----------|-------------------|------------|----------|
| 1 | `GET /maps/:id` and `PUT /maps/:id` never compare the map's stored `workspace_id` to the caller's workspace — `client.getMap(id)`/`updateMap(id)` take only the id | `routes/maps.ts:47-85`; adapters `sqlite-fs.ts`/`postgres-minio.ts` `getMap` ignore workspace | **HIGH** | Cross-tenant read + overwrite: in managed mode any caller with any valid `X-Workspace-ID` reads or clobbers any map by knowing its 21-char id | removed with managed mode, ADR-0013 | no managed-mode code remains |
| 2 | `POST /maps/:id/share` mints a 7-day public read token for **any** map id with no ownership check (`getMap` presence check only) | `routes/share.ts:38-77` | **HIGH** | Cross-tenant exfiltration: a tenant mints a public share link for another tenant's map, then reads it (and its blob) unauthenticated via `/share/:token` | removed with managed mode, ADR-0013 | no managed-mode code remains |
| 3 | `/yjs/:roomId` upgrade takes the whole path suffix verbatim as docName, no auth; data-layer + comments Y.Docs are **plaintext** (ADR-0010 Option C). The header's claimed "workspace ACL at the path-routing boundary" does not exist — Caddy has no `/yjs` route and the relay parses the path raw | `realtime/yjs-server.ts:104-115`; `infra/caddy/Caddyfile` (no `/yjs` route) | **HIGH** | Any client knowing a `roomId` connects to `/yjs/${roomId}` and reads/writes another room's plaintext GeoJSON data layers + comment text — the compensating SaaS ACL was never built | removed with managed mode, ADR-0013. In self-host the room id is the capability: see ADR-0014 (`docs/architecture/adr/0014-collab-trust-model.md`) | no managed-mode code remains |
| 4 | `GET /api/workspaces` returns every workspace row with no auth ("Phase 6 v1 has no user auth so this returns every row") | `routes/workspaces.ts:27-33` | **MED** | Full tenant enumeration in managed mode: workspace ids + plan tiers of all customers exposed to any managed-mode caller | removed with managed mode, ADR-0013 | no managed-mode code remains |
| 5 | Socket.IO CORS `origin: "*"`, no auth on `JOIN_ROOM`; the `workspaceId` room-namespace is client-supplied and unvalidated | `realtime/index.ts:34`; `realtime/socket-io-server.ts:127-165` | **MED** | Room-slot exhaustion (DoS — `MAX_ROOM_SIZE` default 4) and ciphertext injection into any known room. Scene/comment payloads stay confidential (E2EE opaque blobs) so content isn't exposed — this is availability + integrity, not confidentiality | CORS now env-driven `CORS_ORIGIN` (`realtime/index.ts`); defaults to `*` for self-host but operators can pin to their domain now the relay sits behind Caddy (row 6). No-auth JOIN_ROOM is the accepted relay-trusted posture (ADR-0010); DoS bounded by `MAX_ROOM_SIZE` | realtime typecheck clean; origin resolves from env |
| 6 | Relay published directly on host `4001:4001`, bypassing the Caddy/TLS front door; Caddyfile has no `/socket.io` or `/yjs` route | `infra/docker-compose.yml:113-114`; `infra/caddy/Caddyfile:16-22` | **MED** | Realtime traffic (cursors, camera, encrypted scene envelopes, **plaintext** Yjs data layers) rides unencrypted in transit in the documented full stack | Caddy now proxies `/socket.io/*` + `/yjs/*` → `realtime:4001` (WS upgrade auto-proxied, TLS-terminated); compose changed `ports: 4001:4001` → `expose: 4001` so the relay is internal-only, reachable only through Caddy | `docker compose config` valid (base + realtime profile); `caddy validate` = Valid configuration |
| 7 | No per-IP / per-client rate limiting on any storage HTTP route — only a 50 MiB body cap; realtime throttles sockets but storage throttles nothing | `storage/index.ts:53-56` (no rate-limit plugin); contrast `realtime/rate-limit.ts` | **MED** | Abuse / brute-force of the internet-facing storage API: unbounded `POST /maps`, share-token guessing attempts, blob-storage fill | added `middleware/rate-limit.ts` — hand-rolled per-IP fixed-window limiter (mirrors realtime, no new dep), wired in `index.ts` with `trustProxy` so `request.ip` is the real client behind Caddy; `/health` exempt; `RATE_LIMIT_MAX`/`RATE_LIMIT_WINDOW_MS` config (0 disables). Incidentally cut storage typecheck errors 13→6 by asserting the Fastify instance type | 4 new unit tests (cap→429, `/health` exempt, per-IP scoping, disabled); 114 storage tests green |
| 8 | `POST /api/billing/checkout` trusts `workspaceId` from the request body and never checks it matches the caller's `X-Workspace-ID` | `routes/billing.ts:168-207` | LOW | A tenant can open a Stripe checkout that credits/upgrades a different `workspaceId` (payment still required, so impact is limited) | removed with managed mode, ADR-0013 | no managed-mode code remains |
| 9 | Stripe webhook idempotency + replay protection is in-memory only — lost on restart, not shared across instances (acknowledged in-code) | `routes/billing.ts:63-98` | LOW | A webhook replayed during the restart window (or against another instance) reprocesses; single-instance v1 accepts this per the module docstring | removed with managed mode, ADR-0013 | no managed-mode code remains |
| 10 | `GET /share/:token` returned the full map record, including its id, and `PUT /maps/:id` needs only the id — so a read-only share link gave write access. Self-host, not managed-only (audit 2026-10-01) | `routes/share.ts` (route removed) | **HIGH** | Anyone with a read link could overwrite the map every other recipient sees, and mint fresh 7-day links without limit | route deleted (no client called it); map responses no longer carry `blob_ref`; test: a token holder never sees the map id | `share.test.ts` "a share token holder…", `maps.test.ts` "never exposes where the blob is stored" |
| 11 | `trustProxy: true` unconditionally: with storage reachable directly (minimal stack publishes `:4000`), a client sets its own `X-Forwarded-For` and walks around the row-7 rate limiter | `storage/index.ts` | **MED** | Rate limiting bypassed by changing one header per request | `TRUST_PROXY` env, default off; full stack sets `"1"` (Caddy) | `config.test.ts` TRUST_PROXY cases |

## Non-findings (verified clean during the sweep)

- **Client-id validation** — `ID_RE` (`^[A-Za-z0-9_-]{21}$`) checked at every id/token entry point in `maps.ts`/`share.ts` and defensively again in both adapters. Share tokens are 21-char nanoids with expiry + orphan checks.
- **Git-history secret `4b07cca33ff2d2919bc95ff98f148e9e`** — upstream Excalidraw's public Firebase **web** `apiKey` (non-secret by design; enforcement is via Firebase security rules, not key secrecy). Already removed from the working tree in `2912fad`. Nothing to rotate. Other history hits (`tokentokentoken…`, `abcdefghij…`, `__PMTILES_PATH__`, `excalidraw-oai-api-key`) are test fixtures / placeholders.
- **Sentry `beforeSend`** scrubs Authorization headers and request IPs (`index.ts:36-45`).
- **Graceful shutdown** exists on storage (SIGTERM/SIGINT drain) — its *absence* on realtime is an operational finding tracked under ISSUES.md Issue 8, not a security row.

## Resolution of the managed-mode rows

Rows 1–4, 8 and 9 had one root: managed mode shipped tenant-isolation surface
(`workspace_id` columns, the `X-Workspace-ID` header, per-workspace quotas)
but no code path enforced ownership. The maintainer chose self-host only and
removed managed mode (ADR-0013). A future hosted tier is a new decision that
starts from tenant isolation and authentication.

## Running log

- Sweep phase: read all of `storage/src` routes + middleware + index + billing,
  all of `realtime/src`, `infra/caddy/Caddyfile`, `infra/docker-compose.yml`,
  and ran a `git log -p` secret scan across all history. 9 findings, 5 clean
  areas. Ledger complete; holding at the sweep→fix boundary for the triage call.
