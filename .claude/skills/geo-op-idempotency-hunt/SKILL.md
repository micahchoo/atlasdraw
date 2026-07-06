---
name: geo-op-idempotency-hunt
description: >
  Hunt down, reproduce, and fix non-idempotent operations and
  order-of-operations bugs in atlasdraw's drawing↔map interaction layer —
  geo-anchoring, zoom re-projection, scale modes, and the _lastSync
  coordination field. Invoke whenever an element "jumps", "drifts",
  "shrinks/grows", or ends up mis-anchored after some SEQUENCE of actions
  (zoom then move, paste then zoom, undo after pan, resize then toggle scale
  mode…), whenever the same action applied twice gives a different result
  than once, and before ANY change to useGeoAnchor, CoordinateSync,
  useAtlasdrawTool, projection.ts, or scaleMode.ts. Also use it proactively
  when asked to "audit", "stress", or "harden" anchoring/zoom behavior, even
  if no specific bug is named.
triggers:
  - labels: [geo, anchoring, coordinate-sync, idempotency]
  - paths:
      - code/apps/atlas-app/src/hooks/useGeoAnchor*
      - code/apps/atlas-app/src/hooks/useCoordinateSync*
      - code/apps/atlas-app/src/hooks/useAtlasdrawTool*
      - code/apps/atlas-app/src/hooks/useExcalidrawChangeHandler*
      - code/apps/atlas-app/src/tools/seedToElement*
      - code/packages/geo/src/*
      - code/packages/basemap/src/CoordinateSync*
  - keywords: [anchor, reanchor, zoom drift, jumps, _lastSync, zRef,
      scale mode, projection, round-trip, idempotent, order of operations]
---

# Geo-Op Idempotency Hunt

## Input / Output Contract

**Requires:** the atlasdraw repo checked out with `code/packages/geo`,
`code/packages/basemap`, and `code/apps/atlas-app` present; ability to run
`pnpm vitest run` in those packages; grep access to re-verify symbol
locations. No live browser needed — all invariants are testable at the
factory/mocked-map level.

**Produces:** (1) a sequence matrix (markdown table in the session or in
`scratch/`, cells = channel pairs × zoom conditions × verdict); (2) committed
vitest tests in the owning package's existing `*.test.ts` files (or new
siblings) — failing repros first, green after fix; (3) a triage line per
known hazard (fixed / deferred-with-issue / not-reproducible); (4) updates to
this skill's hazard list and, when a path-scoped contract is discovered, a
`.claude/rules/` entry.

Every drawing in atlasdraw can be operated on through many independent
channels — native Excalidraw gestures, atlas tools, map camera moves, undo,
paste, file load. Each channel reads and writes the same two representations
(geo anchor ↔ screen coords), and **most channel pairs were never designed
against each other**. This skill is the systematic hunt for the sequences
that break, the tests that pin them, and the fixes that hold.

## The model you must hold (read this before touching anything)

- **`customData.geo` is the single source of truth.** Screen x/y/w/h/points
  are *derived*. Any fix that makes screen coords authoritative is wrong.
- **Two `onChange` writers fire unordered on every scene change:**
  `useGeoAnchor` (screen→geo re-anchor, subscribed via imperative
  `excalidrawAPI.onChange`) and `useExcalidrawChangeHandler` (the
  `<Excalidraw onChange>` prop, may trigger geo→screen `syncNow()`). Their
  relative order is not guaranteed. Convergence is not proven — it is hoped.
- **`customData._lastSync` is the coordination oracle.** `_projectElement`
  (geo→screen) writes it; `reanchorIfMoved` (screen→geo) compares against it
  to decide "did the *user* move this, or did the *camera*?" Almost every
  order-of-operations bug in this layer is `_lastSync` being stale, cloned,
  partial, or cleared at the wrong moment.
- **Camera is read live, never cached** — `map.getZoom()`/`project`/
  `unproject` at call time. "Current camera" means whenever the callback
  actually ran, which under throttling (16ms) and async `updateScene` is not
  when the user acted.
- **`zRef` is frozen at creation**; sizing multiplies by
  `2^(currentZoom − zRef)` (unbounded in `geographic` mode, clamped
  [0.25, 4.0] only in `hybrid`).

Key files (line numbers drift — `grep` the symbol before citing it, per the
excalidraw-api rule's spirit): `useGeoAnchor.ts` (`buildGeoCustomData`,
`reanchorIfMoved`), `packages/basemap/src/CoordinateSync.ts`
(`_projectElement`, `syncMapToScene`), `useCoordinateSync.ts`,
`useExcalidrawChangeHandler.ts` (scroll-lock reset + post-load sync),
`useAtlasdrawTool.ts` + `tools/seedToElement.ts`,
`packages/geo/src/projection.ts` + `scaleMode.ts` + `types.ts` (GeoAnchor:
point/bbox/polyline, `GeoCustomData`, `ScaleMode`).

## Phase 1 — Build the operation × operation matrix

List the operation channels (re-verify against current code; this inventory
is from 2026-07-05):

| Channel | Direction | Writes |
|---|---|---|
| Native draw (pointerUp, `newElement==null` gate) | screen→geo | stamps `geo` |
| Native move/resize → `reanchorIfMoved` | screen→geo | rewrites `geo`, clears `_lastSync` |
| Camera move/zoom/rotate/pitch → `_projectElement` | geo→screen | x/y/w/h/points/fontSize/strokeWidth + `_lastSync` |
| Atlas tool create/drag (`seedToElement`, `patchElement`) | geo→screen | full element + `GeoCustomData` |
| Scale-mode toggle | — | `scaleMode` only |
| Undo/redo, copy/paste, duplicate | **stock Excalidraw, no atlas handling** | restores/clones x/y **and stale `_lastSync`** |
| File load → post-load `syncNow()` | geo→screen | via `_projectElement` |
| Scroll-lock reset | — | resets appState scroll/zoom (shifts the frame under anchor math) |

The hunt space is **ordered pairs and triples** of these, at more than one
zoom level. Prioritize pairs where one side is a stock-Excalidraw channel
(undo/paste/duplicate) — those never participate in the `_lastSync`
protocol, so they violate its assumptions by construction.

`[eval: matrix-first]` A concrete sequence matrix (channel pairs/triples ×
zoom conditions) exists before any test is written or fix proposed — the
hunt is enumerated, not vibed.

## Phase 2 — Test the invariants

For each cell in the matrix, express the expected behavior as one of these
invariants and write it as a vitest property/characterization test:

1. **Idempotency**: running `syncMapToScene` twice with an unchanged camera
   changes nothing the second time (byte-equal geometry, no `updateScene`
   churn). Same for `reanchorIfMoved` — after one re-anchor, a second pass
   returns null.
2. **Round-trip epsilon**: geo→screen→geo (and screen→geo→screen at fixed
   camera) stays within a stated epsilon. State the epsilon in the test —
   pick it from observed float error at that zoom, not from hope. Sub-pixel
   error from the ≥1px span clamp is accepted and documented; anything
   growing with repetition is not.
3. **Camera-op commutes with identity**: zoom in then out (or pan away and
   back) returns every anchored element to its starting geometry within
   epsilon — for **all three scale modes and all three anchor kinds**.
   Screen mode is the suspect: `_projectElement` writes only `{x,y}` to
   `_lastSync` there, forcing `reanchorIfMoved` onto its drift-prone
   geo-space fallback.
4. **User-op × camera-op ordering**: (move, then zoom) and (zoom, then move)
   end with the same final `geo` anchor. Likewise (edit, zoom, undo) must
   not re-anchor — today undo restores x/y + `_lastSync` from a different
   camera era, which reads as "user moved it".
5. **Convergence**: after any single user action, the two onChange writers
   reach a fixed point in ≤1 extra pass. Instrument with a counter in the
   test harness; ping-pong (A rewrites, B rewrites back) is a failure even
   if coordinates look right at the instant you sampled.
6. **Baseline stability**: `w0/h0` in `_lastSync` must always descend from
   creation-time size. A re-anchor clears `_lastSync`; verify the next sync
   does not adopt an already-scaled `el.width` as the new baseline
   (compounding scale error across re-anchor boundaries).

Follow the established test style: mocked map as in
`packages/basemap/src/CoordinateSync.test.ts`, factory-level tests as in
`useGeoAnchor.test.ts` (test `buildGeoAnchorHandler` directly — do not try
to mount the React tree). Run with `yarn workspace <pkg> test` (yarn 4
workspaces; vitest under the hood).

## Phase 2b — Run the sequence fuzzer

The enumerated matrix catches the pairs you thought of; the fuzzer catches
the depth-4 sequence you didn't. It exists and is wired in:

- `apps/atlas-app/src/hooks/geoOpFuzz.harness.ts` — deterministic
  (seeded-PRNG) sequence generator + world model against the REAL
  `buildGeoAnchorHandler` and `CoordinateSync`: real-math Mercator fake map,
  captureUpdate-aware undo history, settle loop for cascaded onChange
  passes, greedy shrinking to minimal repros. Its header documents the
  model's approximations — read them before trusting a finding that only
  reproduces in the harness.
- `apps/atlas-app/src/hooks/geoOpSequence.fuzz.test.ts` — runs 150 seeded
  sequences; every failure is shrunk and classified by signature
  (invariant|op|kind|scaleMode). Signatures in `KNOWN_FAILURES` are open,
  triaged bugs; any signature outside the list FAILS the suite — that is
  the fuzzer finding a new bug class, and it must be triaged (minimal
  repro as `it.fails` in `geoOpKnownHazards.repro.test.ts`, signature +
  class comment in `KNOWN_FAILURES`, seeds issue) — never silenced.
- `apps/atlas-app/src/hooks/geoOpKnownHazards.repro.test.ts` — one
  `it.fails` repro per open class. Fixing a bug flips its repro red:
  remove `.fails` there and delete the class's signatures from
  `KNOWN_FAILURES` in the same change.

Invariants live in `executeOp` (harness): GEO-STABLE, UNDO-GEO, ZOOM-RT,
NEUTRAL-VIS, NEUTRAL-REANCHOR, IDEMPOTENT, CONVERGE. Add new invariants
there — every seeded sequence then checks them for free. When a fix lands,
consider raising SEED_COUNT for one local run (500+) to shake out
neighbors of the fixed class.

`[eval: fuzzer-clean]` The run leaves the fuzz suite green with every
KNOWN_FAILURES entry backed by a live `it.fails` repro — no orphan
signatures, no un-triaged unknowns.

`[eval: failing-repro]` Every claimed bug has a committed failing test that
encodes the exact sequence, before any fix is written. A bug you cannot
reproduce in a test is a hypothesis, not a finding.

## Phase 3 — Fix at the right layer

Ordered by preference:

1. **Protocol fix** — if the bug is `_lastSync` staleness (paste/undo/clone
   class), fix the *protocol*: e.g. validate `_lastSync` against the current
   camera before trusting it, or strip/refresh `_lastSync` on the
   clone/restore path. One protocol fix kills the whole class; per-channel
   patches kill one cell each.
2. **Primitive fix** — precision/clamping issues belong in
   `packages/geo` (`projection.ts`, `scaleMode.ts`) where every caller
   inherits the fix.
3. **Caller fix** — only when the bug is genuinely one channel's misuse.

Hard constraints:
- `CoordinateSync._projectElement` and `useGeoAnchor`'s reanchor logic are
  **deliberately separate** (different direction, different lifecycle). Do
  not merge them — see `.claude/rules/canonicalization-verify-first.md`.
- Never make screen coordinates authoritative to "simplify" — that inverts
  the source of truth.
- Don't widen epsilons to make a drift test pass. An epsilon change needs a
  float-precision argument written into the test, not a bigger number.
- If you touch a vendored Excalidraw path (undo/paste in
  `packages/excalidraw`), it's owned code (ADR 0010) — fixing at the clone
  site is allowed, but prefer handling atlas concerns on the atlas side
  (e.g. sanitize `customData` in the onChange pass) so stock behavior stays
  stock.

After each fix, re-run the **full** invariant suite, not just the new test —
these channels share state; a fix in one cell can shift another.

`[eval: class-not-cell]` Each fix is justified at the class level (which
protocol/primitive assumption was false) and the category-prevention is
stated: what now makes this *kind* of sequence safe, not just this repro.

## Phase 4 — Keep the map honest

- New hazard class found (not in the list below)? Add it to this skill's
  hazard list and, if it's a path-scoped contract ("changing X requires
  checking Y"), write a `.claude/rules/` entry.
- Line numbers or symbols in this skill gone stale? Fix them in the same PR
  that moved the code.

## Known hazard checklist (verify each still holds before hunting new ones)

Status 2026-07-05 (post-fix): hazards **1, 2, 3, 6, 8, 9, 10 are FIXED** by
the `_lastSync` protocol overhaul (fuzzer classes A–F; regression repros in
`geoOpKnownHazards.repro.test.ts`). The overhaul: re-anchors write coherent
snapshots with re-based baselines instead of clearing `_lastSync`; polyline
compare includes x/y; point compare includes w/h; style edits re-base via
stored projected values (`sw`/`fs`); scale-mode toggles re-base `zRef`;
screen arms write full snapshots; the geo handler commits with
`captureUpdate:"NEVER"` so re-anchors never split undo. Hazard **11**
(world-wrap at ±180, fuzzer class G, issue atlasdraw-7f0a) is OPEN — needs a
world-edge policy decision. Hazards 4 and 5 remain unconfirmed (need
targeted generator bias: extreme zoom-out, tiny elements, large |z−zRef|);
hazard 7 (mid-gesture window) is outside the current world model. Each is a
testable claim:

1. Paste/duplicate deep-clones `geo` **and stale `_lastSync`** at a new
   offset → spurious re-anchor on next onChange.
2. Undo/redo restores x/y + `_lastSync` from a different camera era → if
   zoom changed in between, restored coords mismatch restored `_lastSync`
   → spurious re-anchor.
3. Screen scale mode writes only `{x,y}` to `_lastSync` → bbox/polyline
   re-anchor always falls back to drift-prone geo-space comparison.
4. `Math.max(1, span)` clamps in `_projectElement` → reverse-projecting a
   clamped span at extreme zoom-out yields wrong lng; bbox path mitigates,
   fallback + polyline paths exposed.
5. `2^(z − zRef)` unbounded in geographic mode → precision degrades with
   zoom delta from creation; never re-based.
6. Re-anchor clears `_lastSync` → next sync can adopt already-scaled
   `el.width` as `w0` baseline → compounding scale error.
7. Native draw stamps `geo` only after `newElement==null` → element exists
   un-anchored mid-gesture; any camera move in that window operates on an
   element the sync layer can't see.
8. **Polyline move is invisible to `reanchorIfMoved`** — the primary path
   compares relative `points` against `_lastSync.pts` and never `x/y`, so a
   dragged polyline snaps back on the next camera event, and a pasted
   polyline snaps onto its source. (Fuzzer class A.)
9. **Style edits are outside the protocol** — user changes to
   `strokeWidth`/`fontSize` never update `strokeWidth0`/`fontSize0`
   baselines, so the next sync reverts them. (Class C.)
10. **Point-kind resize is invisible** — `reanchorIfMoved` for `point`
    compares only `x/y`; a width/height change never re-anchors, so the
    next sync reverts the resize (and combined with hazard 6, move-after-
    zoom compounds the size instead). (Class D; undo-fight is class B,
    screen-mode fallback class E, hybrid clamp pop class F.)
11. **World-wrap at the ±180 seam (OPEN)** — `renderWorldCopies:false` with
    no `minZoom` lets geometry sit past the world edge; `normalizeLng`
    wraps those anchors to the far side and projection jumps by a world
    width. Class G, `it.fails` repros parked, issue atlasdraw-7f0a. The
    bbox `west<east` schema can't represent dateline-straddling boxes —
    any fix is a policy decision, not a protocol patch.

`[eval: hazards-triaged]` The run ends with each of the hazards marked
confirmed-and-fixed, confirmed-and-deferred (with a filed issue), or
no-longer-reproducible (with the test that proves it).
