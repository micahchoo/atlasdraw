# Build brief — Read-only map embed (post-probe, rescoped)

**Pursue hand-off for DIVERGENCES.md D1.** Written 2026-07-05 as graft's exit:
building is a fresh session's job. This brief is self-contained — a session
with no prior context can execute it. Sources it consolidates: `PRFAQ.md`
(spec + product decisions), `ledgers/PROBE-embed.md` (what's proven / what's
deferred), `ledgers/PRFAQ-EMBED.md` (the four product decisions), and the
graft understand-phase seam map (cited inline as `file:line`).

Verify Excalidraw APIs against vendored source before use
(`.claude/rules/excalidraw-api.md`): `viewBackgroundColor` / `viewModeEnabled`
are **AppState** fields set via `initialData.appState`, never top-level props.

---

## Preconditions (the gate — clear before code lands)

Both are on HANDOFF.md's Next Steps and are cheap:

1. **Dependabot delta re-triage** — confirm the 25→52 alert growth still
   concentrates in non-deployed vendored surfaces and the runtime surface
   (storage, atlas-app, infra) carries zero applicable high/critical (prior
   triage: `docs/security/dependabot-2026-05-11.md`).
2. **Push `main`** — currently 4 commits ahead of `origin/main` (`0c42550`),
   unpushed. Plus these graft/probe docs are uncommitted.

---

## Corrected scope — what this actually is

**NOT** "reuse ShareView minus chrome." The probe proved `ShareView.tsx`
renders annotations on **opaque white** with no basemap (it drops
`manifest.basemap` + `manifest.camera`, no CoordinateSync — deliberately, per
its scrub note `ShareView.tsx:8-15`; verified in-browser: `hasMaplibreElement:
false`, corner pixel `[255,255,255,255]`).

A read-only **map** embed must build the full MapLibre stack that MapEditor
carries, in a chromeless read-only shell:

| # | Piece | Reuse from | Seam |
|---|-------|-----------|------|
| 1 | New `/embed/<token>` + `/embed#v1:<lz>` route | App.tsx `pickView()` `/m` handlers | `App.tsx:49-57` |
| 2 | `EmbedView` — two-layer stack: MapCanvas (z0) under a **transparent** Excalidraw (z1) | MapEditor's stack + `MapEditor.module.css` `.mapLayer`/`.excalidrawLayer` | `MapEditor.tsx:739-772`, `MapEditor.module.css:26-36` |
| 3 | Resolve the basemap from the doc | `getBasemap` + `useBasemapStyle(map, doc.manifest.basemap.id, allowRemoteBasemaps)` | `MapEditor.tsx:31,75,471`; MapCanvas default style is empty until this runs `MapCanvas.tsx:66-77` |
| 4 | Apply the authored camera | `doc.manifest.camera {center,zoom}` → `MapCanvas initialView` | `manifest-schema.ts:26-32,79`; `MapCanvas.tsx:113-129` |
| 5 | Keep annotations pinned on pan/zoom | `useCoordinateSync(map, api)` + `useGeoAnchor` | `MapEditor.tsx:508,516` — the exact thing ShareView's scrub note says was dropped |
| 6 | Transparent Excalidraw bg (so tiles show through) + strip view-mode chrome | `initialData.appState.viewBackgroundColor: transparent` (NOT `#ffffff`); pass `UIOptions` (contrast `EXCALIDRAW_UI_OPTIONS`) | `ShareView.tsx:206` currently paints white; `MapEditor.tsx:277,772` |
| 7 | Reuse doc-load verbatim | hash decode `ShareView.tsx:43-55,75-91` + token fetch `ShareView.tsx:57-61,101-116` | both work as-is for `/embed` |
| 8 | Standalone CSS side-effects | import `maplibre-gl.css`, `tokens.css`, `excalidraw-theme.css` (today only `main.tsx:4-11` does) | else map + banner render unstyled |
| 9 | Chrome config via **URL query params** (`?legend=`,`?attribution=`,`?lock=`) — NO postMessage API | new parsing in the `/embed` route | product decision: query params only (`ledgers/PRFAQ-EMBED.md` #2) |
| 10 | Embed snippet generator in ShareDialog | the `readonly-success` view (`share-dialog-url` input + `currentUrl` plumbing) | `ShareDialog.tsx:346-358,140-143` — "slot first", reuse the success surface |
| 11 | `frame-ancestors` header (tighten story) | `header Content-Security-Policy "frame-ancestors <list>"` in the existing Caddy block; new `EMBED_FRAME_ANCESTORS` env (default `*`); **never** `X-Frame-Options` | `infra/caddy/Caddyfile` (add to `{$PUBLIC_DOMAIN}` block); `infra/.env.example`. ADR it. |
| 12 | Graceful PNG fallback (`<noscript>`) | client-side pre-render at publish via `useExportPNG`, store as blob on the share record | **no headless renderer exists** — CLI `render` was never built (CLAIMS.md row 10) |

---

## What the probe PROVED (don't re-litigate)

- **Cross-origin embedding works with no postMessage/host handshake.** A
  read-only view rendered in a genuinely cross-origin iframe
  (`localhost:5199` in `127.0.0.1:8137`); zero postMessage from the frame.
  The read-only embed is genuinely un-conflated from the AtlasdrawAPI Q-P6-1
  cut (postMessage lives only in `packages/sdk`, never imported by the viewer).
- **Nothing the app serves blocks framing** — no `X-Frame-Options`, CSP,
  COOP, or COEP in any layer (Caddy, nginx Dockerfile, Fastify, vite,
  index.html). SharedArrayBuffer is deliberately avoided (phase-7 chose
  postMessage@30Hz to preserve embedding), so no cross-origin-isolation
  kill-switch. Framing is on by default; `frame-ancestors` is the *tighten*
  lever, not a prerequisite.

## What the probe DEFERRED — the build must verify these

The probe tested ShareView, which has **no map** — so these map-specific
cross-origin risks are still open and are the first things the build should
de-risk (a real MapCanvas in a cross-origin iframe):

1. **Tile / glyph / sprite CORS.** Remote basemaps fetch cross-origin from
   `tiles.openfreemap.org` (`openfreemap-bright.json:17-18`) and
   `protomaps.github.io` (`protomaps-light.json:10`). In a cross-origin iframe
   these are CORS-gated by the CDN. Verify they send `access-control-allow-
   origin`, or bundle/proxy tiles for the embed (the self-host PMTiles path
   already serves same-origin — likely fine there; the OpenFreeMap default is
   the risk).
2. **CoordinateSync standalone.** It's only ever run inside MapEditor with the
   tool overlay. Confirm it works read-only with no editing wiring.
3. **Camera-lock interaction model.** Decide pan/zoom disabled (`lock=1`) vs.
   free-but-reset; wire via MapLibre interaction handlers.

---

## Appetite — RE-ESTIMATE required

The PRFAQ's **~2 weeks was for the false small-wedge** (chrome-strip of
ShareView). The real build (rows 1–12 above, a MapLibre-stack graft + tile-CORS
resolution) is materially larger. Re-set the appetite before scoping the build
sprint — do not inherit the ~2wk figure.

## Product decisions carried forward (from `ledgers/PRFAQ-EMBED.md`)

- v0 = read-only + **URL-query-param** chrome config (no postMessage API).
- Framing posture = permissive default (`frame-ancestors *`), operator-tightenable.
- Monetization = **free everywhere, no metering** (drops PRD §10 "25k embed
  views" metric — recorded in PRFAQ "decided against").
- The AtlasdrawAPI / postMessage automation surface **stays cut** (Q-P6-1).
  Live-updating embed stays deferred; v0 is a read-only snapshot.
