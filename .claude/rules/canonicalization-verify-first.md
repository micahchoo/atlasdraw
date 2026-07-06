---
scope:
  - code/packages/data/src/base64url.ts
  - code/packages/data/src/yjs-crypto.ts
  - code/apps/atlas-app/src/collab/scene-crypto.ts
  - code/packages/geo/src/**
  - code/packages/basemap/src/CoordinateSync.ts
  - code/apps/atlas-app/src/hooks/useGeoAnchor.ts
tags: [canonicalization, crypto, geo, dedup]
priority: medium
source: hand-written
---

# Base64url helpers live in one place; reprojection is not triplicated — verify before "consolidating"

> Hunting a bug where an element jumps/drifts after a *sequence* of
> operations (zoom, move, paste, undo…)? That's not a duplication problem —
> use `Skill('geo-op-idempotency-hunt')` for the systematic sequence-matrix
> hunt before editing CoordinateSync or useGeoAnchor.

`uint8ArrayToBase64Url`/`base64UrlToUint8Array` live in exactly one place:
`packages/data/src/base64url.ts`, exported from the package barrel.
`yjs-crypto.ts` and `scene-crypto.ts` both import it. If you need base64url
framing anywhere else, import from `@atlasdraw/data` — do not write a private
copy. (See `CANON.md` for the full before/after: this pair was previously
copy-pasted verbatim, one file's header literally said "mirrors" the other.)

`encryptUpdate`/`decryptUpdate` (yjs-crypto.ts) and `encryptScene`/
`decryptScene` (scene-crypto.ts) are **not** duplicates of each other and
must not be merged. They encrypt different payloads (raw Yjs binary update
bytes vs. JSON-serialized Excalidraw scene) for different channels
(y-websocket vs. Socket.IO). `yjs-crypto.ts`'s functions are a deliberate,
ADR-0010-mandated unwired stub — ADR-0010 explicitly considered and rejected
deleting them. Don't "pick a winner" between these two pairs.

`CoordinateSync._projectElement` (geo→screen, live map state) and
`useGeoAnchor`'s `buildGeoCustomData`/`reanchorIfMoved` (screen→geo, native-
tool lifecycle) both branch on `GeoAnchor.kind` (point/bbox/polyline), and
both call the shared primitives in `packages/geo/src/projection.ts` +
`scaleMode.ts` — that shared-primitive layer is the actual canonicalization.
The two `switch` statements themselves are not duplicates: different input
(live map camera vs. drawn/moved element), different direction (forward vs.
reverse projection), different lifecycle. Do not attempt to merge them into
one shared "reprojection" function, and do not read the repeated
point/bbox/polyline shape as proof of copy-paste — that shape is inherent to
having three `GeoAnchor` kinds, not a duplication smell by itself.

## Why this rule exists

Issue 5 in ISSUES.md claimed GeoAnchor reprojection was implemented "three
times" including `packages/geo/src/{geoToExcalidraw,excalidrawToGeo}.ts`.
On inspection those two files did no reprojection at all (no `map`, no zoom,
no `projectPoint`/`unprojectPoint` call) — they were a dead GeoJSON-import
skeleton builder, superseded when the actual GeoJSON import path
(`useGeoJsonDrop.ts`) shipped a different architecture (MapLibre data layers,
not individual anchored elements). They were deleted as dead code; treating
them as "the same logic, third copy" and merging CoordinateSync/useGeoAnchor
into them would have broken both features. Structural similarity (same
helper names, same switch shape) is not proof of duplicated logic — verify
consumers and data flow before picking a winner. Full writeup: `CANON.md`.
