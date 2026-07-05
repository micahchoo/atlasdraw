# CANON.md — Issue 5: canonicalization ledger

Issue 5's run-it prompt claimed two duplicated concerns: GeoAnchor reprojection
"three times" (packages/geo's `geoToExcalidraw`/`excalidrawToGeo`,
`CoordinateSync._projectElement`, `useGeoAnchor`) and AES-GCM/base64url crypto
"twice" (`yjs-crypto.ts`, `scene-crypto.ts`). Before migrating anything, each
alleged duplicate was verified against the running code (grep for every
consumer, read every implementation, check governing ADRs/plan docs). Only one
of the two clusters was real duplication; the other was mislabeled dead code.
Ledger below reflects what was actually true, not the original claim.

## Crypto cluster — real duplication, narrow scope

| losing call site | file | migrated commit | tests green |
|---|---|---|---|
| `uint8ArrayToBase64Url`/`base64UrlToUint8Array` (private copy) | `packages/data/src/yjs-crypto.ts` | 205429b | packages/data 143/143 |
| `uint8ArrayToBase64Url`/`base64UrlToUint8Array` (private copy, header said "mirrors" the above) | `apps/atlas-app/src/collab/scene-crypto.ts` | 205429b | atlas-app 366/366 |

**Winner:** a new shared module, `packages/data/src/base64url.ts`, exported
from the package barrel. Both files now import it.

**Not migrated, on purpose:** `encryptUpdate`/`decryptUpdate` (yjs-crypto.ts)
vs. `encryptScene`/`decryptScene` (scene-crypto.ts). These are not competing
implementations of the same job — they encrypt structurally different
payloads (raw Yjs binary update bytes vs. JSON-serialized Excalidraw scene
array) for different channels (y-websocket vs. Socket.IO), and
`yjs-crypto.ts`'s functions are a deliberate, ADR-0010-mandated unwired stub
("Option C... ships as tested but unwired stub"; ADR-0010 §Alternatives
explicitly rejects deleting it — "Option A... the stub is cheap... keeping it
preserves Phase 6's option"). Picking a "winner" between them would violate an
Accepted architectural decision. Zero losing call sites remain for these two
functions because there was never a duplicate to lose.

## Geo cluster — not duplication; one was dead code, two are not comparable

| losing call site | file | migrated commit | tests green |
|---|---|---|---|
| n/a — zero consumers found anywhere in the repo (only the module's own tests) | `packages/geo/src/geoToExcalidraw.ts` | 9505990 (deleted) | packages/geo 42/42 |
| n/a — zero consumers found anywhere in the repo; import was already stale/broken (`./CoordinateSync.js`, moved 2026-05-25) | `packages/geo/src/excalidrawToGeo.ts` | 9505990 (deleted) | packages/geo 42/42 |

**Verdict:** `geoToExcalidraw`/`excalidrawToGeo` were not one of three
implementations of the same reprojection logic — they convert a static
GeoJSON `Feature` into an Excalidraw element skeleton with screen coordinates
intentionally zeroed (no `map`, no zoom, no `projectPoint`/`unprojectPoint`
call anywhere in either file). The Phase 1 plan expected them to be consumed
by Phase 2 (data layers); that consumer was instead built as
`useGeoJsonDrop.ts`'s MapLibre data-layer pipeline (`map.addSource`/
`addLayer` via `compileLayer`, registered as a styled layer, not as
individual anchored Excalidraw elements) — a different architecture that
never called back into these functions. They were superseded by a pivot, not
duplicated. Confirmed dead (zero consumers repo-wide, `excalidrawToGeo.ts`
already had a stale import proving neglect, not intentional-stub status) and
removed.

**`CoordinateSync._projectElement`** (packages/basemap, geo→screen, driven by
live MapLibre camera events, stateful over a `Map` ref) and **`useGeoAnchor`**
(apps/atlas-app, screen→geo, React hook over Excalidraw's `onChange`,
native-tool creation/move lifecycle) are inverse operations for different
lifecycle events, not two copies of the same implementation. Both already
share the actual reprojection math — `projectPoint`/`unprojectPoint`/
`computeScaleFactor`/`clampHybridFactor` — via the centralized
`packages/geo/src/projection.ts` + `scaleMode.ts`, which is the real
canonicalization already in place. The point/bbox/polyline `switch` shape
repeats across the two files because the domain has three geometry kinds, not
because logic was copy-pasted. **Left untouched — not a losing call site.**

## Incidental fix (found during verification, unrelated to either cluster)

`packages/geo/src/bounds.ts` — a live, exported, non-dead file — had the same
stale `./CoordinateSync.js` import as `excalidrawToGeo.ts`, meaning
`packages/geo` has failed `tsc --noEmit` at the per-package level since the
2026-05-25 CoordinateSync move. Fixed in commit f26d585 (import corrected to
`./excalidrawTypes.js`). Root-level `yarn test:typecheck` was unaffected
(TS project references build `packages/geo` in the right order and never hit
this path in isolation), but any per-package or CI job that typechecks
`packages/geo` alone would have been red. Confirmed clean after the fix.

## Docs corrected in the same change-set

`docs/architecture/subsystems/geo/contracts.md` is marked "Wave 0
implementation-aligned... Implementation is canonical" — an active accuracy
claim, not a speculative draft — and asserted `geoToExcalidraw`/
`excalidrawToGeo` as **stable** exports with signatures. Corrected in commit
9505990. `behavior.md`'s now-dead "`geoToExcalidraw` Flow" section removed in
the same commit.

`modules.md` and `components.md` are self-labeled "Speculative — revise
against real code" and are already stale in unrelated ways (both still place
`CoordinateSync` inside `packages/geo`, wrong since the 2026-05-25 move to
`packages/basemap`). Reconciling those is a full doc-accuracy sweep
(Issue 2's territory), not this change — left untouched, noted here so it
isn't lost.

## Done-when

Zero losing call sites for both clusters:

- Crypto: the one real duplicate (base64url helpers) is consolidated;
  `grep -rn "function uint8ArrayToBase64Url\|function base64UrlToUint8Array"`
  now returns exactly one definition (`packages/data/src/base64url.ts`).
- Geo: zero consumers of the deleted functions existed before removal and
  the files are gone; `CoordinateSync`/`useGeoAnchor` were never losing call
  sites to begin with.

Lock recorded in `.claude/rules/canonicalization-verify-first.md`.

## Lesson for the next sweep

The run-it prompt's premise ("three implementations of the same dispatch")
did not survive a read of the actual code: structural similarity (a
point/bbox/polyline `switch`, or two files with the same helper-function
names) is not proof of duplicated logic. Before picking a "winner" and
migrating callers, check: (1) do all alleged copies take the same input and
produce the same output, just via different code paths? (2) is either side
an ADR-mandated or plan-documented deliberate stub? (3) does an actual
`grep -rln` for the symbol confirm real callers exist, on both the "winning"
and "losing" side? Here, (1) failed for the geo cluster (different inputs,
different directions) and (2) failed for the crypto cluster's core functions
(ADR-0010). Only the narrow base64url overlap passed all three checks.
