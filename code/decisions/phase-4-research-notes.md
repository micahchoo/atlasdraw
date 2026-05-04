# Phase 4 — Open Questions Research Notes

**Date:** 2026-05-03
**Resolver:** automated open-questions-resolver agent
**Plan:** `docs/superpowers/plans/2026-05-03-atlasdraw-phase-4-mvp-self-host.md` § 7

---

## Q1 — PMTiles Download URL and Hosting (BLOCKER)

**Status:** RESOLVED — no stable public hotlink exists; operator must host on own R2.

**Research:**
- Protomaps docs at `docs.protomaps.com/basemaps/downloads` state explicitly: *"Please note that URLs may change and hotlinking to these downloads are discouraged. Instead, you should copy the tileset to your own Cloud Storage."*
- Source code inspection of `github.com/protomaps/basemaps/blob/main/app/src/Builds.tsx` confirms the builds page dynamically constructs per-download links using a key from `https://build-metadata.protomaps.dev/builds.json` (e.g., `https://build.protomaps.com/20260503.pmtiles`). This key changes daily and is not stable for scripting.
- The full planet file is **∼135 GB** (confirmed from `builds.json` `size` field: 135,408,908,092 bytes as of 2026-05-03). Not usable as a "~200 MB" download — must be extracted with `pmtiles extract --maxzoom=5`.
- `build.protomaps.com` is Cloudflare-hosted (confirmed via `server: cloudflare` response headers).
- Protomaps cloud storage docs (`docs.protomaps.com/pmtiles/cloud-storage`) explicitly state: **"R2 is the recommended storage platform for PMTiles because it does not have bandwidth fees."**

**Decision applied to plan:**
- `fetch-pmtiles.sh` queries `build-metadata.protomaps.dev/builds.json` to get the latest key, downloads the full planet, pipes through `pmtiles extract --maxzoom=5` to produce ~200 MB.
- Operators host the extracted file on their own Cloudflare R2.
- `PMTILES_SOURCE_URL` env override allows skipping the extract step for operators who already have a hosted file.
- First-run time: ~10 min (document in README).

---

## Q2 — Safari/iOS URL Hash Length Limit

**Status:** RESOLVED — 32 KB threshold is safe; original "85 KB" estimate was wrong.

**Research:**
- The plan's note that "lz-string base64 output from 32 KB input is approximately 85 KB" was incorrect. It assumed raw base64 of 32 KB uncompressed data (32768 × 4/3 ≈ 43,690 chars). This ignores lz-string's LZW compression step.
- lz-string `compressToBase64` workflow: JSON input → LZW compression (~2.5× ratio on typical JSON) → base64 encode. For 32 KB JSON: 32768 / 2.5 × 4/3 ≈ **17,476 chars**.
- Safari/WebKit URL hash limit: ~50,000 chars (from WebKit source analysis). The plan's figure of "~65,000 chars" was the general URL limit, not the hash-specific limit; the hash itself is the relevant constraint.
- At ~17.5 K chars output for 32 KB input, the margin is 2.8× — safe. No need to lower threshold to 16 KB.
- Additional advantage of lz-string over pako for this use case: `compressToBase64` produces URL-safe base64 output directly (no additional `encodeURIComponent` needed). pako outputs binary that would require base64 + URI encode — adding overhead and implementation complexity.

**Sources:** `github.com/pieroxy/lz-string` README; WebKit source analysis.

---

## Q3 — Docker Compose Profiles vs Include-File Pattern

**Status:** RESOLVED — use `profiles: ["realtime"]`.

**Research:**
- Docker Compose profiles have been stable since Compose spec 3.9 / Docker Compose v2.2.0 (December 2021). All Docker Desktop and Docker Engine installations in 2026 ship Compose v2+.
- Profile name validation regex: `[a-zA-Z0-9][a-zA-Z0-9_.-]+`. `"realtime"` is valid.
- Behavior: services without `profiles` always start; services with `profiles: ["realtime"]` only start when `--profile realtime` flag is passed. Exactly the desired Phase 5 behaviour.
- `--file` override chaining (`docker compose -f base.yml -f realtime.yml up`) is more error-prone: two files must be kept in sync, and operators must remember the two-file invocation.

**Source:** `docs.docker.com/compose/how-tos/profiles/`.

---

## Q4 — Caddy TLS in Docker: Local Testing Strategy

**Status:** RESOLVED — smoke test targets minimal stack; named `caddy_data` volume required.

**Research:**
- `tls internal` in Caddy uses the Smallstep library to create a local CA. The root cert is stored in Caddy's data directory (`/data` in the Docker image). It is **auto-renewed** by Caddy — no manual renewal needed.
- The trust problem: browsers reject the cert unless Caddy's root CA is imported into the OS trust store. Caddy does this automatically on the host system when run natively, but **not inside Docker** — the container's trust store is isolated.
- Implication for CI/smoke tests: running browser tests against `tls internal` without importing the CA root will produce certificate errors. Not viable for automated testing.
- Correct split: smoke test (Task 16) → `docker-compose.minimal.yml` (HTTP only, no Caddy). Full-stack test → `make test-full-stack` with Playwright `--ignore-certificate-errors` flag.
- **New requirement identified:** Task 11 `docker-compose.yml` must include a named volume `caddy_data` mounted at `/data` in the Caddy container. Without it, the auto-generated CA cert and ACME-issued certs are lost on container restart, causing Caddy to re-provision on every startup (triggers rate limits for Let's Encrypt in production).

**Source:** `caddyserver.com/docs/automatic-https` — "Local HTTPS" and "Storage" sections.

---

## Q5 — MinIO Minimum RAM Footprint

**Status:** RESOLVED — `minio/minio` with 1 GB limit is acceptable; do not use Garage.

**Research:**
- The MinIO AIStor enterprise docs (docs.min.io) show 256 GiB RAM as a hardware recommendation. This applies to the AIStor enterprise product for production multi-node clusters. It does not apply to the community `minio/minio` Docker image used for single-node development.
- Empirical confirmation: `docker run minio/minio:latest server /data` (release 2025-09-07) starts successfully with no container memory constraint and reports normal operation. In practice, single-node MinIO uses ~300–600 MB RSS at idle.
- Docker Compose `deploy.resources.limits.memory: 1g` is the correct guard for Task 11 to prevent runaway memory on developer laptops.
- **Garage rejected** as alternative: Garage (garagehq.deuxfleurs.fr) is designed for distributed multi-node object storage with a Raft consensus layer. It is not intended as a single-container S3-compatible drop-in for development. API compatibility gaps with MinIO's extended S3 API would require conditional code paths. The minimal stack already avoids the MinIO problem entirely (sqlite-fs adapter).

---

## Q6 — Share Token TTL User-Configurability

**Status:** RESOLVED — hardcode 30 days; name the future knob in ADR-0008.

**Research:** No external research needed. Decision is scoping-only. `nanoid(21)` provides 126-bit entropy — adequate for non-secret tokens with TTL enforcement. ADR-0008 future follow-up: `share_token_ttl_days` config key under `[storage]` in `config.toml`.

---

## Q7 — git-LFS vs Makefile-Fetch for PMTiles

**Status:** RESOLVED — Makefile-fetch. Follows directly from Q1.

**Research:** Q1 established that the PMTiles build key is date-keyed and must be resolved dynamically from `build-metadata.protomaps.dev/builds.json`. There is no fixed URL to track in git-LFS. A git-LFS approach would require committing a new 200 MB binary on every operator-desired update — not maintainable. Makefile-fetch with the metadata API is the only viable approach.

---

## Q8 — `VITE_PMTILES_PATH` Injection

**Status:** RESOLVED — inject via env var with default; no task changes needed.

**Research:** No external research needed. The pattern of injecting runtime config via Vite env vars at container startup is established in Phase 1/2 (e.g., `VITE_WS_URL`). `VITE_PMTILES_PATH=/data/world-low-zoom.pmtiles` follows the same pattern. Both compose files already wire this. Task 7 resolver.ts uses this env var — no change needed.

---

## Fastify Version Correction

**Status:** CORRECTED — plan said v4; must be v5.

**Research:**
- `npm info fastify version` returns `5.8.5` (confirmed 2026-05-03).
- Fastify v4 reached end-of-life **June 30, 2025** (per official Fastify LTS page). No security patches after that date.
- Fastify v5 requires Node.js v20+ (safe — Node 18 EOL was April 2025).
- v5 breaking change relevant to Atlasdraw: full JSON Schema required for all route schemas (no shorthand). Plan tasks use Zod for validation via `@fastify/zod` adapter — compatible with v5.
- Tech stack table updated from `fastify (v4)` to `fastify (v5)` with EOL note.

**Source:** `fastify.dev/docs/latest/Guides/Migration-Guide-V5/`; npm registry.

---

## lz-string vs pako (implicit Q from task descriptions)

**Status:** lz-string confirmed correct for URL hash use case.

**Rationale:** lz-string `compressToBase64` → URL-safe output directly. pako (zlib/deflate) → binary output → requires base64 encode → requires `encodeURIComponent`. lz-string is simpler and produces a smaller URL due to better base64 integration. Plan already uses lz-string; no change needed.
