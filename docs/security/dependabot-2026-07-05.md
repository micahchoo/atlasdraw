# Dependabot re-triage — 2026-07-05 (embed-build gate check)

52 open alerts (up from 25 at the 2026-05-11 triage). Re-triaged as the
burning-platform gate before starting new feature work (read-only map embed).
The manifest distribution had shifted from the May picture (`code/dev-docs/`,
`code/examples/`) onto the shipped runtime manifests — so a fresh triage was
required rather than trusting the May conclusion.

## Criticals — all `vitest`, `development` scope → non-applicable (unchanged from May)

| GHSA | pkg | scope | why non-applicable |
|---|---|---|---|
| GHSA-5xrq-8626-4rwp (×9) | vitest | development | RCE only when the Vitest UI/API server is listening; config never enables it. Dev-only, not shipped. |
| GHSA-9crc-q9x8-hgqq (×4) | vitest | development | Same class — requires the API server + browsing a malicious site. Dev-only. |

No critical alert touches the deployed runtime surface.

## Runtime-scope highs — fixed this pass (version bumps via `resolutions`)

| GHSA | pkg | was → now | applicability | fix |
|---|---|---|---|---|
| GHSA-96hv-2xvq-fx4p | ws | `ws@^6.2.1` 6.2.3 → **6.2.4** | Real — memory-exhaustion DoS. The vulnerable ws is the **transitive 6.x** line; realtime's *direct* ws is already 8.x. | `resolutions: "ws@^6.2.1": "^6.2.4"` |
| GHSA-ph9p-34f9-6g65 | tmp | 0.2.5 → **0.2.7** | Conditional — path traversal only if user input reaches tmp prefix/postfix (storage does not). Direct dep of storage (`^0.2`). | `resolutions: "tmp": "^0.2.6"` |
| GHSA-vxpw-j846-p89q | undici | `^6.25.0` 6.26.0 → **6.27.0** | Likely N/A — undici WS-*client* DoS; server side doesn't use it. Transitive. | `resolutions: "undici@^6.25.0": "^6.27.0"` |

## Highs NOT actioned — non-applicable

- `vite` GHSA-fx2h-pf6j-xcff / GHSA-c27g-q93r-2cwf — dev-server, Windows-only.
  Production serves static `dist/` via nginx/Caddy, not the vite dev server.
- `form-data` GHSA-hmw2-7cc7-3qxx — development scope, transitive.

## Verification

`resolutions` added to `code/package.json`; `yarn install` swapped 3 packages.
Lockfile confirms `ws@^6.2.4 → 6.2.4`, `undici@^6.27.0 → 6.27.0`, `tmp → 0.2.7`.
Suites green after the bump: **storage 122/122, realtime 22/22 (real ws
connections in the shutdown tests), atlas-app 525/525** — each runner's own
exit code captured (not a pipe's).

## Follow-up (not this pass)

- The 20 medium + 8 low + remaining alerts (mostly `code/yarn.lock` transitive
  and vendored `dev-docs`/`examples`) were not individually re-triaged — the
  May "tolerated, vendored non-deployed surface" disposition still applies.
  A `yarn dedupe` pass to consolidate duplicate lock entries remains queued.
