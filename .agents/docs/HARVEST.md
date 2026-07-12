# HARVEST.md — Issue 2 claim-vs-reality session (2026-07-04)

Harvest pattern: session lessons → general rules → stored where they act.

| lesson | general rule | stored where |
|--------|--------------|--------------|
| CHANGELOG.md was the "reality source" for checking PHASES.md, yet itself made three false claims (a KML reader that doesn't exist, "pro/pro+=unlimited" when the quota schema can't even represent unlimited, "packages/* — MIT" when two are MPL-2.0). | In a claim-vs-reality diff, the reference document is also a claim surface — verify it against code before using it as ground truth. | `CLAIMS.md` rows 14–16 (pattern decision, in its ledger) |
| The false "render" claim lived in both README and package.json `description`; the false KML claim lived in README, a barrel comment, and CHANGELOG. Fixing only the README would have left the lie alive in two places. | When a doc claim is falsified, grep its literal repo-wide (README, package.json description, code comments, CHANGELOG) and fix every surface in the same commit-set. | `CLAIMS.md` rows 10, 14, 17 |
| Two usage snippets were nearly shipped with invented APIs (`projectPoint({lng,lat}, zoom)` — real signature is `(map, lng, lat)`; a `yarn workspace` CLI invocation that can't work because bin → TS source with no build). Caught only by grepping exports before commit. | Every code snippet in a doc is a new claim: verify each symbol and command against actual exports/scripts at write time, or the drift fix becomes the next drift. | HARVEST.md + widened trigger in `.claude/rules/excalidraw-api.md` |
| The tools README's "registered as Excalidraw customType tools" was the 4th logged instance of the plan-literal-vs-v0.18 failure mode — this time in a README, a surface the existing rule didn't name. | Rules should name every surface their failure mode has actually appeared on; a rule scoped to "plans and briefs" silently exempts READMEs. | `.claude/rules/excalidraw-api.md` (trigger widened, instance logged) |

## Session outcome

- **Ran:** Issue 2 (`claim-vs-reality diff`), `/github-readme` as reference.
  Ledger: `CLAIMS.md` — 19 rows (17 from the diff, 2 more from the recheck
  sweep: sdk's stale "lands in Phase 6", protocol's missing README), all
  fixed and rechecked. Done-when met: final re-diff finds nothing.
- **Commits:** 11 on branch `docs/claims-vs-reality` (branched from
  `security/managed-mode-trust-boundary` HEAD to keep doc commits out of the
  security branch).
- **Not touched (deliberate):** Pro/Pro+ tier differentiation (Direction 5 —
  maintainer decision), KML/GPX implementation (docs now say "not
  implemented" instead), god-module and journey issues (Issues 3–8 still
  open in ISSUES.md).

---

# HARVEST.md — Issue 1 security sweep session

Harvest pattern: session lessons → general rules → stored where they act.

| lesson | general rule | stored where |
|--------|--------------|--------------|
| Four in-code comments described tenant-isolation enforcement as if it existed ("DB-backed validation lives in Wave 3 A13b", "SaaS deployments rely on workspace ACL at the path-routing boundary") when it was never built. A reader trusts the comment and assumes the boundary is real. | A security comment must describe what the code *does*, never what a deferred plan *would* do. If enforcement is absent, say "NOT enforced" — a comment that names a future wave reads as "handled." | `.claude/rules/managed-mode-tenancy.md` (new, scoped to storage+realtime) + `docs/security/managed-mode-trust-boundary.md` |
| Managed mode (`MANAGED_MODE=true`) is a shipped flag whose isolation is advisory, not enforced. Maintainer chose self-host-only posture: document + gate, don't build ACLs. | Managed-mode routes are not multi-tenant-safe; keep the flag off by default, warn at boot, and don't present the surface (workspace columns/header/quotas) as isolation. | Project memory (`managed-mode-not-tenant-safe`) + trust-boundary doc |
| `yarn workspace @atlasdraw/storage test:typecheck` reports 13 pre-existing errors (Fastify-v5 generic variance on route registration; `better-sqlite3` `Database` namespace-as-type) on a clean HEAD, despite the last commit claiming "green the full monorepo suite." | Verify a claimed-green gate at the workspace level, not just via the root aggregate — the root script may exclude or not surface per-workspace `tsc` failures. | Surfaced to maintainer below; not a rule (needs a decision on whether root CI actually covers storage typecheck). |
| The relay's Yjs data-layer + comments docs are plaintext (ADR-0010 Option C, intentional); only Socket.IO scene/comment payloads are E2EE. Easy to overstate "collaboration is encrypted." | When reasoning about relay confidentiality, separate the E2EE Socket.IO channel from the plaintext Yjs channel — they have different guarantees. | trust-boundary doc (row 3) |

## Session outcome

- **Ran:** Issue 1 (`sweep-triage-fix-resweep`). Sweep found 9 findings (3 HIGH,
  4 MED, 2 LOW) + 5 verified-clean areas. Ledger: `SECURITY.md`.
- **Fixed (document+gate, self-host-only verdict):** rows 1–4, 8, 9 — commit
  `d51c774` on branch `security/managed-mode-trust-boundary`.
- **Still open (mode-independent, need a separate verdict):** rows 5 (Socket.IO
  CORS/DoS), 6 (relay not behind Caddy/TLS), 7 (no storage rate limiting).
  These harden even a single-tenant self-host exposed to the internet, so the
  self-host-only decision does not dispose of them.
- **Loop status:** not fully closed — the done-when ("every finding ≥ floor
  clean") awaits a floor/verdict on rows 5–7.
