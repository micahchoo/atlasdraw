# Handoff — 2026-05-11 (Phase 5 Wave 0 — T0+T1 done; T2 needs config-format decision)

## Goal

User opened with `/check-handoff` resuming the 2026-05-11 Phase 4 CLOSED handoff. After my recommendation (C → A: Phase 4 polish, then Phase 5 entry), the user iterated: *"do it"* → polish → *"3+2"* (warm-up seed + Phase 5 entry blocked on E-01) → *"1+2"* (write ADR + brainstorm) → *"1+3"* (plan amendments + dispatch Wave 0 T1) → `/handoff`. Net effect: ship Phase 4 closing polish, ship the Phase 4 P1 test-debt warm-up, resolve E-01/E-02 with maintainer confirmation of Option C, ship ADR-0010 as Phase 5 Task 0 hard gate, and ship Phase 5 Wave 0 Task 1 (`@atlasdraw/protocol` workspace).

## Progress

### Completed this session — six commits pushed (origin/main at `6e4e3c9`)

| # | Commit | What |
|---|---|---|
| 1 | `5bb50b9` | **Phase 4 post-ship polish** — plan marked `✅ COMPLETE` at top of `docs/superpowers/plans/2026-05-03-atlasdraw-phase-4-mvp-self-host.md`; `docs/security/dependabot-2026-05-11.md` triage of 25 alerts (1 actionable, 5 non-applicable, 19 tolerated); parent seed `atlasdraw-4579` closed `outcome:success`. |
| 2 | `c95cf02` | **atlasdraw-3601 paste-image round-trip test** — new test in `code/apps/atlas-app/src/state/hydrate.test.ts:362-404` asserts paste-image → `selectDocument` → `hydrate` → `addFiles` round-trip preserves byte-identical dataURL. Closes the gap the 2026-05-10 reopen named: prior tests stubbed each direction independently. 11/11 pass. |
| 3 | `a23328e` | **E-01 closed Option C + E-02 unblocked** — `docs/decisions/escalations.md` E-01 Decision block (2026-05-11, maintainer confirmed via AskUserQuestion) and E-02 Decision block (unblocked under plaintext Y.Doc assumption). Seeds closed: `atlasdraw-4f26`, `atlasdraw-fef0`. |
| 4 | `b5567d3` | **ADR-0010 Yjs E2EE threat model** — `docs/architecture/adr/0010-yjs-e2ee-threat-model.md` (167 lines). Trust-boundary diagram, A1-A5 attacker scenarios, Phase 5 immediate consequences, Phase 6 inherited obligations. **Path drift from plan**: plan literal said `decisions/0007-yjs-e2ee-threat-model.md`; shipped at `docs/architecture/adr/0010-...` (Phase 4 established adr home; 0007 already taken by storage-dual-mode). Plan Task 0 scrub-noted. |
| 5 | `bab51b4` | **Phase 5 pre-dispatch scrub notes** on Task 1 and Task 2 of the Phase 5 plan, plus `docs/self-host/production.md` Security-Hardening subsection "Future: real-time relay trust boundary (Phase 5+)" linking ADR-0010. |
| 6 | `6e4e3c9` | **Phase 5 Wave 0 Task 1** — `@atlasdraw/protocol` workspace scaffolded (`code/packages/protocol/{package.json,tsconfig.json,src/index.ts,src/realtime-events.ts,src/room-key.ts}`). CollabEvent discriminated union (SCENE_UPDATE / MAP_CAMERA_UPDATE / CURSOR / COMMENT). RoomKey + `parseRoomFragment(hash)` with Web Crypto AES-GCM import + base64url decode + 32-byte validation. `yarn workspace @atlasdraw/protocol test:typecheck` → 0 errors. |

### Phase 5 — Wave 0 scoreboard

| Task | Status | Source |
|---|---|---|
| T0 — Yjs E2EE Threat-Model ADR | ✅ | this session (`b5567d3`); path drifted to `docs/architecture/adr/0010-` |
| T1 — Wire Protocol Event Types | ✅ | this session (`6e4e3c9`) |
| T2 — Config Schema (Realtime Feature Flag) | ⬚ **needs config-format decision** | plan spec assumes `config.toml`; Phase 4 reality is `.env`/`VITE_*`. Scrub-noted at plan line 209 (block immediately before `### Task 2:`). |

### Closed seeds (this session)

- `atlasdraw-4579` — Phase 4 parent. `outcome:success`.
- `atlasdraw-3601` — P1 Excalidraw `addFiles()` round-trip test debt. `outcome:success`.
- `atlasdraw-4f26` — HELD: E-01 Yjs E2EE option. Resolved Option C. `outcome:success`.
- `atlasdraw-fef0` — HELD: E-02 DiffEngine dependency. Unblocked by Option C. `outcome:success`.

### Open after this session

- ⬚ **Phase 5 Wave 0 Task 2** — needs maintainer call on config format. Plan says `infra/config.toml.example` ([realtime] stanza in TOML); Phase 4 shipped `infra/.env.example` with `VITE_*` env vars. Question: does atlas-app read TOML or env? Scrub-noted at plan §Task 2.
- ⬚ **Phase 5 Wave 0 Task 0 follow-ups** (per ADR-0010 gate checklist): (a) self-host README disclosure paragraph (production.md done, README.md skipped this session — too early-stage for the first-run doc); (b) Task 2 config-block must include ADR-0010 reference comment when shipped.
- ⬚ **Phase 5 Task 1 optional follow-up** — unit tests for `parseRoomFragment` (null on malformed, 32-byte gate, round-trip with `crypto.subtle.exportKey` — though we explicitly imported as non-extractable, so round-trip exportKey will reject; test that path). Plan Task 1 doesn't require tests; left as a follow-up.
- ⬚ **Dependabot triage doc may need rescan**: `code/yarn.lock` fast-uri entries should already be patched (3.0.6/3.1.2 are at fix-line per advisory); GH may need a refresh. See `docs/security/dependabot-2026-05-11.md`.
- ⬚ **Pre-existing dirty (not this session's)**: `.mulch/expertise/meta.jsonl` and `.mulch/mulch.config.yaml` (pre-existing modifications from prior sessions, untouched here), `code/packages/cli/src/atlasdraw.ts` (yarn-install mode-bit drift, never committed), `.claude/skills/playwright-cli/` (untracked from prior session), `code/.husky/post-*` hooks (untracked).

## What Worked

- **Pre-dispatch scrub as a habit**, not a per-task ceremony. The Phase 5 plan was authored 2026-05-03, before Phase 4 closed. Before dispatching Task 1, a quick `ls code/packages/protocol/` confirmed the workspace doesn't exist → drift caught before a worker hit it. Recorded as the second scrub-note on Task 1.
- **Inline execution over worker dispatch for bounded scope.** Task 1's post-scrub scope (5 files, ~200 LOC, no business logic) was small enough that worker dispatch overhead exceeded its value. Inline took ~2 min; would have spent that on writing the brief alone.
- **The TypeScript strict-mode `Uint8Array<ArrayBuffer>` annotation.** Initial impl typed `Uint8Array | null` which gave the inferred `Uint8Array<ArrayBufferLike>`; `crypto.subtle.importKey` rejected it because `ArrayBufferLike` includes `SharedArrayBuffer`. Fix: type as `Uint8Array<ArrayBuffer>` AND construct with explicit `new ArrayBuffer(len)`. Quick fix once diagnosed.
- **AskUserQuestion for the E-01 decision.** Three options with previews rendered cleanly; maintainer picked C in one click. Beat asking three follow-ups inline.
- **Scrub-note pattern preserves original-spec record.** When path-drifting from plan literal (Task 0 `decisions/0007-...` → `docs/architecture/adr/0010-...`), only fix references in the NEW Decision block I wrote in escalations.md; leave plan body refs intact as historical spec. Convention from Phase 4; held in Phase 5.

## What Didn't Work

- **Plan-literal drift was, again, recursive** (per existing mulch record `mx-04ac8d`). Found three layers this session: (1) ADR path collision (plan said `decisions/0007-...`; ADR home is `docs/architecture/adr/`; 0007 already taken); (2) Task 1 workspace doesn't exist (plan only spec'd `src/` files); (3) Task 1 verify uses `pnpm -F`, yarn classic monorepo. Each was a 30s grep to catch pre-dispatch; would have been a worker retry to catch post-dispatch.
- **Config-format ambiguity on Task 2.** Plan spec says `infra/config.toml.example`; Phase 4 shipped `infra/.env.example`. Did not resolve mid-session — flagged for handoff to avoid asking the user a mid-flight clarifying question we can defer.
- **Bash cwd persisted across tool invocations** unexpectedly. After `cd code && yarn workspace ...`, the next `git add code/packages/...` failed because cwd was already `code/`. Fix: prepend absolute path. Worth a `[NOTE]` — Bash tool documentation says new shells per invocation, but cwd appears to persist.
- **PostToolUse hook `~/.claude/scripts/failure-journal-hook.sh:506` syntax error.** Fired on multiple Bash post-hooks. Unrelated to this session's work; flagged but not fixed (outside project scope).

## Key Decisions

- **E-01 = Option C** (maintainer 2026-05-11 via AskUserQuestion). Phase 5 ships server-trusted Yjs relay; `yjs-crypto.ts` lands as stub; ADR-0010 documents the threat model; Phase 6 inherits Option B evaluation. Rationale: matches Hocuspocus/y-sweet/Liveblocks production practice; Option B adds ~1 week risky custom-protocol work; ADR documents the bounded trade-off.
- **ADR-0010 path = `docs/architecture/adr/0010-yjs-e2ee-threat-model.md`** (drifted from plan's `decisions/0007-...`). Rationale: Phase 4 established `docs/architecture/adr/` as the ADR home with 0006-0009; 0007 collides with `storage-dual-mode.md`. Bumped to 0010. Documented in plan scrub note + escalations.md Decision block.
- **CollabEvent payload shape preserved from plan spec.** SCENE_UPDATE/COMMENT carry `EncryptedPayload` (`{ iv, ciphertext }`); MAP_CAMERA_UPDATE + CURSOR are plaintext by design per ADR-0010 §"What the relay can see." No structural changes; just typed.
- **`parseRoomFragment` is async.** Web Crypto's `importKey` returns a Promise. Plan spec said the function returns `RoomKey | null` (sync); reality requires `Promise<RoomKey | null>`. Documented inline. Future Task 7 (`CollabState.connect()`) must `await`.
- **Non-extractable `CryptoKey` for AES-GCM import.** `crypto.subtle.importKey(..., false, ["encrypt", "decrypt"])`. Hardens against accidental key exposure; aligns with ADR-0008 share-link key handling.
- **`RealtimeConfig` co-located with `realtime-events.ts`** (plan Step 3 said export-from-realtime-events; the scrub-note offered "or its own `realtime-config.ts`"). Kept it in realtime-events.ts to match plan literal; semantically distinct but small enough not to warrant a separate file.
- **Production.md gets the realtime-relay trust-boundary disclosure paragraph; README.md does not.** README is the first-run friendly doc for current users; cluttering with Phase 5 disclaimers hurts UX. production.md is operator-facing; right home for a forward-looking hardening note.
- **Skip the Phase 6 contract-row path edit (plan line 56)** per established scrub-note convention: plan body text remains the historical-spec record; scrub note covers the drift.

## Trajectory

**How we got here.** Session opened with `/check-handoff` resuming the 2026-05-11 Phase 4 CLOSED handoff. Validated state (all files referenced exist, push state matches `992e1fd`, working tree drift is pre-existing). User said *"do it"* on my recommendation (C → A). Started with bookkeeping — wrote `docs/security/dependabot-2026-05-11.md` triage (found 2 critical + 4 high alerts; vitest RCE is non-applicable without `--api` flag, fast-uri already at fix-line, most others are vendored `dev-docs` surface), marked Phase 4 plan `✅ COMPLETE`, closed parent seed `atlasdraw-4579`. Committed (`5bb50b9`). User then said *"3+2"* — warm-up seed + Phase 5 entry with E-01 options. Tackled `atlasdraw-3601` first: inspected existing hydrate.test.ts, found two existing tests that stubbed each direction (`Blobs to BinaryFileData` and `empty-files skip`) but no full round-trip test through `selectDocument`. Wrote a paste-image round-trip test asserting byte-identical dataURL preservation. 11/11 pass. Committed + closed seed (`c95cf02`). Then loaded E-01 escalation + summarized A/B/C with AskUserQuestion previews. Maintainer picked C. Wrote Decision blocks in `escalations.md` (E-01 RESOLVED + E-02 UNBLOCKED), closed both HELD seeds, committed (`a23328e`). User said *"1+2"* — write the threat-model ADR + brainstorm Phase 5 entry. Wrote ADR-0010 (167 lines: trust boundary, A1-A5 attacker scenarios, Phase 5 + Phase 6 + Phase 7 implications), scrub-noted Task 0 with the path drift, committed (`b5567d3`). Brainstorming pass: read plan's Open Questions section, found all 5 OQs already RESOLVED (OQ-1 was today's E-01 closure); found three small plan-amendment chores; flagged two drift risks. User said *"1+3"* — land plan amendments + dispatch Wave 0 T1. Pre-dispatch scrub on T1: discovered `code/packages/protocol/` workspace doesn't exist. Scrub-noted T1 (workspace scaffold needed + pnpm→yarn) and T2 (config-format ambiguity + ADR-0010 reference comment requirement). Added production.md forward-looking trust-boundary disclosure. Committed (`bab51b4`). Then inline-executed T1: scaffolded workspace mirroring `packages/data/` shape, wrote `realtime-events.ts` + `room-key.ts` + `index.ts`, hit a TS strict-mode wart (`Uint8Array<ArrayBufferLike>` not assignable to `BufferSource`), fixed by typing `Uint8Array<ArrayBuffer>` + explicit `new ArrayBuffer(len)`. Typecheck clean. Committed (`6e4e3c9`).

**Hard calls.** ADR-0010 numbering: keep plan literal `decisions/0007-...` (and accept the 0007 collision) vs follow Phase 4 ADR home convention (bump to 0010). Chose the latter — Phase 4 established the convention, plan was pre-Phase-4. Inline vs worker for T1: bounded scope (5 files, type defs only, no business logic) means dispatch overhead exceeds value. Chose inline; saved ~5 min and a context-heavier brief. Whether to fix all 13 plan-body refs to the old `0007-...` path or just my new Decision block refs: chose the latter, per established scrub-note convention. Whether to ship Task 2 inline alongside T1: chose to stop after T1 — Task 2 needs the config-format decision (TOML vs env) which is a maintainer call, not an inline decision.

**Shaky ground.** **(1)** `parseRoomFragment` returns `Promise<RoomKey | null>` but the plan literal said `RoomKey | null` (sync). Future Task 7 (`CollabState.connect()`) must `await` — consumers that copy the plan literal will get a type error. Not a bug, just plan-vs-code drift. **(2)** `RealtimeConfig.wsUrl` is optional in the type; the plan spec didn't define when unset means same-origin vs disabled. I documented "same-origin (resolved by client at runtime)" inline. Future Task 2 + Task 7 must respect this. **(3)** TypeScript strict-mode `Uint8Array<ArrayBuffer>` (not `<ArrayBufferLike>`) annotation depends on the TS version's lib.dom.d.ts shape. If TS or @types changes, the annotation may need revisiting. Tested on the lockfile's current TS (5.x via the workspace devDep). **(4)** No unit tests for `parseRoomFragment`. The plan doesn't require them; future tests should cover: null-on-no-comma, null-on-empty-roomId, null-on-non-32-byte-key, null-on-invalid-base64url, success-on-32-byte-key, and the non-extractable property (try `exportKey` and assert rejection). **(5)** `infra/config.toml.example` does not exist and may not be the right surface — Phase 4 standardized on `.env.example` with `VITE_*` env vars. Task 2 needs maintainer to choose: continue plan literal (introduce TOML), or amend Task 2 to use the existing env-var convention.

**Invisible context.** The user reads commit messages, not prose narrative — each commit body explains the why; the HANDOFF is for the next agent. The user invoked `/check-handoff` at session open and `/handoff` at close — session ceremonies. Auto mode active throughout; single-word prompts ("do it", "3+2", "1+2", "1+3") signal "execute my recommendation"; never assume the user wants more prompts than necessary. AskUserQuestion is the right tool for **structural decisions** (E-01 A/B/C with previews) where the user picks from a finite set; not for tactical questions ("should I commit?" — just commit and let them say "no" via Ctrl-C). The pre-dispatch scrub pattern (per `mx-04ac8d`) is now load-bearing for Phase 5; each task brief needs a fresh scrub because the plan predates Phase 4 close, so every Phase-4-shaped expectation is potentially stale.

## Active Skills & Routing

- `check-handoff` at session start — validated 2026-05-11 Phase 4 CLOSED state.
- `brainstorming` at user request for Phase 5 entry. Used in **constraint-confirmation mode** (cycle 2+ — plan exists, decision locked) rather than full design loop. Found all 5 OQs already RESOLVED; surfaced two drift risks. Did NOT route post-spec (no need for writing-plans; plan exists).
- `handoff` at session close.
- **`[eval: knowledge-restored]`** — passed (no new `context add` needed; ml + qmd handled queries).
- **`[eval: no-rediscovery]`** — passed (didn't re-investigate prior-session decisions; trusted 2026-05-11 handoff state).
- **Pending routing for next session**:
  - **AskUserQuestion** for the Task 2 config-format call (TOML vs env). Maintainer decision.
  - **executing-plans or inline** for Phase 5 Tasks 2, 3, 4 (Wave 0 close): config schema (T2), apps/realtime server skeleton (T3), packages/data YjsLayer type model (T4). Wave 0 closes when T2-T4 land.
  - **writing-plans** NOT needed (Phase 5 plan exists and was validated as constraint-current this session).
  - **adversarial-api-testing** for Phase 6 Stripe-webhook tasks per `atlasdraw-94e2`; not Phase 5.

## Infrastructure Delta

This session changed:

- **Plugins**: unchanged.
- **Hooks**: unchanged. **Note**: `~/.claude/scripts/failure-journal-hook.sh:506` has a bash syntax error firing on every Bash post-hook (`/home/micah/.claude/scripts/failure-journal-hook.sh: line 506: syntax error near unexpected token 'newline'`; `if|for|while|until|case|\[\[`). Unrelated to project work; flagged for maintainer fix outside project scope.
- **Skills**: unchanged in `~/.claude/skills/`. `.claude/skills/playwright-cli/` remains untracked (carried from prior session, not added by this session).
- **Pipelines**: unchanged.
- **Overrides**: unchanged.
- **CI workflows**: unchanged. GH Pages workflow ran successfully on each push.
- **Mulch**: no new records this session — drift fixes were instance-level (plan scrub notes) rather than convention-level. Existing records `mx-04ac8d` (plan-literal drift is recursive) and `mx-cb3eb8` (pre-dispatch scrub recurrence for cross-phase plans) both fired correctly.
- **Seeds**: 4 closures (`atlasdraw-4579`, `atlasdraw-3601`, `atlasdraw-4f26`, `atlasdraw-fef0`).
- **ADRs (new file surface)**: `docs/architecture/adr/0010-yjs-e2ee-threat-model.md`.
- **Decisions surface**: `docs/decisions/escalations.md` updated with E-01 Decision (RESOLVED) + E-02 Decision (RESOLVED) blocks.
- **Security docs (new file surface)**: `docs/security/` directory created with `dependabot-2026-05-11.md`.
- **New workspace**: `code/packages/protocol/` (5 files: package.json, tsconfig.json, src/{index,realtime-events,room-key}.ts).

## Knowledge State

- **Indexed**: no `context add` calls this session. Existing tier 0/1 indexes covered: Web Crypto API (`crypto.subtle.importKey`), TS strict-mode `Uint8Array` generics, base64url decoding, AES-GCM convention. No gaps required `context add`.
- **Productive tiers**: `grep` via Bash (plan-literal verification — scrub-note workflow), `Read` (selective hydrate.test.ts + escalations.md inspection), `qmd` (not used this session). `foxhound` not invoked substantively. `ml search` not invoked (relied on the session-priming mulch context block).
- **Gaps**: None encountered. If next session enters Task 6 (`y-websocket` integration), index `y-websocket@latest` and `@y/websocket-server@latest` docs — both were referenced from research notes but neither is `context add`-installed.

## Next Steps

1. **Decide Phase 5 Task 2 config format**. Maintainer call: keep plan literal (introduce `infra/config.toml.example` + a TOML parser in atlas-app) OR amend Task 2 to use the existing `.env`/`VITE_*` convention from Phase 4. Recommended: **the env-var convention** — Phase 4 shipped it, atlas-app already reads `VITE_STORAGE_BASE_URL`, adding `VITE_REALTIME_ENABLED` + `VITE_REALTIME_WS_URL` is structurally identical and avoids introducing a TOML parser. Amend Task 2 with a scrub note documenting the convention choice.
2. **Land Phase 5 Task 2** (Realtime Feature Flag config). Modify `code/apps/atlas-app/src/config.ts` to add `realtime: RealtimeConfig` to `AppConfig`. Default `{ enabled: false }`. Read from `VITE_REALTIME_ENABLED` (string '1' or 'true' → true) and `VITE_REALTIME_WS_URL` (optional). Mirror the existing `enableBackendPersistence` pattern. Add to `infra/.env.example` (not `config.toml.example`). Verify with the atlas-app's existing test pattern.
3. **Land Phase 5 Tasks 3 + 4 (Wave 0 close)**. T3: `apps/realtime/` Node app skeleton (Fastify or plain http; plan says forked from excalidraw-room) with `/socket.io` + `/yjs/:roomId` + `/health`. T4: `packages/data/src/yjs-layer.ts` YjsLayer class with Y.Doc + Y.Map<FeatureId, Y.Map<...>> + Y.Array geometry. Both reference `@atlasdraw/protocol` types (now exists).
4. **Optional polish on Task 1**: unit tests for `parseRoomFragment` (5 cases — see "Shaky ground" #4 above). Cheap, prevents regression as Task 7 consumes it.
5. **Fix `~/.claude/scripts/failure-journal-hook.sh:506`** (environment, not project scope) — bash syntax error firing on every Bash post-hook. Doesn't block work but spams stderr.
6. **Dependabot rescan** (optional): the triage doc notes fast-uri entries should clear after a `yarn-deduplicate` pass. Run when bandwidth permits.

## Context Files

- `docs/superpowers/plans/2026-05-03-atlasdraw-phase-5-realtime.md` — Phase 5 plan. Three 2026-05-11 scrub notes (Task 0, Task 1, Task 2). Open Questions section (lines 747-799) all RESOLVED.
- `docs/architecture/adr/0010-yjs-e2ee-threat-model.md` — Phase 5 Task 0 hard gate. Defines the relay trust boundary (what the relay can see); Phase 6 inherits two work items.
- `docs/decisions/escalations.md` E-01 + E-02 — Decision blocks at lines ~83-110 and ~157+ document Option C selection and the unblock.
- `code/packages/protocol/src/realtime-events.ts` + `room-key.ts` — Phase 5 protocol types, consumed by Tasks 3, 5, 6, 7, 8.
- `code/apps/atlas-app/src/config.ts` — Task 2 change-site for the `realtime` config field.
- `code/apps/atlas-app/src/state/hydrate.test.ts:362-404` — atlasdraw-3601 paste-image round-trip test; ensures Phase 4 image hydration doesn't regress.
- `docs/security/dependabot-2026-05-11.md` — Phase 4 alert triage; reference before Phase 5 introduces new server deps.
- `HANDOFF-expertise.md` (from 2026-05-11 Phase 4 CLOSED handoff) — structured mulch records still apply; not regenerated this session (no new mulch records added).
- `.claude/rules/excalidraw-api.md` — load-bearing project rule; did NOT fire this session (no Excalidraw API changes), still relevant for any Phase 5 task that touches Excalidraw types (T10 scene-encryption adapter).
