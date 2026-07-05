# ADR 0010: Own the Fork — Close Out Upstream Merge Policy

**Status:** Accepted **Date:** 2026-07-04 **Supersedes:** ADR 0004 (Upstream Merge Policy)

## Context

ADR 0004 (2026-05-03) committed to monthly merges from Excalidraw `upstream/master`, gated on merge time, patch breakage, and the stability of the `customData` contract, with an explicit exit clause: cease merging and treat upstream as a one-time vendor if the process failed.

Two months in, the revealed behavior is clearer than any gate:

- Zero `upstream-merge/YYYY-MM` branches exist. The monthly merge was never executed, not even once.
- `decisions/upstream-patches.md` still reads "(none yet)" while vendored packages have in fact diverged (geo scaleMode/strokeWidth changes, renderCustomUI export unification, and others).
- The CI guard mandated by ADR 0004 (`scripts/check-patches.sh` via `atlasdraw-checks.yml`) lives in `code/.github/workflows/`, which GitHub never executes — workflows only run from the repository root `.github/`. The enforcement mechanism was dead letter from day one.

Meanwhile the product direction (Atlasdraw cohesion work, 2026-07) requires changes that are fundamentally incompatible with cheap upstream merges: scope renames, owned component chrome, vocabulary changes, and vendoring of small rendering dependencies.

## Decision

**Invoke ADR 0004's exit clause. The fork is permanent and fully owned.**

1. Upstream Excalidraw is a one-time vendor. The last absorbed state is upstream v0.18.0. No further merges are planned. Critical upstream security fixes are backported manually, cherry-picked by hand.
2. The five vendored packages are renamed from `@excalidraw/*` to `@atlasdraw/*` (`excalidraw`, `element`, `math`, `common`, `utils`) and marked `"private": true`. The old names carried `publishConfig.access: public`, which was a standing namespace-collision hazard against the real upstream npm packages.
3. `decisions/upstream-patches.md` is closed. Divergence from upstream no longer needs per-patch bookkeeping — the fork is simply our code now. Deliberate design departures belong in ADRs like any other decision.
4. The `check-patches.sh` CI step is retired.

## Consequences

### Positive

- Unblocks the cohesion roadmap: scope unification, owned UI chrome, product vocabulary, dead-weight removal (`excalidraw-app/`, unused locales, upstream examples).
- Eliminates the npm publish collision hazard.
- Ends the fiction of a merge process nobody was running; no more dead policy contradicting actual practice.

### Negative / Risks

- Upstream improvements (perf, a11y, new tools) must be noticed and ported by hand, or foregone. Mitigation: keep `excalidraw-app/` or a pinned upstream remote available as a diff reference; watch upstream releases for security advisories specifically.
- Security patches in vendored code are now our responsibility alone. The dependency-risk review (2026-07-04) covers the adjacent npm-level story.

## Notes

- `LICENSE-EXCALIDRAW-UPSTREAM` and the README credits section remain — the rename changes ownership of maintenance, not attribution.
- Small upstream rendering deps (`roughjs`, `points-on-curve`, `perfect-freehand`) are candidates for vendoring under the same rationale; tracked separately, decided per-package when a change actually needs to touch them.
