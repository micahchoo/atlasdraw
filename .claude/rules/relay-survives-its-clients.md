---
paths:
  - code/apps/realtime/**
  - code/packages/protocol/src/wire.ts
tags: [collab, relay, security]
priority: high
source: hand-written
---

# The relay survives its clients

`apps/realtime/src/rooms.ts` faces the internet before any token is read.

- **Every socket and the WebSocketServer have an `error` listener.** `ws`
  emits `error` for a frame it refuses (over `maxPayload`: 1009; a text
  frame that is not UTF-8: 1007) after it has sent the close frame. With no
  listener, Node ends the process. Until 2026-10-01 one 17 MiB frame from
  anyone did that. A new socket path needs the listener too.
  `tests/relay-process.test.ts` runs `src/index.ts` in its own process and
  is the check: an in-process test shares the crash with the runner.
- **The room cap is checked per update, before it is applied** (`fits`,
  4413 "room too large: N > cap"). `room.bytes` is an upper bound; the state
  is encoded only near the cap. Do not move the check back to `save`.
- **Sizes and close codes come from `@atlasdraw/protocol` (`wire.ts`).**
  The editor packs its seed and checks its records against the same table.
  Change a cap there, never as a literal here.
- **`yarn build` bundles the protocol** (`build.mjs`): the runtime image
  has no `packages/`. Keep the `esbuild` dev dependency at the version the
  workspace already hoists (0.19.10). Adding 0.28 on 2026-10-01 moved
  `esbuild-sass-plugin` out of the root `node_modules`, and
  `yarn build:types` failed.

Verify with `cd code && npx vitest run apps/realtime`, and after a build
change `yarn workspace @atlasdraw/realtime build && node
apps/realtime/dist/index.js`, then `GET /health`.
