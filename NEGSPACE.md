# Negative-space matrix — ISSUES.md Issue 8

`apps/storage` vs. `apps/realtime` operational parity: dependency-down
handling, graceful shutdown, structured logging. Probed against real local
containers (postgres + minio, test credentials, no live deployment) with the
apps run directly (`tsx`, not through the broken `tsc` build — see the
incidental-fixes section) — real dependency failures forced, not reasoned
about.

| item | case | actual (before) | verdict | fix commit | retest |
|------|------|------------------|---------|------------|--------|
| `apps/storage/src/routes/health.ts` | postgres + minio containers stopped, health hit | unconditional `200 {"status":"ok"}` — comment admitted readiness was "implicit via 5xx on actual /maps requests" | **fail** | this pass | **pass** — real containers stopped, `/health` returned `503 {"status":"error","error":"connect ECONNREFUSED 127.0.0.1:15432"}` |
| `apps/storage`'s `pg.Pool` (found *while* forcing the row above) | postgres container stopped while an idle pool client is connected | **process-crashing**: `pg.Pool` had no `'error'` listener; node's default behavior for an unhandled EventEmitter `'error'` event is to throw — the entire storage server crashed, not just the in-flight request, on a plain `docker stop postgres` | **fail** (more severe than the seeded finding) | this pass | **pass** — added `pool.on("error", ...)`; re-ran the same stop against a running server: process survived, `/health` correctly returned 503 |
| `apps/realtime/src/index.ts` | `docker compose stop` mid-session (SIGTERM) | no `SIGTERM`/`SIGINT` handler at all (grep confirmed zero hits) — the process just dies, whatever Node's default signal behavior does, no drain | **fail** | this pass | **pass** — real client connected, SIGTERM sent to the running process: client received a graceful `disconnect` (`transport close`), server logged `"received signal — shutting down"`, process exited cleanly (not hard-killed) |
| `apps/realtime`'s y-websocket clients | same SIGTERM, mid-collaboration | `registerYjsHandler`'s `WebSocketServer` had no way to be told to close — even with an `io.close()`, already-upgraded y-websocket connections (separate TCP stream, `noServer: true`) would be abandoned | **fail** | this pass | **pass** — `registerYjsHandler` now returns `close()`, which sends a normal close frame (code 1001) to every client before closing the `WebSocketServer`; forced in `yjs-server-shutdown.test.ts` (real client, real close event asserted) |
| `apps/realtime`'s Redis clients (if `REDIS_URL` configured) | same SIGTERM | `attachRedisAdapterIfConfigured` created two `ioredis` clients and returned `void` — no handle for shutdown to `.quit()` them | **fail** | this pass | **pass** — function now returns `{pubClient, subClient} \| null`; shutdown awaits `.quit()` on both; forced in `redis-adapter-shutdown.test.ts` |
| `apps/realtime` logging | any incident needing to correlate a client's actions across the log | exclusively raw `console.log`/`console.warn`, no request/socket correlation structure, unlike storage's `pino` instance | **fail** | this pass | **pass** — new `apps/realtime/src/logger.ts` (same shape as storage's), all `console.*` call sites converted to structured `logger.info`/`logger.warn` with socket id / event / payload-size fields |

## Incidental fixes (found while forcing the checks above, not part of the seeded findings)

- **`code/apps/storage/Dockerfile`, `code/apps/realtime/Dockerfile`,
  `code/apps/atlas-app/Dockerfile`**: none ran `corepack enable` before
  `yarn install --frozen-lockfile`. `package.json` pins
  `"packageManager": "yarn@4.15.0"`, and a fresh `node:20-bookworm-slim`
  build stage has Corepack installed but not enabled — every one of these
  Dockerfiles failed a clean build with "the current global version of Yarn
  is 1.22.22." Added `RUN corepack enable` to all three, matching the
  CI workflow's already-documented pattern (see root `CLAUDE.md`'s
  Yarn/corepack note). **Not otherwise fixed**: after this, `apps/realtime`
  and `apps/storage`'s Docker builds still fail `yarn install
  --frozen-lockfile` inside the container — the Dockerfiles' `COPY` steps
  only copy the target workspace's `package.json` + `code/packages`, not
  every workspace's `package.json`, so the shared `yarn.lock` (which
  references the full workspace graph) can't resolve without modification.
  This is a deeper, pre-existing Dockerfile structure issue, out of scope
  for Issue 8 — flagging it here rather than fixing it. Worked around for
  this session's forced checks by running the built servers directly via
  `tsx` against real postgres/minio containers (published ports, test
  credentials) instead of through the app Docker images.
- **`apps/storage`'s own `tsc -p tsconfig.build.json` build script is
  currently broken** on pre-existing errors unrelated to this pass
  (`src/db/migrate.ts`'s `Database` namespace-as-type error;
  `src/index.ts`'s `error` typed `unknown` in the Sentry error handler —
  confirmed present on `main` before this session via `git stash`). Not
  fixed here — out of scope for Issue 8, flagged for a future pass.

## Done

Every row reads pass on retest. `apps/storage`: 122 tests (13 files),
`apps/realtime`: 22 tests (6 files), both green.
