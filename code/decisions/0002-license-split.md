# ADR 0002: License Split (AGPL/MPL/MIT)

**Status:** Accepted  
**Date:** 2026-05-03

## Context

Atlasdraw must balance two tensions:

1. **Protect against SaaS resale** — AGPL-3.0 prevents proprietary SaaS competitors from reselling the product unmodified
2. **Enable library adoption** — MIT permits closed-source embedding, maximizing developer reach and ecosystem integration

A monolithic AGPL license deters SDK adoption; monolithic MIT lets hyperscale SaaS resellers sell the product and contribute nothing back.

## Decision

Adopt a **three-tier license split** by package type:

- **AGPL-3.0** — `apps/atlas-app`, `apps/realtime`, `apps/storage` (the running app and its servers)
- **MIT** — `packages/sdk`, `packages/cli`, `packages/geo`, `packages/data` (libraries and tools)
- **MPL-2.0** — `packages/basemap`, `packages/tools` (bridges between domains)

Each `package.json` declares `"license"` field. CI fails if omitted. Plain-English examples in `LICENSING.md` clarify rules for common scenarios (embedding, modification, SaaS).

## Consequences

### Positive

- SDK users can embed in closed-source products without licensing friction
- Server operators must publish improvements (AGPL copyleft)
- Clear policy reduces legal ambiguity

### Negative / Risks

- **Confusion risk** — Developers may misunderstand which license applies to their use case
- **Dual-license enforcement** — CI requires vigilance to prevent accidental relicensing

**Mitigation:**

- `LICENSING.md` includes worked examples for common scenarios
- License field validation in PR checks
- Developer guide clarifies: embedding read-only SDK in closed-source = permitted; modifying server and exposing as SaaS = must open-source modifications

## Amendments

- ADR-0013 (`docs/architecture/adr/0013-self-host-only.md`): Atlasdraw is self-host only. There is no official hosted offering.
- ADR-0016 (`docs/architecture/adr/0016-sdk-removed-cli-deferred.md`): `packages/sdk` is deleted. Read-only embedding uses the `/embed` route.
- 2026-10-01: `packages/protocol` (MIT) and the vendored `packages/utils` (MIT) are in `LICENSING.md`. `scripts/check-license.sh` checks the license fields, and the CI `check` job runs it. Since 2026-10-01 it also fails on a workspace package its map does not name; `apps/storage` and `packages/protocol` had gone unchecked that way.

## References

- PRD §11 (licensing principles)
- tech-spec.md §11 (implementation scope)
- open-questions-resolution.md Q5 (license trade-off resolution)
