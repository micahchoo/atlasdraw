# Boot payload audit — atlas-app

Date: 2026-09-13.

> **Update (2026-10-01).** The numbers below are from 2026-09-13 and were not
> measured again. Three things changed since: `ShareView` and `BillingPage`
> are deleted (`App.tsx` lazy-loads two route roots, `MapEditor` and
> `EmbedView`); `socket.io-client` is gone; and `y-websocket` is imported by
> `state/room.ts`, which the editor imports. The cache policy and
> the four serving surfaces are unchanged
> (`.claude/rules/static-serving-cache-policy.md`).
Method: checked atlas-app's build and serving config against the ranked fix
list at `https://makefaster.dev/data/improvements.json` (67 fixes, 1343
applications). Rank numbers below refer to that list.

Read the list as an ORDERING, not as a promise. `count` is how often people
applied a fix, not how often it worked, and the millisecond figures are
averages over other sites with other baselines.

Measured on a fresh `yarn workspace @atlasdraw/atlas-app build` (2026-09-13,
exit 0). Byte-identical to the 2026-08-01 build already in `dist`:

| asset                      | raw       | gzip -9   | brotli -11 | zstd -19  |
| -------------------------- | --------- | --------- | ---------- | --------- |
| `index-*.js` (entry)       | 4308.7 KB | 1329.9 KB | 1057.9 KB  | 1107.8 KB |
| `subset-shared.chunk-*.js` | 1781.1 KB | 726.1 KB  | 589.5 KB   | 619.8 KB  |
| `index-*.css`              | 315.2 KB  | 48.4 KB   | 37.0 KB    | 38.7 KB   |

Total JS + CSS in `dist`: 11.0 MB raw.

## Three serving surfaces

1. GitHub Pages — `.github/workflows/pages.yml`, `VITE_BUILD_TARGET=pages`.
2. Vercel — `code/vercel.json`.
3. Self-host — Caddy (`infra/caddy/Caddyfile`) in front of nginx
   (`code/apps/atlas-app/Dockerfile`, runtime stage).

A finding applies to all three unless the text says otherwise.

## Gaps

### Rank 8 — Content-hashed immutable assets (−48.6 %). MISSING.

Vite already emits content-hashed filenames (`index-Ck_XkL-E.js`). No surface
tells the browser those names are immutable:

- nginx sets `Cache-Control` for `/data/` only. `/assets/` gets no
  `Cache-Control`, so every load revalidates.
- `vercel.json` sets `max-age=31536000` for `*.woff2` only.

DONE (2026-09-13). `code/apps/atlas-app/nginx.conf` (new file, replacing the
`printf` heredoc in the Dockerfile) and `code/vercel.json` both now send
`public, max-age=31536000, immutable` for `/assets/`. The `*.woff2` rule in
`vercel.json` was deleted: every font Vite emits lands in `assets/`, so the
new rule subsumes it with a stronger value.

### Rank 3 — Short freshness window for HTML (−43.7 %). MISSING.

`index.html` carries no explicit `Cache-Control` on any surface. Browsers then
apply heuristic freshness (about 10 % of the `Last-Modified` age), so a stale
`index.html` can point at hashed chunks that a later deploy removed.

DONE (2026-09-13), in the same change as rank 8 — the two are one policy.
`no-cache` on the document, on both surfaces. GitHub Pages takes no header
config, so the demo site keeps its fixed `max-age=600` and is unaffected.

Verified against real nginx (`nginx:alpine`, the built `dist`, the new conf):

| request                     | status | `Cache-Control`                       |
| --------------------------- | ------ | ------------------------------------- |
| `/`                         | 200    | `no-cache`                            |
| `/index.html`               | 200    | `no-cache`                            |
| `/some/deep/spa/link`       | 200    | `no-cache`                            |
| `/assets/index-B_Pv2rd-.js` | 200    | `public, max-age=31536000, immutable` |
| `/assets/does-not-exist.js` | 404    | (none)                                |
| `/data/places-index.json`   | 200    | `public, max-age=2592000`             |

The 404 row is the one worth keeping: `/assets/` uses `try_files $uri =404`,
not the SPA fallback, so a missing chunk fails as a 404 instead of returning
HTML under a `.js` URL.

### Rank 2 and 4 — Lazy-load components / cut critical-path JS. DONE.

`grep -c "lazy("` over `apps/atlas-app/src` returns 0. There is no runtime
`await import()` outside tests. The result is one 4.3 MB entry chunk
(1.06 MB brotli) that every visitor downloads, whatever they came for.

`App.tsx` statically imports all four route roots: `MapEditor`, `ShareView`,
`EmbedView`, `BillingPage`. Split candidates, in descending confidence:

- `pdf-lib`, reached through `ExportDialog` → `lib/print-pdf.ts`. Export is
  behind a menu click.
- `BillingPage` — managed mode only, `/billing` route.
- `MaputnikDialog`, `SettingsDialog`, `AboutDialog`, `ExportDialog` — all
  click-gated, all imported at `MapEditor` top level.
- `socket.io-client` (`state/sceneChannel.ts`) and `y-websocket`
  (`state/comments.ts`) — needed only when realtime is on, and
  `VITE_REALTIME_ENABLED` defaults to false.

Cheapest first cut: route-level split in `App.tsx`. An `/embed` or `/m`
visitor does not need the editor; an editor visitor does not need the other
three.

### Rank 1 — Precompress static assets (−36.1 %). DONE (gzip).

`dist` holds zero `.br` or `.gz` siblings.

- Caddy compresses at request time (`encode zstd gzip`) at default quality —
  it pays CPU per request and does not reach brotli-11.
- The nginx runtime stage has neither `gzip` nor `gzip_static`. A client that
  reaches nginx directly (`web:3000`, no Caddy) downloads 4.3 MB raw.
- GitHub Pages applies gzip automatically. No brotli.

Brotli-11 siblings save 272 KB against gzip-9 on the entry chunk alone, and
about 410 KB across entry plus shared chunk. Emit siblings at build time, then
turn on `gzip_static` in nginx and `precompressed` in Caddy's file server.

### Rank 6 and 38 — Critical HTML shell / paint a fallback frame. DONE.

`index.html` ships an empty `<div id="root">`. The screen stays blank until the
entry chunk parses and React mounts. A static shell inside `#root` — map frame
and toolbar silhouette — costs only inline bytes. Do this last: it touches the
Excalidraw mount.

## Already correct

- Fonts (ranks 5, 21, 33): Excalifont and Xiaolai are self-hosted and already
  split by `unicode-range` in the vendored package. Vercel caches woff2 for a
  year.
- Competing preload hints (rank 12): `index.html` emits none.
- `world-low-zoom.pmtiles` (44 MB): MapLibre range-fetches it, and nginx
  already sets `max-age=2592000` on `/data/`.

## Result, measured

All four steps shipped 2026-09-13. Numbers below are Chromium against the
built `dist` served by the real `nginx.conf`, counting `/assets/` + the
document and excluding basemap fonts and the range-fetched `.pmtiles`.

| route                              | before                 | after            |
| ---------------------------------- | ---------------------- | ---------------- |
| editor (`/`), as nginx served it   | 4625 KB (uncompressed) | **1203 KB**      |
| editor (`/`), at equal compression | 1379 KB gzip           | **1203 KB** gzip |
| `/embed`                           | same 4625 KB / 1379 KB | **1037 KB**      |

Read the two editor rows carefully, because they measure different things.

The second row is the honest code-splitting number: **−13 %**. The editor
genuinely needs Excalidraw and MapLibre, and no amount of splitting removes
them from the editor's own boot path. What splitting actually bought is
narrower: `ExportDialog` and the `pdf-lib` tree behind it (517 KB raw) now
load on click instead of on boot, the CSS bundle fell from 315 KB to 73 KB as
route CSS split off, and `/embed` no longer drags in the editor.

The first row is larger — **−74 %** — and most of that is not code splitting
at all. It is rank 1: nginx previously served everything uncompressed, so a
client reaching it without Caddy in front downloaded 4.3 MB of raw JavaScript.
`gzip_static` is doing that work, not `React.lazy`.

Chunk shape after the split:

| chunk                                     | raw                      |
| ----------------------------------------- | ------------------------ |
| entry `index-*.js`                        | 247.5 KB (was 4308.7 KB) |
| `MapEditor-*.js`                          | 376.7 KB                 |
| `ExportDialog-*.js` (holds `pdf-lib`)     | 517.1 KB                 |
| `ShareView` / `EmbedView` / `BillingPage` | 2.0 / 3.4 / 4.4 KB       |
| `Settings` / `About` / `Maputnik` dialogs | 5.4 / 3.8 / 3.1 KB       |

The entry chunk falling 4308.7 → 247.5 KB looks like the headline and is not
one: the shared Excalidraw + MapLibre code moved into a chunk the editor route
still pulls immediately. Quoting the entry number alone would overstate the
win by roughly six times.

Build emits 138 `.gz` siblings, 11.4 MB → 3.6 MB.

Verified on both routes: the boot shell is dismissed, `#root` renders, zero
page errors. Gate: `tsc --noEmit` clean, eslint clean, prettier clean,
1022/1022 vitest tests pass.

## Still open

- **Brotli.** `.br` siblings would save a further ~270 KB on the shared chunk,
  but nothing here can serve one: `nginx:alpine` has no `ngx_brotli`, Caddy
  reverse-proxies rather than serving files, and Vercel and Pages compress on
  their own. Needs a brotli-capable image or moving static serving to Caddy's
  `file_server`. Not built, because it would have no consumer.
- **`y-websocket`** loads with the editor even when rooms are off. It is
  imported by `state/room.ts`. (`socket.io-client` was removed on
  2026-10-01.)
- The shared chunk is named `lz-string-*.js` after an incidental module while
  holding Excalidraw and MapLibre. Cosmetic, but it misleads anyone reading a
  waterfall.

## Open — a fourth serving surface

`code/Dockerfile` also builds an nginx image from the same `dist`, and it is
the one CI publishes (`ghcr.io/micahchoo/atlasdraw:latest`, from
`publish-docker.yml`, context `./code`). `code/apps/atlas-app/Dockerfile` — the
one this audit examined and fixed — is used only by
`infra/docker-compose.yml`.

The published image ships stock nginx config: no cache headers, and no SPA
fallback either, so a deep link 404s there. Fixing its headers means deciding
the fallback question at the same time, which is a behaviour change, not a
header change. Left alone deliberately. The new `nginx.conf` is reachable from
that build context as `apps/atlas-app/nginx.conf`, so adopting it is one
`COPY` line once someone decides the two images should agree.

`code/vercel.json` has no `rewrites`, so SPA deep links likely 404 on Vercel
too. Same class of gap. Not touched.
