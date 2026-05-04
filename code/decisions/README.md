# Atlasdraw Architectural Decisions

This folder contains:

- **Architecture Decision Records** (`NNNN-slug.md`): one file per significant architectural decision, in append-only sequence. Never renumber. New ADRs supersede prior ones via the `Status:` line. See [arc42 ADR template](https://adr.github.io/madr/).
- **`upstream-patches.md`**: register of every modification to vendored Excalidraw packages. Required by ADR 0004.
- **`open-questions-resolution.md`**: Q1–Q13 project-level decisions resolved before phase planning. Read this before re-debating those questions.
- **`escalations.md`**: blocking decisions surfaced from phase planning. Maintainers commit before downstream phases proceed.
- **`cross-phase-audit.md`**: post-shape-incorporation audit findings (mismatches, gaps).
- **`phase-N-research-notes.md`**: per-phase research audit trails answering open questions raised during plan writing.

## Reading order for new contributors

1. Start with `open-questions-resolution.md` — settled project decisions.
2. Read all ADRs in numeric order — concise reasoning per decision.
3. Skim `escalations.md` — what's still being decided.
4. When working in a specific phase: read that phase's research notes and the cross-phase-audit entries that cite it.

## Adding a new ADR

1. Pick the next sequential number (don't reuse).
2. Write the ADR using the standard template (Status / Context / Decision / Consequences / References).
3. Mark prior ADRs as `Superseded by NNNN` if applicable.
4. Update this README's table of contents (if we add one).
5. Discuss in PR; merge once accepted.

## Active ADRs (as of Phase 0)

- ADR 0001 — Fork vs Package
- ADR 0002 — License Split (AGPL/MPL/MIT)
- ADR 0003 — Coordinate System (Two Stacked Surfaces)
- ADR 0004 — Upstream Merge Policy
- ADR 0005 — SDK postMessage Contract (stub; finalized Phase 6)
- ADR 0006 — Telemetry Policy
- ADR 0007 — Yjs E2EE Threat Model (proposed; see escalations E-01)
- ADR 0008 — Share Token TTL
- ADR 0009 — Error Capture and Observability Baseline
