# Atlasdraw — Quality Bars and Enforcement

**Status: Speculative.** Predicted post-Phase-7 shape; revise against real code.
**Schema:** codebase-mapping-schema.md § Quality
**Last updated:** 2026-05-03

---

## Overview

This document describes Atlasdraw's quality bars — performance budgets, bundle size limits, browser support matrix, accessibility targets, license compliance, and security gates — and how each is enforced in CI and phase acceptance criteria.

[CONFIDENCE: high] marks bars derived from the tech spec, open-questions resolutions, or phase plan acceptance criteria. [CONFIDENCE: med] marks bars implied by the stack and phase plan tooling but not explicitly stated in a spec section.

---

## Performance Budget

**Source:** Tech Spec §8, Q8 resolution [CONFIDENCE: high]

### Targets

| Metric | Target | Measurement method |
|---|---|---|
| Animation frame rate | 60fps during pan/zoom with 5k annotations + 50k MapLibre features | Playwright frame-timing in Phase 1 benchmark |
| `syncMapToScene` per-call budget | <8ms at p95 for 5k geo-anchored elements | Synthetic benchmark, `bench/results/phase-1-baseline.json` |
| Editor bundle size (gzipped) | <800KB | `size-limit` CI gate on `apps/atlas-app` |
| Embed SDK bundle size (gzipped) | <300KB | `size-limit` CI gate on `packages/sdk` (Phase 6 Task 22) |

### Phase 1 Benchmark Gate

Q8 resolved that the performance numbers in the spec are preliminary targets, not measured baselines. Phase 1 includes a mandatory benchmark spike before Phase 2 can begin:

1. Synthetic scene of 5,000 geo-anchored elements.
2. Automated pan/zoom across the scene.
3. Measure `syncMapToScene` p50/p95/p99 frame time.
4. Record results in `bench/results/phase-1-baseline.json`.

**Gate condition:** If baseline misses the <8ms p95 budget by more than 2x (i.e., p95 > 16ms), a "switch to incremental projection" task is added to Phase 1 before it is declared done. Phase 2 does not start until Phase 1 meets budget.

### Phase 2 Regression Gate

Phase 2 acceptance re-runs the Phase 1 benchmark with real data layers added. The regression budget is **+20%**: if Phase 1 baseline was X ms, Phase 2 must stay below X * 1.2. A regression beyond +20% is a blocking defect for Phase 2, not a deferral.

### Performance-Critical Code Constraints

`CoordinateSync.syncMapToScene()` is the hot path — O(n) at up to 60Hz. Constraints:
- No allocations per element in the projection loop if avoidable.
- No async calls inside the projection loop.
- Throttle at 16ms (not per-event) to cap at ~60Hz.
- `captureUpdate: "never"` on all `excalidrawAPI.updateScene()` calls from `syncMapToScene` — undo stack must not be polluted.

---

## Bundle Size CI Gate

**Source:** Phase 6 Task 22, Tech Spec §4.5 [CONFIDENCE: high]

### Editor Bundle (`apps/atlas-app`)

Target: <800KB gzipped. [CONFIDENCE: med — extrapolated from the 300KB embed target and the PRD's "fast load" principle; no explicit spec reference for the editor bundle]

A `size-limit` configuration in `apps/atlas-app` enforces this in CI. PRs that push the editor bundle above the limit must either trim the addition or explicitly raise the limit with justification.

### Embed SDK Bundle (`packages/sdk`)

Target: <300KB gzipped. Hard gate — merge is blocked if exceeded.

```json
[
  {
    "path": "packages/sdk/dist/atlasdraw-embed.js",
    "gzip": true,
    "limit": "300 KB"
  }
]
```

CI workflow `.github/workflows/bundle-size.yml` triggers on PRs touching `packages/sdk/`. Failure message includes current size to help authors know how much to trim.

The embed SDK's small bundle target is load-bearing for the product: the embed is positioned as a lightweight widget for third-party pages. A 300KB+ embed is a non-starter for many host pages.

---

## Browser Matrix

**Source:** Phase 1 Task 17, cross-browser hardening [CONFIDENCE: high]

All five columns must be PASS before a phase is declared complete:

| Browser | Method |
|---|---|
| Chrome (latest stable) | Playwright automated |
| Firefox (latest stable) | Playwright automated |
| Safari / WebKit | Playwright WebKit proxy (automated); manual for some flows |
| iOS Safari | Manual (physical device or Simulator) |
| Android Chrome | Manual (physical device or emulator) |

Test matrices are documented per phase at `docs/test-matrix/phase-N.md`. Known-broken entries are marked `[DEFER Pn]` with an issue reference and do not block the phase unless they are in the critical happy path (pan, zoom, draw, save).

Phase 1 establishes the baseline matrix (`docs/test-matrix/phase-1.md`). Subsequent phases inherit and extend it.

---

## Accessibility

**Source:** Phase 6 a11y pass mention [CONFIDENCE: med — Phase 6 includes an a11y pass; details not fully specified]

### Phase 6 a11y Gate

Phase 6 (v1.0) includes a dedicated accessibility pass as a release-candidate gate. At minimum:
- Keyboard navigation throughout the editor (tool switching, canvas interaction, layer panel, comments).
- Screen reader compatibility for non-canvas UI elements (sidebar, dialogs, toolbars).
- Color contrast ratios meeting WCAG 2.1 AA for all text elements in the default theme.

Ongoing: keyboard navigation and screen reader tests are part of the standard test suite after Phase 6.

The canvas itself (Excalidraw and MapLibre surfaces) has inherently limited screen reader accessibility. The a11y pass focuses on the surrounding application chrome, not canvas pixel content.

---

## License Compliance CI

**Source:** Q5 resolution, Phase 6 OQ7 finding [CONFIDENCE: high]

### Per-Package SPDX Check

CI validates that every `packages/*/package.json` and `apps/*/package.json` contains a `"license"` field with a valid SPDX identifier. New packages without a `"license"` field fail CI. This gate runs on every PR.

### Asset Library License Scan (Phase 6 OQ7)

The open-questions audit flagged a gap: asset libraries bundled in the editor (icons, symbol sets, any image assets) must have their licenses explicitly verified before v1.0 ships. Phase 6 Task (OQ7 fix) includes:
- A license scan of all bundled assets.
- A manifest of asset licenses at `docs/asset-licenses.md`.
- CI rejection of new assets without a corresponding license entry.

### Plugin License Requirement (Phase 7)

Plugin manifests must declare a valid SPDX `"license"` field. `PluginManifest.validate()` throws at install time if the field is absent or invalid. This extends the license enforcement discipline from packages to third-party plugins.

---

## Cross-Phase Consistency

**Source:** `docs/decisions/cross-phase-audit.md` [CONFIDENCE: high]

The cross-phase audit is a standing practice: every phase boundary contract is verified at `git merge` time before the next phase begins. The audit document records:
- Mismatches between what a phase produces and what the next phase expects.
- Fields or APIs that appear under different names in different phases (e.g., MISMATCH-3: `customData.geo` vs `customData.geoAnchor`).
- Spec sections that contradict open-questions resolutions.

Audit findings are classified as blocking (must be resolved before phase merge) or non-blocking (tracked, resolved in the next phase). A phase does not graduate to "done" status until all blocking audit items are resolved.

---

## Telemetry Policy Compliance

**Source:** ADR `0006-telemetry.md`, Phase 6 Task 23 [CONFIDENCE: high]

Every release is reviewed for unwanted call-home behavior. The telemetry guard CI step (Phase 6 Task 23) fails if:
- Any new network call is detected in `packages/sdk` bundle analysis.
- Any call to a telemetry endpoint is detected in the OSS `apps/atlas-app` bundle without an explicit `MANAGED_MODE=true` guard.

The guard is automated and runs on every PR touching `packages/sdk` or `apps/atlas-app`. Manual review is required for major version releases.

---

## Security Review Gates

**Source:** Phase 6/7 plan task annotations, adversarial-api-testing skill [CONFIDENCE: high]

### Phase 4 — Share Endpoints

Phase 4 Task 4 (share endpoint) carries a mandatory `adversarial-api-testing` skill annotation. Acceptance criteria include passing all adversarial sub-checks: token entropy, TTL enforcement, scope enforcement (mode set server-side), replay prevention.

### Phase 5 — Collaboration

Phase 5 relay tasks carry `adversarial-api-testing` annotations for rate limiting, payload size limits, and relay-never-decrypts invariant.

### Phase 6 — SDK and Hosted Mode

Phase 6 release-candidate gates include:
- **Postmessage round-trip test** (Task 21): every public method on `AtlasdrawAPI` passes a structured-clone round-trip. CI fails if a new method violates the contract.
- **Telemetry guard** (Task 23): no unauthorized network calls in SDK or OSS app bundle.
- **Hosted E2E** (Task 25): end-to-end hosted-mode smoke test.

### Phase 7 — Plugin Sandbox

Phase 7 Task 2 (Worker sandbox) includes adversarial tests in `packages/plugin-host/test/sandbox-escape.test.ts`:
- Attempt DOM access from plugin Worker → fails.
- Attempt arbitrary `fetch` to unlisted host → permission rejected.
- Attempt `importScripts` → throws.
- Attempt `new XMLHttpRequest()` → `undefined` / TypeError.

These tests run in CI. If any escape vector is discovered during the test run, it is a blocking defect for Phase 7.

Every Phase 6/7 task annotated with `Skill: adversarial-api-testing` triggers a security gate: the PR cannot merge until all adversarial sub-checks in the task description are satisfied and documented.

---

## AtlasdrawAPI Stability Gate (Phase 6)

**Source:** Phase 6 Task 26, ADR `0005-sdk-postmessage-contract.md` [CONFIDENCE: high]

At the end of Phase 6, the `AtlasdrawAPI` interface is declared frozen and `packages/sdk` is published as `v1.0.0`. The gate steps:

1. All Phase 6 Wave 0–4 tasks complete.
2. All five CI gates green (bundle-size, postmessage-roundtrip, telemetry-guard, hosted-e2e, a11y).
3. ADR `0005` status updated to `"Accepted — Interface frozen at v1.0.0. Breaking changes require a new ADR."`.
4. `packages/sdk/package.json` bumped to `"version": "1.0.0"`.
5. Repository tagged `v1.0.0`; release workflow triggered.
6. `@atlasdraw/sdk@1.0.0` published to npm.

After the freeze, any breaking change to `AtlasdrawAPI` requires a new ADR. The Phase 7 plugin sandbox builds on this frozen surface; a breaking change in Phase 7 would invalidate every plugin author's contract.

---

## Property-Based Testing (Geo Math)

**Source:** Phase 1 Task 9 [CONFIDENCE: high]

The `packages/geo` package uses `fast-check` for property-based tests over projection math. The key property: for any valid `(lng, lat)` in the Mercator-valid range (`lng ∈ [-179, 179]`, `lat ∈ [-85, 85]`), project then unproject must round-trip within floating-point tolerance (`|lng' - lng| < 1e-6`, `|lat' - lat| < 1e-6`).

The mock `maplibregl.Map` used in these tests implements actual Mercator math via `maplibre-gl`'s `MercatorCoordinate.fromLngLat` — not a hand-written approximation. Using a fake math implementation in tests would undermine the correctness guarantee.

Property tests run 100 trials per vitest run. If a shrunk counterexample is found, it is added as a regression fixture.

---

## File Format Round-Trip Gate

**Source:** Phase 3 Task 12 [CONFIDENCE: high]

`packages/data/src/__tests__/round-trip.test.ts` is a required acceptance test for the file format. It must pass before Phase 3 is declared done. The test covers:

1. **Minimal document:** one layer (3 features), 2 scene elements, no binary files, no thumbnail. Full `write()` → `read()` cycle; assert structural equality.
2. **Binary files:** same document + 1 JPEG `Blob`. Assert file count preserved after round-trip.
3. **Error paths:** `read()` on a malformed zip throws `AtlasdrawFormatError` with the correct `code` field.

Structural equality for round-trip purposes means: same `manifest.id`, same `manifest.layers.length`, same feature count per layer, same scene element IDs. Float precision differences in coordinates are permitted (serialization may introduce sub-epsilon drift).

---

## Rate-Limit Enforcement (Collaboration)

**Source:** Phase 5 Task 5 [CONFIDENCE: high]

The relay (`apps/realtime`) enforces per-socket message rate limits as a quality gate for the collaboration subsystem. These are not just operational limits — they are part of the correctness contract for the relay:

| Event | Max rate | Max payload |
|---|---|---|
| `CURSOR` | 60/s per socket | 1KB |
| `MAP_CAMERA_UPDATE` | 30/s per socket | 1KB |
| `SCENE_UPDATE` | 10/s per socket | 256KB |
| `COMMENT` | 5/s per socket | 64KB |

Out-of-rate messages are silently dropped and logged at WARN level with socket ID and event type. These limits are enforced by `apps/realtime/src/rate-limit.ts` and tested with adversarial scenarios (burst 1000 CURSOR events/s; assert only 60 relayed per second window).

---

## Felt Importer Quality Bar (Phase 6, Q13)

**Source:** Q13 resolution, Phase 6 [CONFIDENCE: med]

The Felt importer ships in v1.0 as a **read-only** import path. Quality bar for the importer:

- Imports Felt map exports correctly for the documented subset of Felt layer types.
- Import failures produce a user-facing error with the unsupported element type named explicitly.
- No Felt-specific state persists after import; the result is a standard `AtlasdrawDocument` with no Felt provenance.
- The importer has no network dependency at import time (reads from a local file, not the Felt API).

The Felt importer is `[CONFIDENCE: low]` on specific implementation details — Q13 confirms it is in v1.0 scope but the phase plan does not fully specify the importer task breakdown.
