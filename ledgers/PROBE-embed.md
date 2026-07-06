# Ledger — thin-slice probe: D1 read-only map embed

Loop: `thin-slice probe` (graft convergence). Branch `probe/embed`, flag
`embed_v0`. Started 2026-07-05 from `probe/embed` off main `0c42550`.
Spec: `PRFAQ.md`. Divergence: `DIVERGENCES.md` D1.

**Kill criterion (declared BEFORE any probe code — immovable):**
> Killed if rendering ShareView inside a **cross-origin** iframe *requires* a
> postMessage/host-API handshake to **function** (not merely to be nicer) —
> that would prove Q-P6-1 right to cut the read-only embed together with the
> AtlasdrawAPI. **Also killed** if iframe-embedding can't be made safe without
> response-header control the default `docker compose up` self-host story
> can't provide.

The slice exists to settle the riskiest assumption, not to preview the
feature. Shortcuts allowed everywhere the assumption isn't. The slice NEVER
merges in this run: on `pursue` it hands to a build session with this ledger;
on `kill` the branch is deleted and the criterion recorded met.

## Assumptions

| # | assumption | riskiest? | probe | result | verdict |
|---|-----------|-----------|-------|--------|---------|
| A1 | ShareView renders the actual **MapLibre basemap**, not just the Excalidraw annotation layer on a blank background | build-load-bearing (under-weighted in the kill criterion — see Lesson) | understand-phase code-read (2 agreeing readers) + my read of ShareView.tsx:202-208 + in-browser pixel sample | **FALSE.** ShareView returns only `<Excalidraw viewModeEnabled>` with `viewBackgroundColor:"#ffffff"`; ignores `doc.manifest.basemap` + `doc.manifest.camera`; no CoordinateSync (scrub note ShareView.tsx:8-15). In-browser: `hasMaplibreElement:false`, corner pixel `[255,255,255,255]` opaque white. | **CONFIRMED FALSE** — falsifies the "≈90% built / smallest wedge" cost premise |
| A2 | ShareView **renders in a cross-origin iframe** with NO postMessage/host handshake to function | **RISKIEST — the kill criterion** | served app `localhost:5199` framed inside host page `127.0.0.1:8137` (diff host+port), loaded `/m#v1:<doc>`, observed render + console + host postMessage listener | ShareView rendered: `excalidrawRoot:true`, 2 canvases, 325 non-white px (annotations drew). Zero postMessage from the frame; host listener got nothing. No handshake needed. | **SURVIVES** (verified in-browser) |
| A3 | Nothing the app serves blocks framing; frame-ancestors is settable in the `docker compose up` (Caddy) path | **RISKIEST — 2nd kill criterion** | header grep across all layers (understand phase) + observed whether the frame loaded | No X-Frame-Options / CSP / COOP / COEP anywhere (Caddy, nginx Dockerfile, Fastify, vite, index.html). SharedArrayBuffer deliberately avoided (phase-7 chose postMessage@30Hz to preserve embedding). Frame loaded first try. `header` directive addable in existing `infra/caddy/Caddyfile`. | **SURVIVES** (verified in-browser + code) |
| A4 | Map **tiles + glyphs + fonts** load inside the cross-origin iframe | high | observed network/console in the framed embed | N/A for ShareView (no tiles on this path). Only failure = the known dev-only Virgil/Excalifont woff2 404 from esm.sh (JOURNEY.md:35) — non-fatal (FontFace display:swap → system font), NOT iframe-specific. Tile-CORS for a *real* map embed is unverified (ShareView has no map) — flagged for the build. | **SURVIVES** (ShareView path); tile-CORS **deferred** to build |
| A5 | The read-only embed needs **no AtlasdrawAPI / postMessage automation surface** (Q-P6-1's actual target) | medium (premise) | code-read + in-browser: confirmed zero postMessage in runtime path (only in `packages/sdk`, which ShareView never imports) | Confirmed — no host API needed; the read-only view is genuinely un-conflated from the cut AtlasdrawAPI. | **SURVIVES** (confirms the divergence's core premise) |

## Build log

**No production code written.** The truest thin slice: a scratch cross-origin
host page (`scratchpad/host.html` on `127.0.0.1:8137`) embedding the **existing**
`/m#v1:<doc>` ShareView route (`localhost:5199`) in a real `<iframe>`. Doc minted
via the app's own lz-string (`scratchpad/gen-embed-probe.cjs`), a rectangle + text
annotation authored against basemap `protomaps-light` @ SF/z12. Artifact:
`scratchpad/embed-probe.png`. `probe/embed` branch carries zero commits.

## Verdict — technical kill criterion SURVIVED; cost premise FALSIFIED

**Against the immovable kill criterion, the probe SURVIVES both axes:** cross-origin
embedding works with no postMessage/host handshake (A2), and framing is unblocked +
controllable in the `docker compose up` path without header control the default
can't provide (A3). The cross-origin technical risk — the thing I declared worth
probing — is **real-but-surmountable, proven in a browser.**

**But the probe falsified the belief that ranked D1 as "top bet / smallest wedge /
~2 weeks":** ShareView is an **annotations-on-white viewer, not a read-only map
view** (A1). A real read-only *map* embed is not "ShareView minus chrome"; it is
ShareView **plus the entire MapLibre stack** MapEditor carries — MapCanvas +
`getBasemap`/`useBasemapStyle` resolution + `manifest.camera` application +
transparent Excalidraw background + `useCoordinateSync` + geo-anchor rehydration
(the exact things ShareView's scrub note says were deliberately dropped). That is
most of MapEditor's hard parts, not a two-week chrome-strip.

**Net verdict: FEASIBLE (pursue-able) but RE-SCOPE + RE-RANK required.** The embed
is still valuable and now proven technically embeddable, but it is a substantially
larger build than PRFAQ.md specced. It cannot hand to a build session as "≈90%
built." D1 → status `rescope`; re-rank vs D2 on a betting table before committing.

**Lesson (the walking skeleton):** the probe earned its keep — a scratch HTML page
and one existing route falsified a "90% built" belief before a 2-week build
committed to it, *and* de-risked the genuine cross-origin unknown. Also: my declared
kill criterion was **too narrow** — it tested "does ShareView render cross-origin"
while silently assuming ShareView renders a map. The riskiest assumption was
actually A1 (the reuse premise); the understand phase caught it before any code. A
kill criterion that bakes in an unverified premise ("reuse X") tests the wrong
thing — name the premise as its own assumption. Kill criterion was NOT moved.
