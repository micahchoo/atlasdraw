# Ledger — PR-FAQ interview: D1 read-only map embed

Loop: `pr-faq interview` (graft convergence). Started 2026-07-05, main `0c42550`.
Divergence: DIVERGENCES.md D1. Status: probing.

**Contract**
- Done-when: `PRFAQ.md` exists, answers every question raised, no open question
  remains, and D1's Status reads `spec'd`.
- This loop writes **no code** and is **ungated** (Gate §). The divergence's
  probe kill-criterion carries forward into the PRFAQ as a documented FAQ risk,
  not re-decided here.
- Control phrases in force: "continue the ledger" · "the kill criterion stands".

## Grounded baseline (from evidence — to confirm or redirect, not blank-ask)

| element | proposed default | evidence |
|---|---|---|
| Customer | Priya, the data journalist (Persona A) | PRD §3, §8 Flow 3 |
| Struggling moment | finishes a map, has no iframe → exports a static 2× PNG (the "screenshot of QGIS anti-pattern") or pastes a share link that opens the full editor chrome | PRD §2, §49; JOURNEY.md; README out-of-scope |
| Announcement (draft) | "Atlasdraw maps now embed anywhere — paste one `<iframe>` and your live, camera-locked map renders in any page, self-hosted, with no per-pageview bill." | PRD §4 JTBD #3, §6 wedge point (f) |
| Wedge (L4→L2/L3) | read-only iframe of a shared map = ShareView minus chrome + camera-lock + iframe headers + snippet generator; **not** the AtlasdrawAPI/postMessage automation surface Q-P6-1 cut | phase-6-amended-scope.md; ShareView.tsx; ADR-0008; App.tsx routing |

## Decisions (interview)

| # | question | answer | rationale |
|---|----------|--------|-----------|
| 1 | Appetite (set before scoping) | **Two-week "do it properly"** | Room for configurable chrome, responsive auto-fit, PNG fallback, polished snippet UI in ShareDialog — closer to PRD Flow 3's full description. |
| 2 | v0 scope | **Read-only + configurable chrome** | Static read-only iframe + host-set toggles (legend / attribution / camera-lock) via **URL query params** — no postMessage API. |
| 3 | Cross-origin embed posture | **Permissive default, operator-configurable** | `frame-ancestors *` out of the box (zero-config first run), tightenable to an allowlist via env var, documented as an ADR. |
| 4 | Monetization / gating | **Free everywhere, no metering at all** | No view counting even in hosted mode — aligns with ADR-0006 zero-telemetry. **Deliberately drops PRD §10's "25k embed views" metric** (recorded in "decided against"). |

## Interview complete → PRFAQ.md written

Every question raised is answered; no open question remains. D1 Status → `spec'd`.
The divergence's probe **kill criterion carried forward verbatim** into
PRFAQ.md §FAQ (Feasible) — not re-decided here. Loop done.
