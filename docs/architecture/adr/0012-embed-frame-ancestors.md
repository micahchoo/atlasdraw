<!-- ADR-0012-MARKER: embed-frame-ancestors -->

# ADR-0012: Embed Framing — CSP `frame-ancestors`, permissive default

- **Status:** Accepted
- **Date:** 2026-07-05
- **Phase:** post-v1.0 (D1 — read-only map embed)
- **Related:** ADR-0006 (telemetry / zero call-home), ADR-0008 (share-link encoding),
  DIVERGENCES.md D1, PRFAQ.md

## Context

The read-only map embed (`/embed…`, D1) is meant to be loaded in a cross-origin
`<iframe>` on a third-party page — a CMS, a blog, a docs site — the same way a
Google Doc or a Felt map embeds. For that to work, the served HTML must permit
being framed by other origins.

Browsers refuse cross-origin framing when the response carries a restrictive
`X-Frame-Options` or a CSP `frame-ancestors` directive. The probe
(`ledgers/PROBE-embed.md`) confirmed Atlasdraw serves **no** such header today
(nor COOP/COEP — SharedArrayBuffer is deliberately avoided precisely to keep
cross-origin embedding working, per phase-7 research notes), so framing already
works by default. What was missing is an operator **lever** to *restrict* who
may embed, without breaking the zero-config first run.

## Decision

Emit a `Content-Security-Policy: frame-ancestors <list>` header on the served
app HTML, at the Caddy edge (`infra/caddy/Caddyfile`, the `handle` block that
proxies the `web` container). The value comes from a new operator env var:

```
EMBED_FRAME_ANCESTORS   (default: *)
```

- **Default `*`** — any site may embed. Preserves the "paste one `<iframe>` and
  it just works" first-run story on a fresh `docker compose up`.
- **Tighten** to a space-separated origin allowlist to restrict, e.g.
  `EMBED_FRAME_ANCESTORS="https://yournewsroom.example"`.

### Why `frame-ancestors`, not `X-Frame-Options`

`X-Frame-Options` is binary (`DENY` / `SAMEORIGIN`) and **cannot express an
allowlist** of specific third-party origins — the exact thing a self-hoster who
wants "only my newsroom may embed" needs. CSP `frame-ancestors` takes a list.
We do **not** send `X-Frame-Options` at all (a stray `DENY` would silently break
every embed).

### Scope

The header applies to all HTML the `web` container serves, including the editor
at `/`. The editor is not *designed* to be framed, but framing it is harmless
and not worth a per-route header split at the edge. A CSP with only
`frame-ancestors` set imposes no other restriction (script/style/img default to
unrestricted), so it cannot break the app.

## Consequences

- Zero-config embedding keeps working; restricting is a one-line `.env` change.
- No app-code coupling: the policy lives entirely at the reverse-proxy edge.
  The dev server (`vite`) and the SPA `index.html` set no framing header, so
  local `/embed` development is unrestricted.
- A future managed/multi-tenant deploy that wants *per-map* embed allowlists
  would need a per-response header (app-side), not this single edge value — out
  of scope here and gated behind the (deliberately parked) multi-tenant work.

## Deferred

A scripts-blocked `<noscript>` PNG fallback for the embed (PRFAQ §Usable) is
**not** delivered by this ADR: a pure SPA can't render a per-route `<noscript>`
(the app never boots without JS). It needs SSR or a pre-rendered static embed
page — tracked in `BUILD-embed.md`.
