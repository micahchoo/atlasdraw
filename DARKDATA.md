# Dark-data census — ISSUES.md Direction 3

The Yjs data-layer E2E encryption stub, traced end to end. Ledger: value |
written at | surfaced at | class (surfaced / internal / dark) | intent |
verdict | commissioned as.

| value | written at | surfaced at | class | intent | verdict | commissioned as |
|---|---|---|---|---|---|---|
| `encryptUpdate`/`decryptUpdate` (AES-GCM framing for Yjs binary update bytes) | `packages/data/src/yjs-crypto.ts` | nowhere — `grep -rn 'yjs-crypto\|encryptUpdate\|decryptUpdate' apps/realtime apps/atlas-app` (excluding tests) returns zero hits | **dark** | designed-latent, clearest paper trail in the audit — `docs/decisions/escalations.md` E-01 (resolved 2026-05-11, Option C) explicitly assigned Phase 6 two inherited work items: (1) wire `setPersistence`, (2) evaluate the Option B relay rewrite (commit or formally close). `CHANGELOG.md`'s Phase 6 section shipped (v1.0.0, 2026-05-15) without doing either. | **park** — explicitly re-open the E-01 gate for a future phase | `docs/decisions/escalations.md` updated 2026-07-05 |

## Why park, not pursue or reject

- **Not pursue:** wiring Option B (custom log-replay relay replacing
  `setupWSConnection`) is a real week-scale rewrite of `yjs-server.ts`'s
  catch-up protocol — not something to start on a maintainer's one-word
  verdict without the spec interview E-01 itself already calls for.
- **Not reject:** closing this permanently (Option A, server-trusted relay,
  forever) is a real security-posture decision — ADR-0010 would need
  updating to say so explicitly. That's a bigger call than "park" commits
  to, and E-01's own text treats it as still open ("Phase 6 inherits...
  evaluate Option B... commit or formally close" — the maintainer hasn't
  done either yet).
- **Park** matches E-01's own escape hatch: the stub is documented as safe
  under all three options ("the stub is safe under all three options — it
  is purely an API + tests with no live wiring"), so leaving it unwired
  costs nothing today. What changes is the record: Phase 6 silently missed
  its own committed follow-up, and that's now written down rather than
  left to look like nobody noticed.

## Executed

Added a "Status update (2026-07-05) — RE-OPENED, not closed" block to
`docs/decisions/escalations.md` under E-01, between the original 2026-05-11
resolution and the E-02 section. Records: what Phase 6 shipped without,
confirmation via fresh grep, the park verdict and its reasoning, and a
re-open trigger (a future phase explicitly naming Option B evaluation, or a
fresh decision closing it permanently under Option A).

## Done

The gap is now honestly recorded as open, not silently dropped. No code
changed — `yjs-crypto.ts` remains exactly as safe-but-unwired as before.
