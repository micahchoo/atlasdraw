# Atlasdraw — Production Self-Host Guide

This guide covers the **full stack** — Postgres + MinIO + Caddy TLS +
custom domain — recommended for any deployment that's not a personal
single-user instance.

For a quick personal install, see [`README.md`](README.md) (minimal
stack, sqlite + filesystem, no external services).

---

## What you get

Five Docker services on the compose network, and one setup job:

- **`web`** — atlas-app dist served by nginx (unprivileged), internal port
  `3000`.
- **`storage`** — Fastify API in `postgres-minio` mode, internal port `4000`.
  Runs as the unprivileged `node` user on Node 22.
- **`postgres`** — Postgres 16 for map metadata + share tokens.
- **`minio`** — MinIO for blob storage (S3-API-compatible, bucket
  `BLOB_BUCKET`, default `atlasdraw-maps`).
- **`minio-init`** — runs at each `up` and exits: makes the bucket and the
  app user `MINIO_APP_USER`, whose policy reaches only that bucket. The
  storage server uses the app user, never MinIO's root user.
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
  comfortable with Docker. ~5 GB disk, ~1.5 GB RAM (the compose file caps
  MinIO at 1 GB).

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

| Var                   | Purpose                         | Example               |
| --------------------- | ------------------------------- | --------------------- |
| `PUBLIC_DOMAIN`       | Hostname Caddy serves on        | `atlas.example.com`   |
| `ACME_EMAIL`          | Let's Encrypt account email     | `ops@example.com`     |
| `POSTGRES_PASSWORD`   | Postgres superuser password     | (generate; 32+ chars) |
| `MINIO_ROOT_PASSWORD` | MinIO root credentials          | (generate; 32+ chars) |
| `MINIO_APP_PASSWORD`  | The storage server's MinIO user | (generate; 32+ chars) |

Optional:

- `LOG_LEVEL` — pino level for storage server (`info` default).
- `SENTRY_DSN` — opt-in error capture
  ([ADR-0009](../architecture/adr/0009-error-capture.md)). **Leave empty**
  to preserve the
  [zero-call-home posture](../architecture/adr/0006-telemetry.md).
  Operators who set this must document the third-party data processor in
  their privacy notice — see ADR-0009.
- `POSTGRES_USER`, `POSTGRES_DB`, `MINIO_ROOT_USER` — defaults are
  `atlasdraw`. `MINIO_APP_USER` defaults to `atlasdraw-app`. Override if you
  need to match existing infra.
- `BLOB_BUCKET`, `BLOB_REGION` — the bucket and its region (defaults
  `atlasdraw-maps`, `us-east-1`). See "Blob storage" below.
- The storage limits in "Storage limits" below.
- `VITE_REALTIME_ENABLED`, `VITE_REALTIME_WS_URL` — live rooms; see
  "Realtime relay" below.
- The relay limits (`MAX_ROOMS` and the others in "Realtime relay").

The compose file passes each of these from `.env` to its service, with the
server's default when `.env` does not set it. `EMBED_FRAME_ANCESTORS`
(default `*`, any site may embed your maps) goes to `web`, which sends it on
`/embed` pages only. `VITE_CSP_CONNECT_SRC` (space-separated origins) lets the
page reach tile servers besides the built-in basemaps; the page's content
security policy refuses every other host.

## Bring it up

```bash
docker compose --env-file .env -f infra/docker-compose.yml up -d --build
```

First build: ~5–10 min. Postgres and MinIO bootstrap their volumes on
first start. `minio-init` makes the bucket and the app user. The storage
server waits for both, then applies its schema migrations when it starts,
before it answers a request.

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

MinIO's port 9000 is not published, so run `mc` inside the `minio`
container (its image includes `mc`), then copy the result out:

```bash
docker compose --env-file .env -f infra/docker-compose.yml exec minio sh -c \
  'mc alias set local http://localhost:9000 "$MINIO_ROOT_USER" "$MINIO_ROOT_PASSWORD" &&
   mc mirror --overwrite local/atlasdraw-maps /tmp/maps-backup'
docker compose --env-file .env -f infra/docker-compose.yml \
  cp minio:/tmp/maps-backup ./maps-backup-$(date -I)
```

Use your `BLOB_BUCKET` if you changed it. Back up Postgres and the bucket
together: a row names its blob, and a blob that no row names is removed by
the sweep after an hour.

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
Volumes survive. The storage server applies schema migrations when it
starts. Some migrations remove columns (for example, the managed-mode
workspace columns), so back up the volumes before you upgrade.

Maps stored before write keys (migration `003_write_keys_and_lasting_links`)
get no key. Nobody can write them. Each owner's browser makes a new map with
a key at its next save, so no owner action is necessary (ADR-0017). The
server keeps the old maps for `LEGACY_MAP_GRACE_DAYS` (default 90) after the
upgrade; then the sweep deletes each one that no live share link reads.

The images now run as unprivileged users. A volume that an older image made
is owned by root, so give it to the new user once, before you start:

```bash
docker compose --env-file .env -f infra/docker-compose.yml run --rm \
  --user root --entrypoint chown realtime -R node:node /data   # if you run the relay
```

The full stack's storage server keeps nothing on a volume; the minimal
stack's does (see [`README.md`](README.md), "Upgrade").

For major version bumps (`v0.x → v1.x`), check the release notes for
explicit migration steps.

## Operating notes

- **Storage server health probe**: `https://atlas.example.com/api/health`.
  Returns `{"status":"ok","uptime":...,"storageMode":"postgres-minio"}`.
  Use this for load-balancer liveness checks or uptime monitors.
- **Access logs**: Caddy writes structured JSON on stdout. Pipe it to
  your log aggregator via the standard Docker logging drivers
  (`gelf`, `journald`, `awslogs`, etc.). A share token is a read
  capability, so Caddy, nginx and the storage server write `[redacted]` in
  its place (in `/m/…`, `/embed/…`, `/api/share/…` and the `Referer`).
- **Share links last until the owner stops them.** The Share dialog can
  give a link a 7- or 30-day expiry instead. A link always shows the
  map's latest saved version, so a save updates every link and every
  embed made from it. Links made before this release keep their 7-day
  expiry.
- **Write keys.** Each map has a write key that only the owner's browser
  holds (ADR-0017). Without it, nobody can change the map, and a share
  link never gives it. There is no key recovery: if a browser loses its
  storage, its next save makes a new map.
- **Storage capacity.** An average atlasdraw document is 30–500 KB
  compressed; basemap pmtiles (43 MB) is baked into the web image, not
  the volume. A 10 GB MinIO volume holds ~30–100k maps. A map with a write
  key is never deleted by the server, because its owner may come back.
  Each document has one server map; sharing again updates it.

## Storage limits

`POST /api/maps` is open to anyone who reaches the server. These limits
bound what one client, or all of them, can take. Each default is the
server's; the compose file passes the value from `.env`. Never set one to
an empty value: an empty number reads as `0`, which turns that limit off.

| Var                                      | Default                | What it limits                                                                                                                                        |
| ---------------------------------------- | ---------------------- | ----------------------------------------------------------------------------------------------------------------------------------------------------- |
| `MAX_TOTAL_BYTES`                        | `10737418240` (10 GiB) | All stored maps together, writes in flight included. A new map or a growing save past it gets `507`. The check and the write cannot race. `0`: no cap |
| `MAX_MAP_BYTES`                          | `52428800` (50 MiB)    | One map. Larger gets `413` before a byte is read. nginx (minimal stack) allows 50 MiB too                                                             |
| `MAX_NEW_MAPS_PER_IP`                    | `60` per hour          | New maps from one client address (`429`). `NEW_MAPS_WINDOW_MS` sets the window                                                                        |
| `MAX_CONCURRENT_PER_IP`                  | `16`                   | Requests one client address has open at once (`429`)                                                                                                  |
| `RATE_LIMIT_MAX`, `RATE_LIMIT_WINDOW_MS` | `120` per `60000` ms   | Requests per client address per window (`429`). `/health` is never limited                                                                            |
| `IDLE_TIMEOUT_MS`                        | `30000`                | A connection with no bytes moving either way is closed: a stalled upload or a reader that stopped reading                                             |
| `REQUEST_TIMEOUT_MS`                     | `300000`               | The time to send one whole request, body included                                                                                                     |
| `SWEEP_INTERVAL_MS`                      | `3600000`              | How often expired links, orphan blobs and (after the grace) old keyless maps are deleted. Also once at start. `0`: never                              |
| `LEGACY_MAP_GRACE_DAYS`                  | `90`                   | How long maps from before write keys are kept after the upgrade                                                                                       |
| `SHUTDOWN_TIMEOUT_MS`                    | `25000`                | How long a stop waits for requests in flight. Compose gives the container 30 s                                                                        |

An IPv6 client counts by its /64 for every per-address limit. Behind Caddy
the address is the client's (`TRUST_PROXY=1`). People behind one address
share the limits. Many addresses together can still fill `MAX_TOTAL_BYTES`;
then every owner's growing save gets `507` until you raise the cap or
delete maps. If only your team should create maps, put the site behind
your own authentication.

## Blob storage

The storage server speaks S3. `BLOB_ENDPOINT`, `BLOB_ACCESS_KEY`,
`BLOB_SECRET_KEY`, `BLOB_BUCKET` and `BLOB_REGION` name the server, the
credentials, the bucket and its region. The server checks the bucket with
`HeadBucket` and makes it if it is missing; a bucket name that another
account owns is an error. Its user needs `s3:ListBucket` on the bucket and
`s3:GetObject`, `s3:PutObject`, `s3:DeleteObject` on its objects; to let
it make the bucket, also `s3:CreateBucket`.

The compose file pins MinIO's last community image by digest. MinIO no
longer publishes community images, and on 2026-10-01 neither Docker Hub
nor quay.io served it to an anonymous pull. A host that does not have the
image cannot start the `minio` service. Then run any S3 server you trust,
or a cloud bucket, and point the variables above at it (remove `minio` and
`minio-init` from the compose file, and `minio-init` from `storage`'s
`depends_on`). Only MinIO is tested.

## Security hardening (recommended)

The default compose ships with passwords from `.env` and Caddy-managed
TLS. For production exposure, also consider:

- **Size the storage cap.** `POST /api/maps` is open to anyone who can
  reach the server; the write key protects existing maps, not your disk.
  `MAX_TOTAL_BYTES` defaults to 10 GiB; set it below your free disk. Put
  the site behind your own auth (VPN, SSO proxy, basic auth) if only your
  team should create maps.
- **Restrict MinIO console access.** The default compose doesn't expose
  port 9001 externally; keep it that way. Use `docker compose exec` for
  admin tasks.
- **Bind Postgres to localhost only.** Default compose already does
  this (no `ports:` declaration → only reachable on the compose
  network). Don't add a public port mapping.
- **Set `SENTRY_DSN` only to an instance you control.** Sentry's hosted
  service is a third-party data processor; ADR-0009 documents the
  scrubbing applied (`Authorization` headers, request IPs stripped).
- **Rotate `MINIO_ROOT_PASSWORD`, `MINIO_APP_PASSWORD` and
  `POSTGRES_PASSWORD` periodically.**
  Currently a manual operation (compose env edit + `docker compose restart`).
- **Egress firewall.** The servers make no outbound calls beyond ACME
  (Caddy) and the optional Sentry DSN. To verify, `tcpdump` outbound
  traffic: the only expected destinations are the ACME endpoints and the
  Sentry ingestion URL. The users' browsers are a different matter; see
  "What the browser fetches from other servers" in [`README.md`](README.md).

## Realtime relay

The relay (`apps/realtime`, compose profile `realtime`) holds the shared
maps that people edit together ("rooms"). To turn rooms on:

1. Put `VITE_REALTIME_ENABLED=true` in `.env`. Leave `VITE_REALTIME_WS_URL`
   empty: the editor then connects to `/yjs/` on its own origin, which
   Caddy passes to the relay.
2. Rebuild and start with the profile:
   `docker compose --profile realtime --env-file .env -f infra/docker-compose.yml up -d --build`.

The Share dialog then offers **Collaborate**, which makes a room from the
open map and gives a room link. Anyone with the link can edit the room.

### What the relay can see

The relay can read everything in a room: the drawing, the layers and the
comments. The key in the room link, not the room id, lets a person in
(ADR-0014). If the operator must not read the rooms, do not enable the
relay, or run your own.

### Limits

Anyone who can reach the relay can make a room. These limits stop one
client from filling the memory or the disk. Each refusal closes the
WebSocket with a code and a reason, and the editor tells the user why.

| Var                      | Default                      | What it limits                                                                                                                                                                                                                   |
| ------------------------ | ---------------------------- | -------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| `MAX_TOTAL_ROOM_BYTES`   | `2147483648` (2 GiB)         | The bytes of all stored rooms together. When the total is at the cap, a new room is refused (4507, "relay storage full"). A save that would pass the cap is not written, and the room's connections close with 4507. `0`: no cap |
| `MAX_NEW_ROOMS_PER_IP`   | `30`                         | New rooms that one client address can make in one hour (4429, "too many new rooms"). Joining a room that exists is not counted. `0`: no limit                                                                                    |
| `MAX_CONNECTIONS_PER_IP` | `64`                         | Open connections from one client address (4429, "too many connections"). `0`: no limit                                                                                                                                           |
| `ROOM_EXPIRY_DAYS`       | `90`                         | The relay deletes a room that nobody was in for this many days. A deleted room's link then opens a new, empty room. `0`: never                                                                                                   |
| `ROOM_SWEEP_INTERVAL_MS` | `3600000` (1 h)              | How often the expiry sweep runs. It also runs once at start                                                                                                                                                                      |
| `MAX_ROOMS`              | `1000`                       | Rooms in memory at one time (4409)                                                                                                                                                                                               |
| `MAX_ROOM_SIZE`          | `50`                         | Connections to one room (4409)                                                                                                                                                                                                   |
| `MAX_ROOM_BYTES`         | `67108864` (64 MiB)          | One room. An update that would pass it is refused before it is applied (4413); the editor says the map is too large and stops saving                                                                                             |
| `MAX_MESSAGE_BYTES`      | `16777216` (16 MiB)          | One message from a client. A larger one closes that socket (1009). Do not set either cap below its default: the editor's limits come from the same table (`@atlasdraw/protocol` `ROOM_SIZE`)                                     |
| `TRUST_PROXY`            | `1` in compose, else `false` | Which proxies can give the client address in `X-Forwarded-For`: `true`, `false` or the number of proxies in front                                                                                                                |

The per-address limits use the address that the relay sees. Behind Caddy,
that address is Caddy's, so the compose file sets `TRUST_PROXY=1`. Do not
set `TRUST_PROXY` on a relay that clients can reach directly: then a client
can write any address in the header and step around the limits.

People behind one network address (an office or a school) share the
per-address limits. If they open many shared maps together, increase
`MAX_CONNECTIONS_PER_IP`.

### Back up the rooms

All rooms are in one SQLite file in the `roomsdata` volume
(`/data/rooms.sqlite`, with its `-wal` file). Copy the file to back it up.

## Topology

```
                ┌────────────┐
   internet ──► │  caddy:443 │ ──► Caddy (TLS terminator, reverse proxy)
                └─────┬──────┘
                      │
                      ├──── /yjs/* ──► realtime:4001 (relay, optional)
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
