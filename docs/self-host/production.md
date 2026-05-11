# Atlasdraw — Production Self-Host Guide

This guide covers the **full stack** — Postgres + MinIO + Caddy TLS +
custom domain — recommended for any deployment that's not a personal
single-user instance.

For a quick personal install, see [`README.md`](README.md) (minimal
stack, sqlite + filesystem, no external services).

---

## What you get

Five Docker services on the compose network:

- **`web`** — atlas-app dist served by nginx, internal port `3000`.
- **`storage`** — Fastify API in `postgres-minio` mode, internal port `4000`.
- **`postgres`** — Postgres 16 for map metadata + share tokens.
- **`minio`** — MinIO for blob storage (S3-API-compatible, bucket
  `atlasdraw-maps`).
- **`caddy`** — TLS reverse proxy on host ports `80` and `443`. Provisions
  Let's Encrypt certs automatically.

Plus four named volumes:
- `pgdata` — Postgres data directory.
- `miniodata` — MinIO object storage.
- `caddy_data` — auto-renewed TLS certs (critical: must persist across
  restarts to avoid Let's Encrypt rate-limit hits).
- `caddy_config` — Caddy runtime state.

## Why two compose files?

Different deployment topologies need different tradeoffs (see
[ADR-0007 storage dual-mode](../architecture/adr/0007-storage-dual-mode.md)):

- **Minimal** (`docker-compose.minimal.yml`) — sqlite + filesystem, no
  external services, no reverse proxy. Single VPS, single user, simplest
  backup. ~3 GB disk, ~500 MB RAM.
- **Full** (`docker-compose.yml`) — Postgres + MinIO + Caddy. Multi-writer,
  S3-compatible blob layer, automatic TLS, suitable for any operator
  comfortable with Docker. ~5 GB disk, ~1.5 GB RAM (MinIO is capped at
  1g per [plan §5 line 914](../superpowers/plans/2026-05-03-atlasdraw-phase-4-mvp-self-host.md)).

Both stacks expose the same HTTP API; atlas-app code is agnostic to which
adapter is loaded.

## Prerequisites

- **Docker** with Compose v2 (Engine 24+).
- **A domain pointing to your host** (A record or AAAA record). Let's
  Encrypt cannot issue a cert for an IP-only host.
- **Ports 80 and 443 open** to the public internet. Port 80 is needed
  for the ACME HTTP-01 challenge.
- **~5 GB free disk** for images + initial volumes.

## Setup

```bash
git clone https://github.com/atlasdraw/atlasdraw.git
cd atlasdraw
cp infra/.env.example .env
$EDITOR .env
```

Edit `.env`. The mandatory fields are:

| Var | Purpose | Example |
|---|---|---|
| `PUBLIC_DOMAIN` | Hostname Caddy serves on | `atlas.example.com` |
| `ACME_EMAIL` | Let's Encrypt account email | `ops@example.com` |
| `POSTGRES_PASSWORD` | Postgres superuser password | (generate; 32+ chars) |
| `MINIO_ROOT_PASSWORD` | MinIO root credentials | (generate; 32+ chars) |

Optional:

- `LOG_LEVEL` — pino level for storage server (`info` default).
- `SENTRY_DSN` — opt-in error capture
  ([ADR-0009](../architecture/adr/0009-error-capture.md)). **Leave empty**
  to preserve the
  [zero-call-home posture](../architecture/adr/0006-telemetry.md).
  Operators who set this must document the third-party data processor in
  their privacy notice — see ADR-0009.
- `POSTGRES_USER`, `POSTGRES_DB`, `MINIO_ROOT_USER` — defaults are
  `atlasdraw`. Override if you need to match existing infra.

## Bring it up

```bash
docker compose --env-file .env -f infra/docker-compose.yml up -d --build
```

First build: ~5–10 min. Postgres and MinIO bootstrap their volumes on
first start; the storage server auto-creates the metadata tables and the
`atlasdraw-maps` bucket on its first write.

Watch logs:
```bash
docker compose --env-file .env -f infra/docker-compose.yml logs -f
```

Caddy will request a Let's Encrypt cert immediately. Expect a line like:
```
{"level":"info","msg":"certificate obtained","domains":["atlas.example.com"]}
```

If you see ACME challenge failures, check:
- DNS A/AAAA record points at the host?
- Port 80 reachable from the internet (not blocked by firewall / cloud
  provider security group)?
- `ACME_EMAIL` set to a valid mailbox?

Open <https://atlas.example.com> once the cert is issued.

## Local-testing override

For a non-public deployment (e.g., testing on a LAN), swap Caddy's `tls`
directive in `infra/caddy/Caddyfile`:

```caddyfile
{$PUBLIC_DOMAIN} {
    ...
    tls internal
    ...
}
```

`tls internal` uses Caddy's built-in CA. Visitors must trust Caddy's
root cert (Caddy installs it locally via `caddy trust`; container
deployments require manual cert distribution).

## Backups

The full stack has three persistence layers, each backed up independently.

### Postgres (metadata)

```bash
docker compose --env-file .env -f infra/docker-compose.yml exec postgres \
  pg_dump -U atlasdraw atlasdraw | gzip > backup-pg-$(date -I).sql.gz
```

Restore:
```bash
gunzip < backup-pg-2026-05-11.sql.gz | \
  docker compose --env-file .env -f infra/docker-compose.yml exec -T postgres \
    psql -U atlasdraw atlasdraw
```

### MinIO (blob storage)

Use `mc` (MinIO Client) or `aws s3 sync`. Easiest path:

```bash
# Install mc on the host
curl -O https://dl.min.io/client/mc/release/linux-amd64/mc && chmod +x mc

# Configure aliases (one-time)
./mc alias set local http://localhost:9000 atlasdraw $MINIO_ROOT_PASSWORD
./mc alias set offsite s3://your-offsite-bucket  ACCESS_KEY  SECRET_KEY

# Sync (incremental)
./mc mirror local/atlasdraw-maps offsite/atlasdraw-backups/$(date -I)/
```

Port 9000 isn't exposed externally in the default compose. To run `mc`
against it: either add a Caddy route, or temporarily expose 9000 via
`docker compose ... --port`, or `docker compose exec` into the minio
container.

### Caddy (TLS certs)

The `caddy_data` volume holds Let's Encrypt account keys + cached
certs. Losing it means re-issuance on next start — within Let's Encrypt
rate limits, this is fine; for high-availability, replicate the volume:

```bash
docker run --rm -v caddy_data:/data -v $(pwd):/backup alpine \
  tar czf /backup/caddy-data-$(date -I).tar.gz -C /data .
```

## Upgrading

```bash
cd atlasdraw
git pull
docker compose --env-file .env -f infra/docker-compose.yml up -d --build
```

Compose detects changed images and recreates the affected containers.
Volumes survive. Atlasdraw uses additive schema migrations only in
Phase 4 (no destructive changes), so a backup is recommended but not
strictly required.

For major version bumps (`v0.x → v1.x`), check the release notes for
explicit migration steps.

## Operating notes

- **Storage server health probe**: `https://atlas.example.com/api/health`.
  Returns `{"status":"ok","uptime":...,"storageMode":"postgres-minio"}`.
  Use this for load-balancer liveness checks or uptime monitors.
- **Caddy access logs**: emitted as structured JSON on stdout. Pipe to
  your log aggregator via the standard Docker logging drivers
  (`gelf`, `journald`, `awslogs`, etc.).
- **Share-link TTL**: 7 days, hardcoded in this release. ADR-0008
  documents the future `SHARE_TOKEN_TTL_DAYS` env knob.
- **Storage capacity planning**: average atlasdraw document is 30–500 KB
  compressed; basemap pmtiles (43 MB) is baked into the web image, not
  the volume. A 10 GB MinIO volume holds ~30–100k maps.

## Security hardening (recommended)

The default compose ships with passwords from `.env` and Caddy-managed
TLS. For production exposure, also consider:

- **Restrict MinIO console access.** The default compose doesn't expose
  port 9001 externally; keep it that way. Use `docker compose exec` for
  admin tasks.
- **Bind Postgres to localhost only.** Default compose already does
  this (no `ports:` declaration → only reachable on the compose
  network). Don't add a public port mapping.
- **Set `SENTRY_DSN` only to an instance you control.** Sentry's hosted
  service is a third-party data processor; ADR-0009 documents the
  scrubbing applied (`Authorization` headers, request IPs stripped).
- **Rotate `MINIO_ROOT_PASSWORD` and `POSTGRES_PASSWORD` periodically.**
  Currently a manual operation (compose env edit + `docker compose
  restart`).
- **Egress firewall.** The default build makes no outbound calls beyond
  ACME (Caddy) and the optional Sentry DSN. If you need to verify this,
  `tcpdump` outbound traffic — the only legitimate destinations are the
  ACME endpoints and the (optional) Sentry ingestion URL.

### Future: real-time relay trust boundary (Phase 5+)

Phase 5 will add an optional real-time collaboration relay (`apps/realtime`,
disabled by default). When you enable it via `[realtime] enabled = true`,
the relay process **can read your data-layer geometry** (Yjs CRDT ops) in
plaintext. Scene drawings and comments remain end-to-end encrypted via
Socket.IO — only the *map layer* geometry is visible to the relay.

This is a deliberate, bounded trade-off documented in
[ADR-0010](../architecture/adr/0010-yjs-e2ee-threat-model.md). If you do
not want the relay process to see your geometry data, either:

1. Don't enable real-time (single-player mode remains a first-class
   deployment target), or
2. Run your own relay — the trust boundary is "relay operator," which
   for self-hosters is you.

Full end-to-end encryption of data-layer ops (Option B in the ADR) is
deferred to Phase 6 evaluation. This disclosure will be expanded with
concrete operator-facing guidance when Phase 5 ships.

## Topology

```
                ┌────────────┐
   internet ──► │  caddy:443 │ ──► Caddy (TLS terminator, reverse proxy)
                └─────┬──────┘
                      │
                      ├──── /api/* ──► storage:4000 (Fastify)
                      │                    │
                      │                    ├─► postgres:5432
                      │                    └─► minio:9000
                      │
                      └──── /*     ──► web:3000     (nginx → atlas-app dist)
```

All inter-service traffic stays on the compose network. Only Caddy
binds to the host's 80/443.

## Next steps

- **[Telemetry policy (ADR-0006)](../architecture/adr/0006-telemetry.md)**
  — what the default build does and doesn't phone home.
- **[Storage dual-mode (ADR-0007)](../architecture/adr/0007-storage-dual-mode.md)**
  — design rationale for the two adapter shape.
- **[Share-link encoding (ADR-0008)](../architecture/adr/0008-share-link-encoding.md)**
  — the two share modes (URL-hash, server-token) and their security
  properties.
- **[Error capture (ADR-0009)](../architecture/adr/0009-error-capture.md)**
  — opt-in Sentry path and its PII scrubbing.

License: [AGPL-3.0-only](../../LICENSE).
