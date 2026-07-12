# Opus Audit — 2026-05-04

**Auditor:** opus model, fresh-eyes pass
**Scope:** Phase 0 implementation + Phase 1 W0 + cross-cutting coherence
**Status:** PASS-WITH-FINDINGS (schema lens) / UNVERIFIED (CI + runtime + plan-doc lenses)
**Process note:** Opus subagent's sandbox blocked Bash, ctx_*, fff_*, foxhound_search, ml, sd, and Write. Only Read against pre-known absolute paths worked. Verification matrix requires re-launch with broader permissions before final Phase 0 sign-off.

## Verification commands run

| Command | Result |
|---|---|
| `git status --short` (parent) | OK — untracked: `.claude/`, `.foxhound/`, `.gitattributes`, `.seeds/`, `PRD.md`, `atlasdraw-tech-spec.md`, `code/`, `docs/`, `staging/` |
| `ls code/` and `ls code/packages/` | OK — `packages/{basemap,cli,common,data,element,excalidraw,geo,math,sdk,tools,utils}` plus `decisions/`, `firebase-project/`, LICENSE files |
| Read `packages/geo/src/{types.ts,index.ts}` + `package.json` + `tsconfig.json` | OK |
| Read `packages/tools/src/{types.ts,index.ts}` + `package.json` + `tsconfig.json` | OK |
| `yarn test:typecheck` | **DENIED** by sandbox |
| `bash scripts/check-{license,patches,telemetry}.sh` | **DENIED** |
| `ml search`, `sd ready`, `sd list` | **DENIED** |
| Read `decisions/cross-phase-audit.md`, `docs/architecture/subsystems/*/contracts.md` | NOT-RUN (no listing tool to discover paths) |

**Audit-process finding (HIGH):** sandbox denied Bash + ml/sd/Write. The verification matrix this audit task requires cannot be executed under this permission profile — re-launch with broader permissions before Phase 0 sign-off.

## Phase 0 implementation correctness (limited to Read-able evidence)

| Artifact | Status |
|---|---|
| Monorepo skeleton, new packages `geo` + `tools` present | ✓ |
| `geo` package — name `@atlasdraw/geo`, license MIT, ESM, `test:typecheck` script wired | ✓ |
| `tools` package — name `@atlasdraw/tools`, license MPL-2.0, depends `@atlasdraw/geo@0.1.0`, tsconfig path-mapped to `../geo/src/index.ts` | ✓ |
| LICENSE files at repo root (MIT, MPL, AGPL, EXCALIDRAW-UPSTREAM, LICENSING.md) | ✓ presence |
| `decisions/` directory contents enumerated | UNVERIFIED |
| CI gate scripts run | UNVERIFIED |
| Strip completeness | **MEDIUM-pending:** `code/firebase-project/` survives — confirm against strip plan |

**Other defects:**
- LOW: `packages/tools` uses `import type { ReactNode } from "react"` but declares no `react` peer dep (only `@types/react` devDep). Works in monorepo via hoisting; breaks on external publish.
- LOW: `packages/geo` `dependencies: {}` is intentional for W0 (types only); Task 4 will need `@turf/*`.

## Phase 1 Wave 0 status

### Task 1 — GeoAnchor types (`packages/geo`) — COMPLETE

`/mnt/Ghar/2TA/DevStuff/atlasdraw/code/packages/geo/src/types.ts:16-19`:
- `GeoAnchor` = discriminated union with `kind: "point"|"bbox"|"polyline"`, every variant carries `zRef: number`. ✓
- `point: {kind, lng, lat, zRef}`, `bbox: {kind, west, south, east, north, zRef}`, `polyline: {kind, coordinates: Array<[number,number]>, zRef}`. ✓
- `ScaleMode = "geographic"|"screen"|"hybrid"` (`:25`). ✓
- `GeoCustomData` (`:34-39`) — field is `geo` (not `geoAnchor`), `projection: "mercator"` literal, `schemaVersion: 1`. ✓
- `isGeoCustomData` (`:42-53`) shallow guard — does NOT recurse into `geo.kind`.

### Task 2 — AtlasdrawTool interface (`packages/tools`) — COMPLETE

`/mnt/Ghar/2TA/DevStuff/atlasdraw/code/packages/tools/src/types.ts:1-138`:
- `LngLatLike`, `ToolPointerEvent` (DOM-event subset, postMessage-safe per Q11), `ToolContext` (map.{project,unproject,getZoom,getBounds} + excalidraw.{addElement,updateElement,getActiveTool} + ui.{showPopup,setStatusBarMessage}), `AtlasdrawElementSeed` (mandatory `geo` + `scaleMode`), `AtlasdrawTool` interface (id/label/icon/cursor + sync hooks, `onPointerDown` required, no async), `ToolRegistry = ReadonlyMap<string, AtlasdrawTool>`. All ✓
- Imports `GeoAnchor, ScaleMode` from `@atlasdraw/geo` — single source of truth.

### Schema vs. MISMATCH-1/3/5 — PASS

| Mismatch | Required | Implemented | Match |
|---|---|---|---|
| MISMATCH-1 | discriminated union with `kind` + `zRef` per variant | `kind: "point"|"bbox"|"polyline"`, `zRef: number` everywhere | ✓ |
| MISMATCH-3 | field `customData.geo` not `geoAnchor` | `GeoCustomData.geo: GeoAnchor` | ✓ |
| MISMATCH-5 | `projection: "mercator"` reserved literal | literal type + guard equality | ✓ |

## Plan/architecture coherence

- Audit incorporation: output-side passes (code matches corrected schema); contracts.md vs. code drift UNVERIFIED.
- Mulch + seeds accuracy: UNVERIFIED (CLIs denied).
- Drift: tools' implicit react peer-dep (LOW); shallow type-guard (LOW); firebase-project survival (MEDIUM-pending).

## Recommended next actions

1. **User:** re-launch this audit (or any verification step) with bash + ml + sd + Write enabled; current sandbox cannot execute the required gates.
2. **Agent (next session):** `cd code && yarn install && yarn test:typecheck` — must pass.
3. **Agent:** run the three CI scripts; capture exit codes to `decisions/phase0-ci-evidence.md`.
4. **Agent:** confirm/remove `code/firebase-project/` per strip plan; record decision in mulch.
5. **Agent:** read `docs/architecture/subsystems/{geo,tools}/contracts.md` and diff against the implemented types.
6. **User:** decide GitHub org.
7. **Agent:** dispatch Phase 1 Wave 1 only after items 2–5 are green.

## Risks not previously surfaced

1. **Auditor sandbox profile blocks the verification matrix the audit task requires** — workflow defect, blocks publish-or-audit-readiness.
2. **`isGeoCustomData` doesn't validate `geo.kind`** — malformed customData will crash downstream pattern-matches. Add `parseGeoCustomData(value): Result<GeoCustomData, ParseError>` in Wave 1.
3. **Implicit `react` runtime dep on `@atlasdraw/tools`** — add `peerDependencies: { "react": ">=18" }` before external publish.
4. **`zRef` accepts any `number`** including negative/non-integer. Validate `0 <= zRef <= maxZoom` at CoordinateSync boundary.
5. **`schemaVersion: 1` has no migration shim** — first schema change will leave every persisted file unhandled. Add identity `migrate(v, fromVersion)` even at v1.

---

**Top 3 high-severity findings:**
1. Auditor permission profile prevented running typecheck/CI/mulch/seeds/Write — Phase 0 cannot be signed off this session.
2. `code/firebase-project/` survived the strip — confirm intent or remove.
3. `isGeoCustomData` is a shallow guard with no `geo.kind` validation — Wave 1 must land a deeper parser before any consumer trusts it.

**Final verdict:** PASS-WITH-FINDINGS on schema lens; UNVERIFIED on CI/runtime lenses.
**Confidence in Phase 0 sign-off:** LOW — schema-only evidence.
**Phase 1 W0 status:** COMPLETE for both tasks; schema matches the audit-incorporator corrections; clean-compile gate not run.
