# Atlasdraw — Self-Host Guide (First Run)

This guide runs Atlasdraw on one computer in about five minutes, with the
**minimal stack**: SQLite and files, no other services.

For a server on the internet (Postgres, MinIO or S3, TLS, a domain, live
rooms), read [`production.md`](production.md).

---

## What you get

A Docker Compose stack with two services:

- **`web`** — the Atlasdraw editor, served by nginx on port `3000`. nginx
  also passes `/api/*` to the storage server, so the browser talks to one
  origin only.
- **`storage`** — the storage API (Fastify, `sqlite-fs` mode). It is on the
  compose network only; the host cannot reach it directly.

One Docker volume, `atlas-storage-data`, holds the SQLite database
(`atlas.db`) and the saved maps (`blobs/<id>.atlasdraw`).

The basemap file (`world-low-zoom.pmtiles`, about 43 MB) is inside the web
image, so nothing downloads at run time. The minimal stack has no relay, so
the Share dialog offers no live rooms.

## Prerequisites

- Docker with `docker compose` v2 (Docker Engine 24 or later).
- About 3 GB of free disk for the images and the volume.
- Port 3000 free on the host.

## First run

```bash
git clone https://github.com/atlasdraw/atlasdraw.git
cd atlasdraw
docker compose -f infra/docker-compose.minimal.yml up --build
```

Wait for `Storage started in sqlite-fs mode on :4000` in the log. The first
build takes 3–5 minutes. Later starts take seconds.

Open <http://localhost:3000>.

## What to try

1. **Draw something.** Pick a tool and draw on the map. The browser saves
   your map to IndexedDB about 5 seconds after you stop, and also backs it up
   to the storage server.
2. **Share it.** Open the main menu and choose **Share map**, then **Share
   read-only**.
   - A small map goes inside the link. It needs no server and never
     expires.
   - A larger map goes to your storage server, and the link reads it there.
     That link lasts until you choose **Stop sharing this link**, unless you
     chose a 7- or 30-day expiry. It always shows your latest save.
   - The dialog also gives an `<iframe>` snippet that embeds the map.
3. **Open another map.** Main menu → **My maps…** lists the maps saved in
   this browser.

## Health check

```bash
curl http://localhost:3000/api/health
```

It returns `{"status":"ok","uptime":<seconds>,"storageMode":"sqlite-fs"}`.
`infra/smoke-minimal.sh` checks the whole flow: health, create, write key,
share link.

## Stop and start

```bash
# Stop, keep data
docker compose -f infra/docker-compose.minimal.yml stop

# Start again
docker compose -f infra/docker-compose.minimal.yml start

# Remove the containers; the data volume stays
docker compose -f infra/docker-compose.minimal.yml down

# Delete everything, including saved maps (you cannot undo this)
docker compose -f infra/docker-compose.minimal.yml down -v
```

## Settings

### Storage server (at run time)

The minimal compose file reads two variables from `.env` or the shell:

- `PUBLIC_URL` — the prefix of the share URLs that the API returns. Default
  empty: relative URLs (`/m/<token>`). Set it, for example to
  `https://atlas.example.com`, when Atlasdraw is behind your own proxy.
- `LOG_LEVEL` — the pino log level. Default `info`, which already logs
  every request (a share token shows as `[redacted]`); `debug` adds detail.

```bash
LOG_LEVEL=debug docker compose -f infra/docker-compose.minimal.yml up
```

The storage server reads more variables: the limits (`MAX_TOTAL_BYTES`,
10 GiB by default, and the others in "Storage limits" in
[`production.md`](production.md)) and `TRUST_PROXY`. The minimal compose
file does not pass them, so the server's defaults apply; add one to the
`storage` service's `environment` to change it.

### Editor (at build time)

The editor reads `VITE_*` variables when it is built, not when it runs. A
wrong value stops the editor at start with the name of the variable. The
Docker image takes five of them as build arguments: `VITE_BUILD_TARGET`,
`VITE_STORAGE_BASE_URL`, `VITE_PMTILES_PATH`, `VITE_REALTIME_ENABLED` and
`VITE_REALTIME_WS_URL`. For the others, write them into
`code/apps/atlas-app/.env.production.local` (git ignores it) before you build.
Vite reads that file during the image build.

| Variable                     | Default     | Effect                                                   |
| ---------------------------- | ----------- | -------------------------------------------------------- |
| `VITE_ALLOW_REMOTE_BASEMAPS` | `true`      | `false` removes "Bright", "OSM" and the USGS tile preset |
| `VITE_GEOCODER_ENDPOINT`     | empty (off) | A Photon server for CSV address columns                  |
| `VITE_EMBED_ENABLED`         | `true`      | `false` makes `/embed` open the editor                   |

## What the browser fetches from other servers

The editor sends no telemetry. These requests leave your server:

- **Label fonts of the default basemaps.** The Light and Dark styles load
  their glyphs from `protomaps.github.io`. There is no setting for this yet.
- **The "Bright" and "OSM" basemaps**, when a user picks one. Turn them off
  with `VITE_ALLOW_REMOTE_BASEMAPS=false`.
- **Tile layers** that a user adds (next section).
- **The geocoder**, only if you set `VITE_GEOCODER_ENDPOINT`.

## Aerial imagery and other tile layers

A user can add map tiles from a URL: open the layer panel, go to **Tile
layers**, and click **Add tile layer…**. Atlasdraw ships no tile URL and no
key. The browser does not call a tile server until a user adds a layer.

The URL must:

- contain `{z}`, `{x}` and `{y}`. ArcGIS servers use `{z}/{y}/{x}`.
- start with `https://`. Only a server on the same computer (`localhost`,
  `127.0.0.1`) can use `http://`.
- name one server. MapLibre does not fill in `{s}`; write `a` in its place.

Type the provider's credit in **Credit**. Atlasdraw prints it in the status
bar, in the PNG export and on the PDF page.

The form has one preset: USGS aerial imagery of the United States (public
domain, no key). `VITE_ALLOW_REMOTE_BASEMAPS=false` removes it.

To give users aerial imagery for other areas, run a tile server or use a
provider that permits your use, and give users its URL. Example with a local
server:

```text
http://localhost:8080/tiles/{z}/{x}/{y}.png
```

Do not put a provider key in a URL that you share. Every person who opens
the map sees the URL, because it is saved in the `.atlasdraw` file
(`tileLayers` in `manifest.json`).

## Update

```bash
git pull
docker compose -f infra/docker-compose.minimal.yml up --build -d
```

The `atlas-storage-data` volume stays when the images change. The storage
server migrates its schema at start, so copy the volume before an update.
Read the "Upgrade" part of [`CHANGELOG.md`](../../CHANGELOG.md) first.

The storage image now runs as the unprivileged `node` user. A volume that
an older image made is owned by root; give it to `node` once, before the
new image starts:

```bash
docker compose -f infra/docker-compose.minimal.yml run --rm \
  --user root --entrypoint chown storage -R node:node /data
```

## Limits of the minimal stack

- **One writer.** SQLite takes one write at a time. This is enough for one
  person or a small team.
- **No TLS.** The stack serves plain HTTP. Do not put it on the internet as
  it is; use [`production.md`](production.md).
- **No live rooms.** The relay is in the full stack only.
- **Manual backups.** Copy the volume.
- **No accounts.** Each browser keeps its own maps. A map on the server can
  be changed only with its write key, which only the browser that made it
  holds. Anyone who can reach the server can create maps.

## Troubleshooting

**"Couldn't sync to the server".** The editor saved your map in the browser
but could not reach `/api`. Check that the `storage` container is healthy:
`docker compose -f infra/docker-compose.minimal.yml ps`.

**"The server no longer has this map" or "…no longer accepts this
browser's key".** The server refused the map this browser saves to: it was
deleted, or the key in this browser does not open it. The editor does not
make a new server map by itself, because links you shared would stay on the
old version. Your changes are in the browser. A new server copy gets new
links.

**The build fails on `better-sqlite3`.** The storage image needs Python and
C++ build tools for this native module. The Dockerfile installs them; if you
changed it, put this layer back:

```dockerfile
RUN apt-get update && apt-get install -y --no-install-recommends \
    python3 make g++ && rm -rf /var/lib/apt/lists/*
```

**The image build is slow.** The editor build installs a large dependency
tree. Later builds reuse the cached layers. To build from nothing:
`docker compose -f infra/docker-compose.minimal.yml build --no-cache`.

## Next steps

- [Production guide](production.md) — Postgres, MinIO, Caddy TLS, a domain
  and the relay.
- [Architecture decisions](../architecture/adr/) — the product ADRs.

Licence: [AGPL-3.0-only](../../code/LICENSE-AGPL).
