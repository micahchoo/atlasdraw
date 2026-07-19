---
name: run-atlas-app
description: >
  Verified, cold-start procedure for launching and driving the atlas-app
  editor SPA (the atlasdraw product) in this repo. Use this whenever asked to
  run, start, stand up, launch, smoke-test, or "see the app working" for
  atlasdraw/atlas-app — instead of rediscovering install/dev-server/port
  steps from the READMEs, which are stale in places (yarn version). Covers
  the yarn workspace quirks (code/ subdirectory, real packageManager pin),
  finding the actual dev-server port, and driving the loaded app with
  playwright-cli (chromium, not chrome) to prove it's actually interactive,
  not just serving HTML.
triggers:
  - keywords: [run the app, start the app, stand up, dev server, launch atlasdraw, smoke test, atlas-app]
---

# Running atlas-app

atlas-app is the editor SPA — MapLibre basemap + forked Excalidraw canvas —
and the only piece needed to "see atlasdraw running." The sibling services
`apps/realtime` (Socket.IO/y-websocket collab relay) and `apps/storage`
(Fastify API) exist in the same workspace but aren't required for a basic
launch-and-draw check; only reach for them if the task is collaboration or
persistence specifically.

## Gotchas the docs get wrong

- **The workspace root is `code/`, not the repo root.** `cd code` first —
  `yarn install` / `yarn --cwd ...` from the repo root will fail or hit the
  wrong `package.json`.
- **Ignore README.md's "yarn@1.22."** That's stale. The real pin is
  `code/package.json`'s `"packageManager": "yarn@4.15.0"` (Corepack-managed).
  Node >=18 works; this has been verified on Node 24.
- **Don't assume port 5173.** Vite falls back to the next free port with no
  warning beyond a one-line log ("Port 5173 is in use, trying another
  one..."). Other projects on a shared dev machine commonly squat 5173/5174.
  Always read the actual `➜ Local:` URL from the dev-server's own stdout —
  don't hardcode a port in a curl/playwright command before checking.

## Steps

1. **Install deps if needed.**
   ```bash
   cd code
   test -d node_modules || yarn install
   test -d apps/atlas-app/node_modules || yarn install
   ```

2. **Launch the dev server in the background**, capturing its log so you can
   read the real URL back out:
   ```bash
   yarn --cwd apps/atlas-app dev > /tmp/atlas-app-dev.log 2>&1 &
   sleep 3
   cat /tmp/atlas-app-dev.log   # find the "➜  Local:" line — that's your URL
   ```
   Equivalently `yarn workspace @atlasdraw/atlas-app dev` (per `code/CLAUDE.md`).
   The backgrounding tool call itself will report "completed" almost
   immediately — that's just the launcher shell returning, not the server
   exiting. Confirm the server process is still alive (`ps aux | grep vite`)
   rather than trusting the completion notification.

   `[eval: real-port]` The URL used in every following step is the one
   printed by Vite, not an assumed default.

3. **HTTP smoke test** (route curl through context-mode per this project's
   rules, not raw Bash):
   ```
   ctx_execute(shell, "curl -s -o /dev/null -w '%{http_code}\n' http://localhost:<PORT>/")
   ```
   Expect `200`. Optionally grep the body for `<title>Atlasdraw</title>` to
   confirm it's the right app, not some other dev server on that port.

4. **Drive it in a real browser — a 200 response only proves HTML shipped,
   not that the app works.** Use the `playwright-cli` skill:
   ```bash
   playwright-cli open http://localhost:<PORT> --browser=chromium
   ```
   `--browser=chromium` is required on machines without a system Chrome
   install (`/opt/google/chrome/chrome` missing) — the default `--browser`
   choice will fail with a daemon error otherwise.

   Then, minimum interaction to prove the app is live and not a blank frame:
   - `playwright-cli snapshot` — find the onboarding modal's Skip button
     (`getByTestId('onboarding-skip')`) and click it.
   - Select a drawing tool (e.g. Rectangle) and drag on the map canvas
     (`mousemove` → `mousedown` → `mousemove` → `mouseup`) to draw a shape.
   - `playwright-cli screenshot` and **look at the image** — confirm the
     shape rendered geo-anchored on the MapLibre basemap and the Excalidraw
     style panel (stroke/background/etc.) appeared.
   - `playwright-cli close` when done.

   A console `favicon.ico` 404 is expected noise — the repo has no favicon
   wired up in dev. Don't treat it as a failure signal.

   `[eval: actually-interactive]` The verification includes a drawn,
   rendered shape on the map — not just a page-loaded screenshot of the
   onboarding modal.

## Input / Output Contract

- **Requires:** repo checked out at a path containing `code/` (yarn
  workspace root); network access only for the initial `yarn install`
  (offline afterward — bundled PMTiles basemap, no calls home); Bash for
  process launch, `ctx_execute`/`ctx_fetch_and_index` for HTTP checks per
  this project's context-mode routing rules, and the `playwright-cli` skill
  (with `--browser=chromium`) for interactive verification.
- **Produces:** a running Vite dev server process (backgrounded, log at a
  path you choose) serving the atlas-app editor SPA on whatever port Vite
  selected; a screenshot file showing a drawn, geo-anchored shape as proof
  of a working interactive session. No files in the repo are modified.

## Known-good reference run

Confirmed working 2026-07-18 on Node v24.14.0 / yarn 4.15.0: dependencies
were pre-installed, dev server landed on port 5175 (5173/5174 occupied by
unrelated local projects), HTTP 200 + `<title>Atlasdraw</title>` on curl,
and a dragged rectangle rendered correctly anchored over India on the
basemap with the style panel visible.
