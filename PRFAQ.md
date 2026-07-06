# PR-FAQ — Read-only map embed

Working-backwards spec for DIVERGENCES.md **D1**. Written from the
`pr-faq interview` convergence loop (ledger: `ledgers/PRFAQ-EMBED.md`),
2026-07-05. This document is a spec, not code. Building is gated — see
DIVERGENCES.md §Gate and the Feasible FAQ below.

Appetite: **~two weeks** (set before scoping). If the work can't fit that, the
wedge is bigger than the evidence claims — and that itself is the finding.

---

## Press release

**Atlasdraw maps now embed anywhere — one `<iframe>`, no per-pageview bill.**

Until today, finishing a map in Atlasdraw meant the last mile happened
*outside* the app. You'd export a flat 2× PNG and drop the image into your CMS
— losing the pan, the layers, the crispness — or paste a share link that
opened the whole editor, chrome and all, in your reader's face. The one thing
the product promised at the top of its own vision — *"a map as easy to embed
as a Google Doc"* — was the one thing you couldn't do.

Now you can. Open any shared map, click **Embed**, and copy a two-line
`<iframe>` snippet. Paste it into your CMS, your docs site, your blog. Your
reader sees a live, camera-locked Atlasdraw map — your basemap, your data
layers, your hand-drawn annotations — rendered right in the page. Toggle the
legend, move the attribution, or lock the camera with plain URL parameters.
No account. No API to learn. No script that phones home. And because
Atlasdraw is self-hostable and AGPL, there is no per-pageview meter waiting to
bill you when your story goes viral — on your instance or the hosted flagship,
embed views are free, uncounted, forever.

For Priya, the data journalist who ships two to four map stories a month, this
closes the loop the tool was built to close: import a CSV, draw the story,
share a draft, and *publish* — all in Atlasdraw, all in an afternoon.

---

## The customer & the struggling moment

- **Customer:** Priya, the data journalist (PRD Persona A). Reports for a
  regional newsroom, ships 2–4 map stories a month, needs a responsive map in
  her CMS without ArcGIS/Mapbox billing surprises.
- **Struggling moment:** she has a finished map and a deadline, and no way to
  put it on the web *as a map*. Today's workaround is a static 2× PNG export —
  the exact "screenshot of QGIS anti-pattern" the PRD rails against (§2, §49)
  — or a raw share link that opens the full editor chrome instead of a clean
  embed. Evidence: PRD §4 JTBD #3, §8 Flow 3; README "out of scope for 1.0";
  `packages/sdk` is a 5-line stub.
- **Why this is the wedge, not a scope-creep:** the v1.0 embed was cut by
  `Q-P6-1` (`docs/superpowers/plans/2026-05-15-atlasdraw-phase-6-amended-scope.md`).
  That cut's own rationale targets the **AtlasdrawAPI / postMessage automation
  surface** — "not a Felt-compatible product… does not ship a third-party
  automation API." Correct call. But a **read-only iframe of a finished map**
  is a different, far smaller thing that got swept out by conflation, never
  judged on its own. This spec un-conflates them.

---

## The one-sentence announcement

> Atlasdraw maps now embed anywhere — paste one `<iframe>` and your live,
> camera-locked map renders in any page, self-hosted, with no per-pageview bill.

---

## FAQ — the four risks

### Valuable? (is this worth a customer's attention)

Yes, and the evidence is the product's own foundations. Embedding is wedge
point **(f)** in PRD §6 — "the only tool that is *all* of (a)…(f)… The
intersection is empty. That's the product." It is the closing third of the
three dominant JTBDs (§4 #3, *present-and-embed*). It is the entire second
half of Persona A's reason to adopt. The current behaviour — export a dead
PNG — is a workaround the PRD explicitly names as an anti-pattern, which is
demand written in behaviour rather than in a feature request.

### Usable? (what's the aha moment, how fast)

**Aha:** paste one `<iframe>` line into a CMS draft, hit preview, and a live
map appears — pan-crisp, legend and all — where a flat screenshot used to be.

**Time-to-aha:** seconds. The snippet is copy-button-adjacent to the share
link Priya already generates in **ShareDialog**; we add an *Embed* section
beside it. Configuration is plain URL params (`?legend=0&attribution=br&lock=1`)
— discoverable, no API, no docs-deep-dive. Graceful PNG fallback means the
embed still shows *something* even in a CMS that strips scripts.

### Feasible? (blast radius, and the load-bearing belief)

> **⚠ PROBE CORRECTION (2026-07-05, `ledgers/PROBE-embed.md`).** This section's
> "~90% built / reuse ShareView" claim was **falsified by the probe.** ShareView
> renders *annotations on opaque white*, not a map — it drops `manifest.basemap`
> and `manifest.camera` and has no CoordinateSync (verified in source and
> in-browser). A read-only *map* embed must add the whole MapLibre stack
> (MapCanvas + basemap resolution + camera + transparent background +
> CoordinateSync + geo-anchor rehydration) — most of MapEditor's hard parts.
> The cross-origin/framing risk below **is** confirmed surmountable. Net:
> feasible, but **not the ~2-week chrome-strip specced here** — re-scope. The
> appetite line's own hedge fired: "If the work can't fit that, the wedge is
> bigger than the evidence claims — and that itself is the finding."

Originally believed small because the wedge was thought ~90% built:

- **Reuse, don't rebuild.** `ShareView.tsx` already renders a chromeless
  read-only canvas (`<Excalidraw viewModeEnabled/>` + not-found/expired/error
  states). ADR-0008 already defines share-link encoding (URL-hash + server
  token). `App.tsx` already routes `/m/<token>` and `/m#v1:<encoded>` to
  ShareView with a hand-rolled path detector.
- **What's actually new (the two-week scope):**
  1. A new `/embed/<token>` (and `/embed#v1:<encoded>`) route → a thin
     `EmbedView` that wraps ShareView's render with *all* outer app chrome
     stripped and reads chrome/camera-lock config from URL params.
  2. Camera lock to the saved manifest bounds (disable pan/zoom when
     `lock=1`); responsive auto-fit to the iframe box.
  3. An **Embed** section in `ShareDialog` that generates the `<iframe>`
     snippet (width/height/`loading="lazy"`) from the active share token.
  4. **Iframe-safe serving:** the embed route must send
     `Content-Security-Policy: frame-ancestors …` and must *not* send
     `X-Frame-Options: DENY`. New operator env var `EMBED_FRAME_ANCESTORS`
     (default `*`), threaded through the storage token-resolution response and
     the infra Caddy config. New ADR records the trade-off.
  5. **Graceful PNG fallback:** there is **no headless renderer** — the CLI
     `render` command was never implemented (CLAIMS.md row 10). So the
     fallback PNG is generated **client-side at embed-publish time** (reuse
     `useExportPNG`) and stored as a blob referenced by the share record, then
     served inside a `<noscript>`. This is the one genuinely new data path.
- **No new package. No postMessage API. No storage schema migration** beyond
  an optional fallback-PNG blob ref on the existing share record.

**The load-bearing belief (carried forward as the probe's kill criterion,
immovable):** that ShareView renders correctly inside a **cross-origin
iframe** *without* a postMessage/host-API handshake to function. If it turns
out the read-only canvas can't run embedded without that handshake — the very
thing Q-P6-1 cut — then the cut was right to treat them as one piece, and this
dies. The `thin-slice probe` (DIVERGENCES.md D1) exists to settle exactly
this before the two-week build starts. Second kill: if iframe-embedding can't
be made safe without response-header control a default `docker compose up`
can't provide, we ADR the trade-off rather than ship a footgun.

### Viable? (what it costs us to run and to charge)

Cheap to run, and we charge nothing. The embed is a **free feature in the
AGPL core** — no open-core split (PRD §11). No metering, no view counting,
**even in hosted mode** — consistent with ADR-0006 (zero telemetry, no
call-home) and Principle #5 ("No surprise bills"). Serving cost is a static
asset plus the token resolution the instance already performs. The only real
cost is maintainer time (the two-week appetite) and a new security surface
(cross-origin framing), mitigated by the permissive-default-plus-operator-
allowlist posture and its ADR.

---

## What we deliberately decided against

- **The AtlasdrawAPI / postMessage automation surface** (Q-P6-1's real
  target) stays cut. Configurable chrome is **URL query params**, not a JS
  API. No surface freeze, no third-party automation contract.
- **A live-updating embed.** v0 is a read-only snapshot of the shared doc.
  Making the iframe a live collab client is deferred — larger surface, not
  needed to close JTBD #3.
- **Embed-view metering, and PRD §10's "25,000 unique embed views" success
  metric.** Dropped in favour of zero-telemetry purity (operator choice this
  interview). *This revises a PRD metric* — flagged here rather than silently.
  If the project ever wants embed reach as a KPI, it needs a privacy-preserving
  measure that doesn't violate ADR-0006, which is its own decision.
- **Same-origin-default and per-share-allowlist framing postures.** Rejected
  in favour of permissive-default: same-origin breaks the "paste in my CMS"
  first-run story; per-share allowlist pushes toward the heavier, deliberately-
  parked managed-mode control plane.

---

## Status & next step

- DIVERGENCES.md **D1 Status → `spec'd`** on this document.
- **Next:** the gated `thin-slice probe` (`probe/embed`, flag `embed_v0`) to
  settle the load-bearing belief above — gated on the convergence clears
  (Dependabot delta re-triage + `main` pushed; DIVERGENCES.md §Gate). On a
  `pursue` verdict, this PRFAQ + the probe learnings hand to a fresh **build**
  session; building is not graft's job.
