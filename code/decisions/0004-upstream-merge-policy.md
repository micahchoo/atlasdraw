# ADR 0004: Upstream Merge Policy

**Status:** Accepted  
**Date:** 2026-05-03

## Context

Atlasdraw forks Excalidraw (ADR 0001). Without an explicit merge cadence and exit criteria, the team risks:

- Indefinite rebasing labor ("merge tax" growing each quarter)
- Abandoned patches accumulating silently
- Divergence so severe that future merges become impractical

A formal policy sets clear expectations and an exit ramp.

## Decision

**Adopt monthly merges from upstream/master**, conditional on three gates:

1. **Time gate** — Merge time ≤ 2 hours (measured wall-clock from start to merged commit)
2. **Quality gate** — No patch in `decisions/upstream-patches.md` has been broken more than once per quarter
3. **Contract gate** — Excalidraw's `customData` field on `ExcalidrawElement` is not removed or renamed

**Exit condition:** If any gate fails for two consecutive quarters, cease monthly merges and treat upstream as a one-time vendor. Pin the last-merged version and backport critical security patches manually.

**Enforcement:**
- CI guard: any PR touching vendored Excalidraw files without a corresponding entry in `decisions/upstream-patches.md` is rejected
- Quarterly review checkpoint (first Monday of Q)
- Merge branch: `upstream-merge/YYYY-MM`, tagged `upstream-merge-YYYY-Q`

## Consequences

### Positive
- Predictable merge burden and clear exit criteria
- Documented patches survive rebases
- Team has quarterly decision point to abandon merges if cost exceeds benefit

### Negative / Risks
- **Quarterly overhead** — ~2 hours per month = ~8 hours per quarter
- **Patch rot** — Patches may bitrot if not regularly tested
- **Upstreamcommit latency** — Monthly cycle means security fixes lag 1–4 weeks

**Mitigation:**
- `decisions/upstream-patches.md` lives in repo and is code-reviewed
- Quarterly review may accelerate merge frequency if patches are stable
- Emergency merges allowed outside cadence for critical CVEs

## References

- tech-spec.md §11 (fork maintenance)
- open-questions-resolution.md Q6 (fork governance)
- decisions/0001-fork-vs-package.md
