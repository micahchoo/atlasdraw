# Phase 2 Wave 1 — Pre-dispatch scrub

**Date:** 2026-05-04
**Plan under scrub:** `docs/superpowers/plans/2026-05-03-atlasdraw-phase-2-tools-data-layers.md` (T03–T10)
**Trigger:** mulch convention `mx-e9dc63` + `mx-d9ab91` + `.claude/rules/excalidraw-api.md` — plan literals stale within 24h of authoring; T02 had 4 regressions; expect more in Wave 1.
**Authority:** canonical impl is `code/packages/tools/src/{types.ts, PinTool.ts}` and `code/packages/geo/src/types.ts` (post Wave 0 + Phase 1 final state).

---

## Verdict

**DO NOT dispatch Wave 1 (T03–T10) as written.** The plan has 3 classes of regression on settled Phase 1 decisions. None block dispatch outright once briefs include the corrections below — the failures are all caught at the brief-authoring layer.

| Class | Severity | Tasks affected | Fix locus |
|---|---|---|---|
| **A. `ctx.excalidraw.updateScene` is not on `ToolContext`** (Q11 boundary regression) | HIGH | T03, T07, T09 | rewrite to use `ctx.excalidraw.addElement` / `updateElement` per PinTool pattern |
| **B. `ctx.excalidraw.setActiveTool` is not on `ToolContext`** (Q11 boundary regression + semantically wrong) | HIGH | T06 | drop the call; tool deactivation is a host concern (atlas-app's `useAtlasdrawTool.ts`) |
| **C. File paths omit `src/` segment** (same class as T01 SNAG, will fail tsc per `tools/tsconfig.json` `rootDir: "./src"`, `include: ["src/**/*"]`) | MED | T03–T09 (all 7 tools), T10 | prepend `src/` to every plan literal in worker briefs |

---

## Canonical surfaces (verified 2026-05-04)

```ts
// code/packages/tools/src/types.ts (post Wave 0)
ToolContext.excalidraw = {
  addElement: (seed: AtlasdrawElementSeed) => string;
  updateElement: (id: string, patch: Partial<AtlasdrawElementSeed>) => void;
  getActiveTool: () => string;
}
// NO updateScene. NO setActiveTool. NO direct mutation.
// AtlasdrawTool.defaultScaleMode: ScaleMode required (Wave 0 added)

// code/packages/geo/src/types.ts
ScaleMode = "geographic" | "screen" | "hybrid"   // all 3 used by plan, all valid
GeoAnchor =
  | { kind: "point"; lng; lat; zRef }
  | { kind: "bbox";  west; south; east; north; zRef }
  | { kind: "polyline"; coordinates: Array<[number, number]>; zRef }
// "polygon" is NOT a kind — closed rings are encoded as polyline with first==last

// code/packages/tools/src/PinTool.ts — canonical reference impl pattern
// (uses ctx.map.unproject + ctx.excalidraw.addElement only; no updateScene)

// code/packages/tools/tsconfig.json
{ rootDir: "./src", include: ["src/**/*"] }
```

---

## Per-task drift table

| Task | Plan literal (file:line) | Drift | Required correction |
|---|---|---|---|
| T03 Polygon (line 312) | `packages/tools/PolygonTool.ts` | path missing `src/` | → `code/packages/tools/src/PolygonTool.ts` |
| T03 Polygon (line 338) | `excalidrawAPI.updateScene` on ring close | not on `ctx.excalidraw` | → `ctx.excalidraw.addElement({ type:"freedraw", customType:"polygon", geo:{kind:"polyline",coordinates,zRef}, scaleMode:"geographic", ... })` |
| T03 Polygon (line 340) | "Polygon rendered via Excalidraw's `freedraw` element type with `simulatePressure: false`" | `simulatePressure` is set per-element on freedraw elements; verify the field exists on the v0.18 freedraw type before quoting (`grep -n simulatePressure code/packages/excalidraw/`) | grep before brief; if absent, freedraw + closed-ring may need a different element type |
| T04 Polyline (line 358) | `packages/tools/PolylineTool.ts` | path missing `src/`; also `tools/src/index.ts` pre-stubs **`LineTool`** not `PolylineTool` (line 7 comment) | → pick one name and update both. PolylineTool aligns with plan; LineTool aligns with stub. RECOMMEND PolylineTool (aligns with `kind:"polyline"` GeoAnchor) and update the index.ts stub. |
| T04 Polyline (line 379) | "Rendered via Excalidraw `line` or `arrow` (no arrowhead) element type" | unverified; grep v0.18 element types for both `line` and `arrow` semantics before brief | `grep -n "type.*\"line\"\|type.*\"arrow\"" code/packages/excalidraw/element/types.ts` |
| T05 Freehand (line 388-431) | (no API drift detected) | OK | proceed as written, just prepend `src/` to file paths |
| T06 TextLabel (line 441) | `packages/tools/TextLabelTool.ts` | path missing `src/` | → `code/packages/tools/src/TextLabelTool.ts` |
| T06 TextLabel (line 463) | `excalidrawAPI.setActiveTool({ type:"text" })` after element creation | (a) `setActiveTool` not on `ctx.excalidraw`; (b) tools should not activate other tools — this couples the tool layer to Excalidraw's tool system, which we explicitly opted out of (per `mx-682f8a`: "atlasdraw tools dispatch independently of Excalidraw tool system via overlay") | drop the call. If inline text editing is desired, that's a host-side concern — emit the text element with empty content and let atlas-app's overlay decide whether to focus it for editing. File a follow-up seed: "TextLabelTool inline editing UX — host-side decision". |
| T07 Arrow (line 484) | `packages/tools/ArrowTool.ts` | path missing `src/` | → `code/packages/tools/src/ArrowTool.ts` |
| T07 Arrow (line 506) | `onPointerUp: ... call updateScene` | not on `ctx.excalidraw` | preview pattern: `onPointerDown` → `addElement` returns id → `onPointerMove` → `updateElement(id, { ...newHead })` → `onPointerUp` → final `updateElement` |
| T08 Rectangle (line 535) | `packages/tools/RectangleTool.ts` | path missing `src/` | → `code/packages/tools/src/RectangleTool.ts` |
| T08 Rectangle | (no API drift) | OK on `kind:"bbox"` ✓ | use preview pattern (addElement on down, updateElement on move/up) |
| T09 Circle (line 568) | `packages/tools/CircleTool.ts` | path missing `src/` | → `code/packages/tools/src/CircleTool.ts` |
| T09 Circle (line 583) | "second element in updateScene call" (test) + line 506-pattern (impl) | `updateScene` drift | preview pattern with two addElement calls (circle + companion text) — test asserts the two seeds, not "second element in updateScene call" |
| T09 Circle (line 594) | `import distance from "@turf/distance";` + line 617 `pnpm add @turf/distance @turf/circle` | (a) **NEW DEP** — must serialize per mulch `mx-372bdb` (cross-worker dep additions serialize, not parallelize). T09 cannot run in the same wave as T03–T08. (b) Plan says `pnpm` but project uses **yarn 1.22** (per code/.yarnrc evidence + prior session installs). | extract dep-add to a serial pre-T09 step: `cd code && yarn add @turf/distance @turf/circle -W` (or in `apps/atlas-app/` if atlas-only consumer). Then T09 dispatches AFTER install commits. |
| T10 GeoJSON parser (line 638) | `packages/data/geojson.ts` | path missing `src/`; package exists (verified) | → `code/packages/data/src/geojson.ts` (verify `data/tsconfig.json include` first; assume same `src/**/*` pattern) |

---

## Dispatch shape

**Wave 1 must split into two sub-waves:**

### Wave 1a — Setup (serial, must commit before 1b)
Add this to a new task **T-W1-DEPS** (not in plan):
1. `cd code && yarn add @turf/distance @turf/circle -W` (workspace add) OR `cd code/apps/atlas-app && yarn add @turf/distance @turf/circle` (if circle-only consumer).
2. `yarn build` to verify install didn't break anything.
3. Commit `package.json` + `yarn.lock` change with message `chore(deps): @turf/distance + @turf/circle for Phase 2 Wave 1 T09`.

### Wave 1b — Tools + Parser (8 parallel workers on the post-1a tree)
T03, T04, T05, T06, T07, T08, T09, T10 dispatch simultaneously.

**Shared prefix MUST include:**
- Full `code/packages/tools/src/types.ts` (canonical AtlasdrawTool + ToolContext)
- Full `code/packages/tools/src/PinTool.ts` (canonical impl pattern — addElement-only, no updateScene)
- Full `code/packages/geo/src/types.ts` (ScaleMode + GeoAnchor)
- This scrub doc's per-task drift table verbatim
- The `.claude/rules/excalidraw-api.md` rule

**Each worker delta MUST:**
- Quote the corrected file path (with `src/`)
- Reference the canonical pattern: "use `ctx.excalidraw.addElement` (returns id) + `ctx.excalidraw.updateElement(id, patch)` for previews — never `updateScene` (not exposed on ctx; doing so reverts Q11 boundary)"
- For T04: explicitly choose PolylineTool vs LineTool name and update `index.ts` stub
- For T06: drop the `setActiveTool` call; file follow-up seed for inline-editing UX

---

## Brief-authoring checklist (use this for every Wave 1b task)

Before sending each worker brief:

1. ☐ File path includes `src/` (T01 class of error, see HANDOFF.md SNAG 2026-05-04)
2. ☐ No `ctx.excalidraw.updateScene` mention (Q11 boundary)
3. ☐ No `ctx.excalidraw.setActiveTool` mention (Q11 boundary + tool-system independence per `mx-682f8a`)
4. ☐ `defaultScaleMode` declared at top of tool object (Wave 0 added this required field)
5. ☐ `GeoAnchor.kind` is one of `point | bbox | polyline` only (no `polygon`)
6. ☐ `ScaleMode` value is one of `geographic | screen | hybrid` only
7. ☐ Imports use `.js` suffix per existing PinTool pattern (`from "./types.js"` — ESM convention in this monorepo)
8. ☐ Test file path mirrors source: `code/packages/tools/src/__tests__/<Name>.test.ts` OR `code/packages/tools/src/<Name>.test.ts` colocated (PinTool uses colocated — verify which the plan wants and align)
9. ☐ For T09 only: brief lists `@turf/distance` as **assumed installed** (T-W1-DEPS landed pre-dispatch); does not include the install step
10. ☐ Element factory pattern: use `ctx.excalidraw.addElement({ type, customType?, geo, scaleMode, ... })` — no direct calls to `newElement` / `newElementWith` (those are vendored Excalidraw factories; the tool layer is decoupled per `mx-682f8a`)

---

## Open questions surfaced by scrub (need decision before dispatch)

1. **OQ-W1-1**: T03 polygon — is the rendered Excalidraw element type `freedraw` (plan literal) the right choice for a closed geo-anchored region? `freedraw` is for hand-drawn pressure paths. Alternatives: `line` (with closed ring), or a custom `polygon` customType. **Decide before T03 brief.**
2. **OQ-W1-2**: T06 TextLabel — drop the `setActiveTool` call leaves the question of how the user enters text. Options: (a) tool emits empty text element + atlas-app overlay focuses it; (b) tool emits text element with placeholder text; (c) defer text-entry UX to a separate task. **Decide before T06 brief.**
3. **OQ-W1-3**: T04 PolylineTool vs LineTool naming — `tools/src/index.ts` line 7 pre-stubs `LineTool`; plan T04 calls it `PolylineTool`. Pick one. RECOMMEND: PolylineTool (aligns with `GeoAnchor.kind:"polyline"`).
4. **OQ-W1-4**: Test file location — colocated (PinTool pattern: `src/PinTool.test.ts`) or `__tests__` subdir (plan pattern: `src/__tests__/PolygonTool.test.ts`)? Inconsistency in plan. RECOMMEND: colocated, matching PinTool.
5. **OQ-W1-5**: `@turf/circle` listed in T09 install but not used in T09 step 2 code block. Remove from install or surface its usage. RECOMMEND: install both if any Wave 2 task references it; else drop `@turf/circle` from the install command.

---

## Post-scrub recommendation

1. **User decisions on OQ-W1-1 through OQ-W1-5** before dispatch (5 minutes).
2. **Author T-W1-DEPS** as a serial task; execute it; commit; **then** dispatch Wave 1b.
3. **Brief authoring**: use this scrub doc as the per-task delta source; the 10-point checklist above is the brief author's gate.
4. **Update Phase 2 plan in-place after dispatch** with corrected literals + the OQ resolutions, so the plan stops being a stale source for any retrospective.

---

## Artifacts to file post-decisions

- (will create) seeds issue: "TextLabelTool inline-editing UX — host-side decision" (T06 follow-up if OQ-W1-2 resolves to (a) or (c))
- (will create) mulch convention: "Plan literals omit `src/` segment — class of error caught in T01 (HANDOFF SNAG 2026-05-04) and Wave 1 scrub T03/T04/T06/T07/T08/T09/T10. Always grep `tsconfig.json` for `rootDir`/`include` before quoting plan paths."
- (in-place) Phase 2 plan amendment block citing this scrub doc.

---

## Addendum (after advisor review + deeper grep)

The advisor caught three gaps in the original scrub. All three converge on **a single conclusion: Wave 1a (setup) is much larger than initially scoped — the host integration seam for non-Pin tools literally does not exist yet.**

### Addendum-1: T05 + T08 read in full (advisor gap #1)

- **T05 Freehand**: no `updateScene` or `setActiveTool` mention. Step 2 says "Create freedraw element with smoothed coordinates" — implementation will use `ctx.excalidraw.addElement` (single-shot at `onPointerUp` after RDP simplification). **No drift on Q11 boundary.** Path fix only (`src/`).
- **T08 Rectangle**: drag preview pattern (`onPointerDown` record corner → `onPointerMove` "update preview element width/height" → `onPointerUp` finalize). Does NOT name `updateScene` or `setActiveTool`. **But:** the "update preview element width/height" call requires `ctx.excalidraw.updateElement(id, patch)` — see Addendum-3 for why this won't work today.

**Net:** my original "T05/T08 are clean" was right on Q11 boundary, wrong on the implicit dependency on `updateElement`.

### Addendum-2: OQ-W1-1 and T04 element-type questions are GREP answers, not user questions (advisor gap #2)

Verified `code/packages/element/src/types.ts`:
- Element types present: `arrow`, `text`, `line`, `freedraw` (line 389 — with `simulatePressure: boolean` field at line 392). **No `polygon` element type exists in v0.18.**
- Therefore: **OQ-W1-1 RESOLVED → keep `freedraw` for T03 polygon.** It's the only available element type for closed filled regions in v0.18. Plan literal `simulatePressure: false` is valid.
- **OQ-W1-3-element-type for T04 RESOLVED → use `line` (not `arrow` no-arrowhead).** Both exist; `line` is semantically correct for an open polyline.
- **OQ-W1-3-naming**: PolylineTool (recommendation stands; user decision).

### Addendum-3: Preview pattern verification — Q11 seam not implemented (advisor gap #3, escalated)

The advisor asked: "does `Partial<AtlasdrawElementSeed>` let you patch `geo` cleanly mid-drag, and does the host's `seedToElement` bridge handle re-projection on geo updates?"

The answer is **worse than expected**:

**Finding A — `seedToElement.ts:40-44` only accepts `customType: "pin"`:**
```ts
if (seed.type !== "custom" || seed.customType !== "pin") {
  throw new Error("seedToElement: only customType=pin supported in Phase 1");
}
```
Every Wave 1 tool produces a non-pin seed. Every `addElement` call will throw at runtime. **T03–T09 cannot ship until this bridge is extended.**

**Finding B — `useAtlasdrawTool.ts:89-95` has `updateElement` as a noisy stub:**
```ts
// Phase 1: PinTool doesn't use updateElement. Keep as a noisy stub so
updateElement: () => {
  console.warn("ctx.excalidraw.updateElement: not implemented in Phase 1");
}
```
Every drag-preview tool (T07, T08, T09) and multi-vertex tool (T03, T04, T05) needs this for `onPointerMove` updates. **The seam doesn't exist.**

**Implication:** Wave 1a must add real implementation work BEFORE the parallel Wave 1b can dispatch. The seam-completion is itself plan-amendment-grade — it's not in the Phase 2 plan as written.

---

## Revised Wave 1a (mandatory pre-1b setup)

| Task | Description | Serial constraints | Estimate |
|---|---|---|---|
| **T-W1a-DEPS** | `cd code && yarn add @turf/distance @turf/circle -W` (or scope to atlas-app); commit lockfile change | filesystem-mutex per `mx-372bdb` — must serialize against any other dep-add | 5 min |
| **T-W1a-BRIDGE** | Extend `code/apps/atlas-app/src/tools/seedToElement.ts` to handle: `freedraw` (polygon T03 + freehand T05), `line` (polyline T04), `text` (T06), `arrow` (T07), `rectangle` with `bbox` geo (T08), `ellipse` with `point` geo for circle (T09). Uses Excalidraw factories from `@excalidraw/element` per existing pattern. **Each branch must construct the matching `GeoCustomData` wrapper.** Tests for each branch. | Touches `seedToElement.ts` — single-file mutex. | 60–90 min |
| **T-W1a-UPDATEEL** | Implement `ctx.excalidraw.updateElement(id, patch)` in `useAtlasdrawTool.ts:91`. Must call `excalidrawAPI.updateScene` (host-side, not exposed to tools) with the patched element AND re-run projection if `patch.geo` is present so previews track on camera move. Coordinate with `useCoordinateSync` to avoid double-projection. | Touches `useAtlasdrawTool.ts` — single-file mutex. Can run parallel to T-W1a-BRIDGE (different files) but both must commit before Wave 1b. | 45–60 min |
| **T-W1a-PREVIEW-DOC** | Add a canonical preview-pattern code block to `docs/architecture/subsystems/tools/contracts.md` (preview = `id = addElement(seed); ...; updateElement(id, patch); ...`) — referenced by all preview-using briefs. | Doc-only; can run in parallel. | 15 min |

**Wave 1a dispatch shape:** T-W1a-DEPS first (lockfile mutex), then T-W1a-BRIDGE + T-W1a-UPDATEEL + T-W1a-PREVIEW-DOC in parallel. **Three commits land** before Wave 1b kicks off.

---

## Revised dispatch flow

```
[Now] → T-W1a-DEPS (serial)
        → commit
[Then] → T-W1a-BRIDGE  ┐
        → T-W1a-UPDATEEL ┤ (parallel, 3 separate commits or 1 bundled)
        → T-W1a-PREVIEW-DOC ┘
[Then] → Wave 1b parallel: T03, T04, T05, T06, T07, T08, T09, T10
        → 8 commits or 1 bundled (decision time)
```

---

## Resolved/clarified open questions

- **OQ-W1-1 (freedraw vs polygon for T03):** RESOLVED → freedraw (only option in v0.18, `simulatePressure: false` field confirmed valid).
- **OQ-W1-3-element-type (T04 line vs arrow):** RESOLVED → line.
- **OQ-W1-3-naming (PolylineTool vs LineTool):** still user — RECOMMEND PolylineTool, update `index.ts` stub.
- **OQ-W1-2 (T06 text-entry UX after dropping setActiveTool):** still user — needs product call. RECOMMEND defer-and-emit (T06 emits empty text element, file follow-up seed for inline-editing UX as a Phase 2 polish task).
- **OQ-W1-4 (test colocation vs `__tests__/`):** still user — RECOMMEND colocated to match PinTool.
- **OQ-W1-5 (`@turf/circle` install but unused):** RESOLVED → install both, in case Wave 2 references @turf/circle for circle→polygon conversion (T14 convert-to-data-layer for circles needs polygon approximation).

---

## Final user decisions needed (3, not 5)

1. **OQ-W1-3-naming**: PolylineTool (recommended) vs LineTool? *(naming consistency call)*
2. **OQ-W1-2 (text UX)**: defer-and-emit (recommended) vs inline T06 task to figure out text entry now? *(scope call)*
3. **OQ-W1-4 (test location)**: colocated (recommended) vs `__tests__/` subdir per plan? *(style call)*

All other plan drifts are now answered by canonical-source greps and don't need user input.

---

## What changed since first draft

- **3 user decisions** (down from 5; advisor flagged that greps answer the others).
- **+4 setup tasks** in Wave 1a (was just T-W1-DEPS); the BRIDGE + UPDATEEL findings escalate Wave 1a from "5 min" to "~2 hours of real implementation".
- **Confidence shift**: Wave 1b dispatch readiness is now **lower** — three real implementation gates (seedToElement extension, updateElement impl, preview-pattern doc) sit between the user's OQ resolution and a clean parallel Wave 1b.
