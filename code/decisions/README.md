# Atlasdraw Architectural Decisions

This folder contains:

- **Architecture Decision Records** (`NNNN-slug.md`): one file per significant architectural decision, in append-only sequence. Never renumber. New ADRs supersede prior ones via the `Status:` line. See [arc42 ADR template](https://adr.github.io/madr/).
- **`upstream-patches.md`**: register of modifications to the vendored Excalidraw packages, kept while ADR 0004 applied. ADR 0010 ended the merge policy; `git log -- code/packages` is the full record now.
- **`open-questions-resolution.md`**: Q1–Q13 project-level decisions resolved before phase planning. Read this before re-debating those questions.
- **`escalations.md`**: blocking decisions surfaced from phase planning. Maintainers commit before downstream phases proceed.
- **`cross-phase-audit.md`**: post-shape-incorporation audit findings (mismatches, gaps).
- **`phase-N-research-notes.md`**: per-phase research audit trails answering open questions raised during plan writing.

## Reading order for new contributors

1. Start with `open-questions-resolution.md` — settled project decisions.
2. Read all ADRs in numeric order — concise reasoning per decision.
3. Skim `escalations.md` — decisions that blocked phase plans, and how each was resolved.
4. When working in a specific phase: read that phase's research notes and the cross-phase-audit entries that cite it.

## Adding a new ADR

1. A product decision goes in `docs/architecture/adr/` at the repository root, not here. Pick the next number of the series it joins (don't reuse).
2. Write the ADR using the standard template (Status / Context / Decision / Consequences / References).
3. Mark prior ADRs as `Superseded by NNNN` if applicable.
4. Update this README's table of contents (if we add one).
5. Discuss in PR; merge once accepted.

## ADRs in this folder

These are the fork, licence and early design decisions. Later product decisions are in `docs/architecture/adr/` at the repository root; that series reuses some numbers, so cite an ADR by its file path. An ADR that a later decision changed keeps its text and gets a dated note at the top.

| ADR | Title | State on 2026-10-01 |
| --- | --- | --- |
| 0001 | Fork vs Package | Accepted |
| 0002 | License Split (AGPL/MPL/MIT) | Accepted; amended (no hosted tier, no SDK) |
| 0003 | Coordinate System | Camera half holds; anchors replaced by world coordinates (root ADR-0015) |
| 0004 | Upstream Merge Policy | Superseded by 0010 |
| 0005 | SDK postMessage Contract | Withdrawn (root ADR-0016) |
| 0006 | Telemetry Policy | Accepted |
| 0007 | Yjs E2EE Threat Model | Decided by root ADR-0014: no end-to-end encryption |
| 0008 | Share Token TTL | TTL replaced by root ADR-0017: links last until revoked |
| 0009 | Error Capture and Observability | Accepted; the health response differs (see its note) |
| 0010 | Own the Fork | Accepted |
