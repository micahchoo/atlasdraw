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
