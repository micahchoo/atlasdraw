# Atlasdraw — Production Self-Host Guide

This guide covers the **full stack** — Postgres + your S3-compatible
bucket + Caddy TLS + custom domain — recommended for any deployment that's not a personal
single-user instance.

For a quick personal install, see [`README.md`](README.md) (minimal
stack, sqlite + filesystem, no external services).

---

## What you get

Four Docker services on the compose network, and an optional fifth (the
relay, see "Realtime relay"). The stack runs no object store: map bytes go
to an S3-compatible bucket that you supply (see "Blob storage").

- **`web`** — atlas-app dist served by nginx (unprivileged), internal port
  `3000`.
- **`storage`** — Fastify API in `postgres-minio` mode, internal port `4000`.
  Runs as the unprivileged `node` user on Node 22.
- **`postgres`** — Postgres 16 for map metadata + share tokens.
- **`caddy`** — TLS reverse proxy on host ports `80` and `443`. Provisions
  Let's Encrypt certs automatically.

Plus named volumes:

- `pgdata` — Postgres data directory.
- `caddy_data` — auto-renewed TLS certs (critical: must persist across
  restarts to avoid Let's Encrypt rate-limit hits).
- `caddy_config` — Caddy runtime state.
- `roomsdata` — the relay's rooms, used only with the `realtime` profile.

## Why two compose files?

Different deployment topologies need different tradeoffs (see
[ADR-0007 storage dual-mode](../architecture/adr/0007-storage-dual-mode.md)):

- **Minimal** (`docker-compose.minimal.yml`) — sqlite + filesystem, no
  external services, no reverse proxy. Single VPS, single user, simplest
  backup. ~3 GB disk, ~500 MB RAM.
- **Full** (`docker-compose.yml`) — Postgres + Caddy, with map bytes in
  your S3-compatible bucket. Multi-writer, automatic TLS, suitable for any
  operator comfortable with Docker. ~5 GB disk on the host; the maps take
  space in the bucket, not on the host.

Both stacks expose the same HTTP API; atlas-app code is agnostic to which
adapter is loaded.

## Prerequisites

- **Docker** with Compose v2 (Engine 24+).
- **A domain pointing to your host** (A record or AAAA record). Let's
  Encrypt cannot issue a cert for an IP-only host.
- **Ports 80 and 443 open** to the public internet. Port 80 is needed
  for the ACME HTTP-01 challenge.
- **~5 GB free disk** for images + initial volumes.
- **An S3-compatible bucket and an access key for it.** See "Blob storage"
  below for how to choose a provider and limit the key.

## Setup

```bash
git clone https://github.com/atlasdraw/atlasdraw.git
cd atlasdraw
cp infra/.env.example .env
$EDITOR .env
```

Edit `.env`. The mandatory fields are:

| Var                 | Purpose                              | Example                              |
| ------------------- | ------------------------------------ | ------------------------------------ |
| `PUBLIC_DOMAIN`     | Hostname Caddy serves on             | `atlas.example.com`                  |
| `ACME_EMAIL`        | Let's Encrypt account email          | `ops@example.com`                    |
| `POSTGRES_PASSWORD` | Postgres superuser password          | (generate; 32+ chars)                |
| `BLOB_ENDPOINT`     | URL of your S3-compatible server     | `https://s3.us-east-1.amazonaws.com` |
| `BLOB_ACCESS_KEY`   | Access key ID, limited to one bucket | (from your provider)                 |
| `BLOB_SECRET_KEY`   | The secret of that access key        | (from your provider)                 |

Compose refuses to start if a `BLOB_ENDPOINT`, `BLOB_ACCESS_KEY` or
`BLOB_SECRET_KEY` is missing.

Optional:

- `LOG_LEVEL` — pino level for storage server (`info` default).
- `SENTRY_DSN` — opt-in error capture
  ([ADR-0009](../architecture/adr/0009-error-capture.md)). **Leave empty**
  to preserve the
  [zero-call-home posture](../architecture/adr/0006-telemetry.md).
  Operators who set this must document the third-party data processor in
  their privacy notice — see the same ADR.
- `POSTGRES_USER`, `POSTGRES_DB` — defaults are `atlasdraw`. Override if
  you need to match existing infra.
- `BLOB_BUCKET`, `BLOB_REGION` — the bucket and its region (defaults
  `atlasdraw-maps`, `us-east-1`).
- `BLOB_FORCE_PATH_STYLE` — `true` (default) or `false`. Set `false` for
  AWS S3. See "Blob storage" below.
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

## Basemap: offline, with streets

The web image bundles everything the "Light" and "Dark" basemaps draw with:

- `world-low-zoom.pmtiles` (43 MB): the world to zoom 5. It has country,
  region and city names, and no streets.
- The label glyphs (four Noto Sans stacks, Devanagari among them, all 256
  ranges, 11.5 MB) and the icon sprites, in `/basemap/`. They are copies of
  `protomaps/basemaps-assets` at one pinned commit
  (`code/apps/atlas-app/scripts/vendor-basemap-assets.sh`).

So these two basemaps make no request to another host. A test proves it in
a browser that refuses every other host
(`code/apps/atlas-app/e2e/offline-basemap.spec.ts`).

To show streets, extract the area you need from the Protomaps planet build
and serve it in place of the world file:

1. Install the pmtiles CLI: `go install github.com/protomaps/go-pmtiles@latest`,
   or a release binary from <https://github.com/protomaps/go-pmtiles/releases>.
2. Extract your area. The CLI reads only the tiles inside the box, by range
   requests; it does not download the planet.

   ```bash
   make -f infra/Makefile basemap-region BBOX='13.0,52.3,13.8,52.7'
   ```

   `BBOX` is `west,south,east,north` in degrees. `MAXZOOM` (default 15) is
   the deepest zoom; the map enlarges zoom 15 beyond that. The file goes to
   `infra/data/region.pmtiles`, which git ignores. Measured on 2026-10-01:
   central Berlin (0.05 by 0.03 degrees) to zoom 15 is 4.6 MB and takes 2
   seconds. A city is tens of MB; a country is 1–10 GB.

3. Start the stack with the basemap override. It mounts the file
   read-only and builds the app to read `/data/basemap.pmtiles`:

   ```bash
   docker compose --env-file .env -f infra/docker-compose.yml \
     -f infra/docker-compose.basemap.yml up -d --build
   ```

   The override works with the minimal stack too. Set `BASEMAP_PMTILES` to
   use a file in another place. The file must be world-readable: nginx
   reads it as uid 101.

An extract holds only its box. Outside the box the map shows the
background color, at every zoom. Make the box cover every area your users
map.

"Bright" and "OSM" are remote basemaps: their tiles, glyphs and sprite come
from their own servers. Set `VITE_ALLOW_REMOTE_BASEMAPS=false` to remove
them. Then the editor makes no third-party request until a user adds a tile
layer.

### A tile server that the policy blocks

The page's content security policy lets the map reach only this origin, the
remote basemaps and the hosts in `VITE_CSP_CONNECT_SRC`. When a user adds a
tile layer from another host, the form refuses it and names the host and
the variable to set. Without this message the layer would stay blank, and
only the browser console would say why.

## Bring it up

```bash
docker compose --env-file .env -f infra/docker-compose.yml up -d --build
```

First build: ~5–10 min. Postgres makes its volume on first start. The
storage server waits until Postgres is healthy, then applies its schema
migrations before it answers a request.

Then check the bucket. The storage server sends `HeadBucket` at each
health check, and makes the bucket if it is missing and the key may do
that:

```bash
curl https://atlas.example.com/api/health
```

`{"status":"ok",...}` means Postgres and the bucket both answered. A 503
means one did not; `docker compose ... logs storage` gives the cause.

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

The full stack keeps data in three places. Back up each one.

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

### Back up your bucket

The bucket is yours, so its backup is yours too. Choose one:

- **Use your provider's tools.** Turn on bucket versioning, so that a
  deleted or overwritten object can come back. Or turn on replication to a
  second bucket, in a different region if you can.
- **Copy the bucket on a schedule.** Use a different key for the backup:
  a key that can read the bucket only. For example, with `rclone` and a
  remote named `atlas` that points at your provider:

  ```bash
  rclone sync atlas:atlasdraw-maps ./maps-backup-$(date -I)
  ```

  Or with the AWS CLI, against any S3-compatible endpoint:

  ```bash
  aws s3 sync s3://atlasdraw-maps ./maps-backup-$(date -I) \
    --endpoint-url "$BLOB_ENDPOINT"
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

Migration `005_map_versions` gives every map a revision and starts each
existing map at revision 1. From then on the server keeps earlier versions
of each map (ADR-0020), so the stored size grows: up to `MAP_VERSIONS_KEPT`
copies of each map, inside `MAX_TOTAL_BYTES`. Set `MAP_VERSIONS_KEPT=0`
before you upgrade if your disk has no room for them. An older browser
client saves without naming a revision and keeps working.

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
  give a link a 7- or 30-day expiry instead. A link shows the map's
  latest saved version, so a save updates every link and every embed made
  from it, unless the owner froze it on one version ("This version only").
  Links made before this release keep their 7-day expiry.
- **Write keys.** Each map has a write key that only the owner's browser
  holds (ADR-0017). Without it, nobody can change the map, and a share
  link never gives it. The server cannot recover a key. The owner's own
  copy is **My maps → Back up my maps**, a file with the maps and their
  keys; tell your users to keep one.
- **Server versions.** The server keeps earlier versions of each map
  (ADR-0020). The owner opens them with **File → Server versions…** and can
  restore one or open it as a copy. Only the write key reads them.
- **Storage capacity.** An average atlasdraw document is 30–500 KB
  compressed; basemap pmtiles (43 MB) and its glyphs (11.5 MB) are baked
  into the web image, not the volume. 10 GB of bucket space holds ~30–100k maps. A map with a write
  key is never deleted by the server, because its owner may come back.
  Each document has one server map; sharing again updates it.

## Storage limits

`POST /api/maps` is open to anyone who reaches the server. These limits
bound what one client, or all of them, can take. Each default is the
server's; the compose file passes the value from `.env`. Never set one to
an empty value: an empty number reads as `0`, which turns that limit off.

| Var                                      | Default                | What it limits                                                                                                                                                   |
| ---------------------------------------- | ---------------------- | ---------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| `MAX_TOTAL_BYTES`                        | `10737418240` (10 GiB) | All stored maps together, writes in flight included. A new map or a growing save past it gets `507`. The check and the write cannot race. `0`: no cap            |
| `MAX_MAP_BYTES`                          | `52428800` (50 MiB)    | One map. Larger gets `413` before a byte is read. nginx (minimal stack) allows 50 MiB too                                                                        |
| `MAX_NEW_MAPS_PER_IP`                    | `60` per hour          | New maps from one client address (`429`). `NEW_MAPS_WINDOW_MS` sets the window                                                                                   |
| `MAX_CONCURRENT_PER_IP`                  | `16`                   | Requests one client address has open at once (`429`)                                                                                                             |
| `RATE_LIMIT_MAX`, `RATE_LIMIT_WINDOW_MS` | `120` per `60000` ms   | Requests per client address per window (`429`). `/health` is never limited                                                                                       |
| `IDLE_TIMEOUT_MS`                        | `30000`                | A connection with no bytes moving either way is closed: a stalled upload or a reader that stopped reading                                                        |
| `REQUEST_TIMEOUT_MS`                     | `300000`               | The time to send one whole request, body included                                                                                                                |
| `SWEEP_INTERVAL_MS`                      | `3600000`              | How often expired links, orphan blobs and (after the grace) old keyless maps are deleted. Also once at start. `0`: never                                         |
| `LEGACY_MAP_GRACE_DAYS`                  | `90`                   | How long maps from before write keys are kept after the upgrade                                                                                                  |
| `MAP_VERSIONS_KEPT`                      | `20`                   | Earlier versions kept of each map, besides its latest bytes. They count against `MAX_TOTAL_BYTES`. A version a frozen link reads is always kept. `0`: no history |
| `MAP_VERSION_INTERVAL_MINUTES`           | `10`                   | The least time between two kept versions. A save that stood for less, and came less than this after the last kept version, is not kept. `0`: every save          |
| `SHUTDOWN_TIMEOUT_MS`                    | `25000`                | How long a stop waits for requests in flight. Compose gives the container 30 s                                                                                   |

An IPv6 client counts by its /64 for every per-address limit. Behind Caddy
the address is the client's (`TRUST_PROXY=loopback,uniquelocal`: trust a
proxy on the private compose network). Storage refuses a hop count such as
`1`; its HTTP server (Fastify 5.12 and later) cannot check a proxy by hop
count. People behind one address
share the limits. Many addresses together can still fill `MAX_TOTAL_BYTES`;
then every owner's growing save gets `507` until you raise the cap or
delete maps. If only your team should create maps, put the site behind
your own authentication.

## Blob storage

The full stack runs no object store. The storage server keeps each map's
bytes in an S3-compatible bucket that you supply. Postgres keeps the rows
that name them.

MinIO no longer publishes community images. On 2026-10-01 neither
`docker.io/minio/minio` nor `quay.io/minio/minio` served an anonymous
pull, so the stack cannot ship one. The storage mode keeps its old name,
`postgres-minio`, but it means "Postgres and any S3".

### Choose a provider

Any server that speaks the S3 API can work:

- **A cloud bucket:** AWS S3, Cloudflare R2, Backblaze B2. Nothing to run;
  you pay per GB stored and per request.
- **A server you run:** Garage, SeaweedFS, or a MinIO that you build from
  source or already run. Run it on a different host or disk from Postgres,
  so that one failure does not take both.

CI runs the adapter's contract tests against SeaweedFS's S3 gateway, and the
adapter has also run against MinIO. Providers differ in small ways, so before
you go live, check yours: save a map, then open its share link in a private
window.

### Set the variables

| Var                                  | What it is                                                                    |
| ------------------------------------ | ----------------------------------------------------------------------------- |
| `BLOB_ENDPOINT`                      | The provider's S3 URL, for example `https://s3.us-east-1.amazonaws.com`       |
| `BLOB_ACCESS_KEY`, `BLOB_SECRET_KEY` | The key the storage server uses                                               |
| `BLOB_BUCKET`                        | The bucket name. Default `atlasdraw-maps`                                     |
| `BLOB_REGION`                        | The bucket's region. Default `us-east-1`. Your provider's docs name the value |
| `BLOB_FORCE_PATH_STYLE`              | `true` (default) or `false`. See below                                        |

**Path-style or virtual-hosted.** A path-style URL puts the bucket in the
path: `https://s3.example.com/atlasdraw-maps/<key>`. Most self-run servers
need this, so it is the default. A virtual-hosted URL puts the bucket in
the host name: `https://atlasdraw-maps.s3.example.com/<key>`. AWS S3
prefers it. For AWS S3, set `BLOB_FORCE_PATH_STYLE=false`. For other
providers, read their docs.

### Limit the key to one bucket

Give the storage server a key that reaches this bucket only. If the server
is compromised, the attacker then gets your maps, not your whole account.

The storage server needs `s3:ListBucket` on the bucket and
`s3:GetObject`, `s3:PutObject` and `s3:DeleteObject` on its objects. On
AWS S3 and on servers that read AWS-style policies, that is:

```json
{
  "Version": "2012-10-17",
  "Statement": [
    {
      "Effect": "Allow",
      "Action": ["s3:ListBucket"],
      "Resource": ["arn:aws:s3:::atlasdraw-maps"]
    },
    {
      "Effect": "Allow",
      "Action": ["s3:GetObject", "s3:PutObject", "s3:DeleteObject"],
      "Resource": ["arn:aws:s3:::atlasdraw-maps/*"]
    }
  ]
}
```

Use your `BLOB_BUCKET` in place of `atlasdraw-maps`. Other providers have
their own way to scope a key: an R2 API token for one bucket, a B2
application key restricted to one bucket, a Garage key allowed on one
bucket.

**Who makes the bucket.** At its first use of the bucket, and at each
health check, the storage server sends `HeadBucket`. If the bucket is missing, it sends `CreateBucket`. The policy
above has no `s3:CreateBucket`, so with that key, make the bucket yourself
first. To let the server make it, add `s3:CreateBucket`. A bucket name
that another account owns (`BucketAlreadyExists`) is an error: choose a
different `BLOB_BUCKET`.

## Security hardening (recommended)

The default compose ships with passwords from `.env` and Caddy-managed
TLS. For production exposure, also consider:

- **Size the storage cap.** `POST /api/maps` is open to anyone who can
  reach the server; the write key protects existing maps, not your disk.
  `MAX_TOTAL_BYTES` defaults to 10 GiB; set it below your free disk. Put
  the site behind your own auth (VPN, SSO proxy, basic auth) if only your
  team should create maps.
- **Limit the bucket key.** Give the storage server a key that reaches
  `BLOB_BUCKET` only (see "Blob storage"). Never use your provider's root
  or account-wide key.
- **Bind Postgres to localhost only.** Default compose already does
  this (no `ports:` declaration → only reachable on the compose
  network). Don't add a public port mapping.
- **Set `SENTRY_DSN` only to an instance you control.** Sentry's hosted
  service is a third-party data processor;
  `docs/architecture/adr/0009-error-capture.md` documents the
  scrubbing applied (`Authorization` headers, request IPs stripped).
- **Rotate the bucket key and `POSTGRES_PASSWORD` periodically.**
  Currently a manual operation (edit `.env`, then run the `up -d` command
  again so compose recreates the container with the new values).
- **Egress firewall.** The servers make no outbound calls beyond ACME
  (Caddy), your `BLOB_ENDPOINT` (storage) and the optional Sentry DSN. To
  verify, `tcpdump` outbound traffic: the only expected destinations are
  the ACME endpoints, your S3 endpoint and the Sentry ingestion URL. The users' browsers are a different matter; see
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
                      │                    └─► BLOB_ENDPOINT (your S3 bucket,
                      │                         outside the stack)
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
- **[Bring your own S3 (ADR-0019)](../architecture/adr/0019-bring-your-own-s3.md)**
  — why the full stack runs no object store.
- **[Share-link encoding (ADR-0008)](../architecture/adr/0008-share-link-encoding.md)**
  — the two share modes (URL-hash, server-token) and their security
  properties.
- **[Error capture (ADR-0009)](../architecture/adr/0009-error-capture.md)**
  — opt-in Sentry path and its PII scrubbing.

License: [AGPL-3.0-only](../../code/LICENSE-AGPL).
