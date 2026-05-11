# Atlasdraw — Self-Host Guide (First Run)

Run Atlasdraw on your own infrastructure in under five minutes. This guide
covers the **minimal stack** — a single VPS, sqlite + filesystem storage,
no external services.

For production-grade deployments (Postgres, MinIO/S3, TLS, custom domain),
see [`production.md`](production.md).

---

## What you get

A two-service Docker Compose stack:

- **`web`** — the Atlasdraw app (atlas-app) served by nginx on port `3000`.
- **`storage`** — the Atlasdraw storage API (Fastify, sqlite-fs mode) on
  port `4000`.

Plus one named Docker volume, `atlas-storage-data`, holding the SQLite
database (`atlas.db`) and uploaded map blobs (`blobs/*.atlasdraw`).

The bundled basemap (`world-low-zoom.pmtiles`, ~43 MB) is baked into the
web image — no runtime download. Optional offline-friendly: no outbound
network calls in the default config beyond the user-initiated share
endpoint and basemap tiles served locally.

## Prerequisites

- **Docker** (with `docker compose` v2 — modern Docker Desktop / Engine 24+).
- **~3 GB free disk** for the built images + volume.
- **Ports 3000 and 4000** free on the host (or remap in compose).

No `pmtiles` CLI, no `make`, no `go install`, no manual download — the
basemap ships with the image.

## First run

```bash
git clone https://github.com/atlasdraw/atlasdraw.git
cd atlasdraw
docker compose -f infra/docker-compose.minimal.yml up --build
```

Wait for `Storage started in sqlite-fs mode on :4000` in the logs.

First-time build: ~3–5 min (pulls Node + nginx base images, installs
workspace deps, builds atlas-app dist, compiles storage). Subsequent
`docker compose up` runs cold-start in ~5 seconds.

Open <http://localhost:3000>.

## What to try

1. **Draw something.** Click on the map; draw a freehand stroke or a
   rectangle. Autosave writes to `atlas-storage-data` after a 5-second
   debounce.
2. **Share it.** Open the hamburger menu → **🔗 Share map**. The dialog
   generates a copyable link.
   - Tiny maps (<32 KB): the link is fully self-contained — paste it
     into a fresh incognito window and the recipient sees the same
     thing. No server round-trip.
   - Large maps: the dialog uploads to your storage server; the link
     resolves through it. Default link TTL is 7 days
     (see [ADR-0008](../architecture/adr/0008-share-link-encoding.md)).
3. **About / telemetry.** Hamburger → **ℹ About Atlasdraw** shows
   version, license, build hash, and the
   [zero-call-home telemetry policy](../architecture/adr/0006-telemetry.md).

## Stopping and starting

```bash
# Stop, keep data
docker compose -f infra/docker-compose.minimal.yml stop

# Start again
docker compose -f infra/docker-compose.minimal.yml start

# Stop and remove containers (data volume survives)
docker compose -f infra/docker-compose.minimal.yml down

# Delete everything including saved maps (irreversible)
docker compose -f infra/docker-compose.minimal.yml down -v
```

## Health check

```bash
curl http://localhost:4000/health
```

Returns `{"status":"ok","uptime":<seconds>,"storageMode":"sqlite-fs"}`.

## Operator overrides

The minimal compose reads two env vars from `.env` or the shell:

- `PUBLIC_URL` — prefix for share URLs returned by the API. Default
  empty (relative URLs `/m/<token>`). Set to `https://atlas.example.com`
  if Atlasdraw lives behind your own reverse proxy.
- `LOG_LEVEL` — pino log level. Default `info`. Try `debug` to see every
  request, `silent` to mute startup logs.

Set them inline:
```bash
LOG_LEVEL=debug docker compose -f infra/docker-compose.minimal.yml up
```

Or via an `.env` file at repo root.

## Updating

```bash
git pull
docker compose -f infra/docker-compose.minimal.yml up --build -d
```

The `atlas-storage-data` volume survives image rebuilds. Backup before
major version bumps: copy the volume contents (see
[`production.md`](production.md) for the full backup procedure).

## Limitations of the minimal stack

- **Single writer.** SQLite handles concurrent reads but only one
  writer at a time. Fine for personal use or a small team; production
  multi-tenant deployments should use the full Postgres + MinIO stack
  ([`production.md`](production.md)).
- **No TLS.** This stack listens on plain HTTP on `localhost`. Don't
  expose it directly to the internet. Production: see `production.md`.
- **Backups are manual.** Volume snapshots only. No automated S3 sync.
- **No multi-user authentication.** All visitors can read and write the
  same map state. Multi-user comes in Phase 5+.

## Troubleshooting

**"Storage server not reachable" in atlas-app.** The web container
expects storage on `http://localhost:4000`. From a browser pointed at
`localhost:3000`, this works as long as port 4000 is also bound on the
host. If you remapped the storage port, rebuild with
`VITE_STORAGE_BASE_URL` pointing at the new URL:
```bash
docker compose -f infra/docker-compose.minimal.yml build \
  --build-arg VITE_STORAGE_BASE_URL=http://localhost:9000 web
```

**Build fails on `better-sqlite3`.** The storage image needs Python +
C++ build tools for the native module. The provided Dockerfile installs
them; if you've forked it and removed the apt layer, restore it:
```dockerfile
RUN apt-get update && apt-get install -y --no-install-recommends \
    python3 make g++ && rm -rf /var/lib/apt/lists/*
```

**Image rebuild is huge / slow.** The atlas-app build pulls a large npm
graph. After the first build, layer caching kicks in — subsequent
rebuilds touch only the source layer. To clear the cache:
`docker compose -f infra/docker-compose.minimal.yml build --no-cache`.

## Next steps

- **[Production deployment guide](production.md)** — full stack with
  Postgres, MinIO, Caddy TLS, custom domain.
- **[Architecture decisions](../architecture/adr/)** — six ADRs covering
  telemetry, storage modes, share-link encoding, error capture.
- **[Plan document](../superpowers/plans/2026-05-03-atlasdraw-phase-4-mvp-self-host.md)**
  — the implementation specification this self-host guide is built from.

License: [AGPL-3.0-only](../../LICENSE).
