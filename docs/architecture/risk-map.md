# Atlasdraw — Risk Map

**Status: Speculative.** Derived from spec §11, escalations doc (E-01, E-02, E-03),
cross-phase audit, and phase plan research notes. No code exists.

Cross-references: see `subsystems.md` for subsystem boundaries, `evolution.md` for
re-evaluation points, `ecosystem.md` for external dependency risks.

---

## Summary Table

| ID | Risk | Severity | Category | Owner Phase | Escalation |
|----|------|----------|----------|-------------|-----------|
| R-01 | Coordinate sync drift | High | Technical | Phase 1 | — |
| R-02 | GeoAnchor type mismatch | High | Technical | Phase 1 | MISMATCH-1,-3,-5 |
| R-03 | Excalidraw fork churn | High | Technical | Ongoing | — |
| R-04 | Bundle size cliff | Medium | Technical | Phase 4/6 | — |
| R-05 | Performance regression under large datasets | Medium | Technical | Phase 1/2 | — |
| R-06 | Yjs E2EE boundary | High | Security | Phase 5/6 | E-01 |
| R-07 | Plugin Worker sandbox weakness | Medium | Security | Phase 7 | — |
| R-08 | License contagion (AGPL) | Medium | Legal | Phase 0 | — |
| R-09 | Attribution removal (AGPL §7) | Low | Legal | Phase 0 | — |
| R-10 | OpenFreeMap / basemap uptime | Medium | Operational | Phase 4 | — |
| R-11 | Maintainer bandwidth exhaustion | Medium | Operational | Ongoing | — |
| R-12 | Atlas.co competition | Medium | Market | Phase 4/6 | — |
| R-13 | Phase 7 versioning / DiffEngine blocked | Low | Technical | Phase 7 | E-02 |
| R-14 | Observability gap on hosted instance | Medium | Operational | Phase 6 | GAP-6 |

---

## Technical Risks

### R-01: Coordinate sync drift
**Severity:** High
**Affected subsystems:** `apps/atlas-app` (CoordinateSync), `packages/basemap`, `packages/geo`
**Description:** MapLibre and Excalidraw maintain separate coordinate systems. The CoordinateSync
layer (`apps/atlas-app`) must translate every MapLibre camera-change event into Excalidraw
`scrollX`/`scrollY`/`zoom` updates without accumulated floating-point error. Any path that skips
re-projection (resize, orientation change, device pixel ratio change, zoom to bounds) will cause
geo-anchored elements to visually drift from their map positions. This is a structural risk that
persists across every phase; it does not go away after Phase 1 ships. (spec §0, spec §3)

**Current mitigation:** Phase 1 establishes a benchmark gate (`bench/results/phase-1-baseline.json`)
with a visual regression test: "rectangle drawn on MapLibre stays geo-anchored during pan/zoom."
(PHASES.md Phase 1 gate)

**Residual risk:** Benchmark tests capture pan/zoom under controlled conditions. Edge cases
(rapid zoom, multi-touch, fractional DPR) are not covered until Phase 1 E2E matrix is expanded.
[CONFIDENCE: medium]

---

### R-02: GeoAnchor type mismatch
**Severity:** High
**Affected subsystems:** `packages/excalidraw`, `packages/geo`, `packages/tools`, `apps/atlas-app`,
`apps/realtime`
**Description:** Three separate cross-phase mismatches document inconsistency in the `GeoAnchor`
type shape:
- MISMATCH-1: Phase 1 defines discriminated union `{kind, ..., zRef}`; Phase 3 consumes flat
  `{lng, lat, zoom, projection: 'EPSG:4326'}`
- MISMATCH-3: Phase 1 uses field `customData.geo`; Phase 3 consumes `customData.geoAnchor`
- MISMATCH-5: Phase 5 consumes flat `{lng, lat, zoom, bearing}`; `bearing` has no provenance
  in Phase 1 or Phase 2 type definitions

These mismatches are across producer phases (1) and consumer phases (3, 5). If the field name
and shape are not reconciled before Phase 3 ships, the file format will encode the wrong field
name and a migration will be required post-Phase-3. (cross-phase audit §12)

**Current mitigation:** Cross-phase audit documents all three mismatches. A resolution task
should appear in Phase 1 or Phase 3 plan amendments before Phase 3 ships. No phase plan
currently contains this resolution task — it is an audit finding, not a planned fix.
[CONFIDENCE: high that this risk is real; low on whether it is addressed before Phase 3]

**Residual risk:** If Phase 3 ships with the wrong field name, a file format migration is
required. File format changes after public release (Phase 4 Show HN) are costly.

---

### R-03: Excalidraw fork churn
**Severity:** High
**Affected subsystems:** `packages/excalidraw` and all dependents
**Description:** Monthly upstream merges from `excalidraw/excalidraw` will accumulate patch
conflicts over time. The `upstream-patches.md` file tracks all patches; as Atlasdraw
diverges more (geo tools, customData schema, rendering hints), merge conflicts will increase.
The hard-exit threshold (two consecutive quarters of broken patches OR `customData` field
removal) may trigger unexpectedly. (Q6, ADR 0004, spec §11)

**Current mitigation:** ADR 0004 defines the merge policy, hard-exit criteria, and quarterly
review cadence. CI workflow (`upstream-sync-check.yml`) alerts when `upstream-patches.md` is
stale. First quarterly review is scheduled for Q3 2026.

**Residual risk:** If `customData` is removed or renamed upstream (low probability but Excalidraw
has no formal stability guarantee for this field), the entire GeoAnchor binding breaks.
Mitigation in that event: freeze merges, evaluate thin-wrapper approach. Cost is high.

---

### R-04: Bundle size cliff
**Severity:** Medium
**Affected subsystems:** `apps/atlas-app`, `packages/sdk`
**Description:** The Atlasdraw editor bundles MapLibre GL JS, Excalidraw, and geo-processing
libraries. If async-splitting discipline is not maintained (Maputnik, Turf, shapefile parser
must remain async-loaded per spec §8), the initial parse + render time will exceed the 3-second
budget on mid-tier mobile. The SDK hard limit of 300 KB is a separate constraint.

**Current mitigation:** `size-limit` CI enforces 300 KB SDK limit (Phase 6). Spec §8 mandates
async loading for heavy modules. Bundle benchmark gate at Phase 1.

**Residual risk:** Feature additions in Phase 6–7 (Maputnik bridge, plugin host, PostGIS client)
must each be evaluated for bundle impact. `plugin-host` with `comlink` adds a Worker bootstrap
cost. [CONFIDENCE: medium]

---

### R-05: Performance regression under large datasets
**Severity:** Medium
**Affected subsystems:** `apps/atlas-app`, `packages/geo`, `packages/data`
**Description:** The 60fps-with-50k-features claim (spec §8) has not been verified against a
real workload. Phase 1 establishes the benchmark baseline, but data layers (Phase 2) and file
import (Phase 3) add rendering pressure. GeoTIFF COG rendering via `geotiff.js` is particularly
unknown in performance profile.

**Current mitigation:** Phase 1 benchmark gate. Phase 2 regression ≤ +20% rule. `requestIdleCallback`
for non-camera-driven re-projection; Worker for CPU-heavy projection paths (spec §8 mitigation
list).

**Residual risk:** GeoTIFF COG performance under large files is unspecified. Phase 7 PostGIS
source streaming performance is unspecified. [CONFIDENCE: medium]

---

## Security Risks

### R-06: Yjs E2EE boundary
**Severity:** High
**Affected subsystems:** `apps/realtime`, `apps/atlas-app`
**Escalation:** E-01 (unresolved)
**Description:** E-01 documents three options for the Yjs collaboration security model:
- Option A: No encryption — relay sees all content (lowest security)
- Option B: True zero-knowledge E2EE — key never reaches server (highest security, highest
  implementation cost; E-02 notes this blocks Phase 7 SnapshotStore/DiffEngine)
- Option C (recommended): Server-trusted relay with scene-crypto — server holds encrypted
  payloads but relay is not zero-knowledge; room key is scoped and not stored persistently

Phase 5 ships with `yjs-crypto.ts` as an API stub only — wiring is deferred to Phase 6 pending
E-01 resolution. ADR 0007 will capture the final decision. The stub without wiring means Phase 5
collaboration traffic is in plaintext at the relay layer.

**Current mitigation:** E-01 escalation is open. Phase 5 plan documents the stub and the
deferral explicitly. ADR 0007 is the resolution artifact.

**Residual risk:** If E-01 resolves as Option B (true E2EE), significant rework is required
in both `apps/realtime` and `apps/atlas-app`. If E-01 resolves as Option C (server-trusted),
the security property must be clearly communicated to self-hosters (a compromised relay reads
all content). Either resolution has downstream implications for E-02.

---

### R-07: Plugin Worker sandbox weakness
**Severity:** Medium
**Affected subsystems:** `packages/plugin-host` (Phase 7)
**Description:** Phase 7 research notes flag that Web Worker sandboxing is weaker than it
appears. Workers can make arbitrary `fetch` calls; `postMessage` serialization can be abused.
The Phase 7 plugin security model relies on the postMessage bridge to limit plugin API surface,
but a malicious plugin author could still exfiltrate data via `fetch`. (plan-7 research notes)

**Current mitigation:** `sandbox-escape.test.ts` adversarial tests for DOM access and arbitrary
fetch (plan-7 Feature 2 test plan). `PluginPermissions.ts` permission model with install-time
approval prompt.

**Residual risk:** The plugin sandbox is meaningful for accidental misuse but not for
adversarial plugins. This is explicitly deferred: "This is meaningful security work; defer it
to v1.5 deliberately" (spec §7 note). The residual risk is a known accepted tradeoff at Phase 7
scope. [CONFIDENCE: medium]

---

## Legal Risks

### R-08: License contagion (AGPL)
**Severity:** Medium
**Affected subsystems:** `apps/atlas-app`, `apps/realtime` (AGPL); boundary with MIT/MPL packages
**Description:** AGPL-3.0 requires that operators who run a modified version as a network service
must publish their modifications. This is intentional (Plausible-model, Q4). The risk is that
Persona D (developer) accidentally creates an AGPL-contaminated product by importing from
`packages/basemap` (MPL) or the app packages (AGPL) in a way they did not intend.

**Current mitigation:** Q5 deliberately puts the embed SDK (`packages/sdk`) and CLI
(`packages/cli`) under MIT so developer use cases (Persona D) are unencumbered. `LICENSING.md`
documents the license split with worked examples (plan-0 Task 1). CI fails if any package.json
is missing its `"license"` field.

**Residual risk:** The MPL-2.0 packages (`packages/basemap`, `packages/tools`) have file-level
copyleft. Modifications to those files must be published under MPL. A developer who patches
`BasemapRegistry.ts` for proprietary use may be surprised. `LICENSING.md` must document this.

---

### R-09: Attribution removal
**Severity:** Low
**Affected subsystems:** `packages/sdk`, `apps/atlas-app`
**Description:** AGPL §7 permits adding attribution requirements. Atlasdraw may add a "Powered
by Atlasdraw" requirement to the embed SDK. If a self-hoster removes attribution, they violate
the license terms.

**Current mitigation:** No phase plan explicitly adds an attribution requirement to the embed
SDK or app. This risk materializes only if such a requirement is added later.

**Residual risk:** Low — no current attribution requirement planned. [CONFIDENCE: low]

---

## Operational Risks

### R-10: OpenFreeMap / basemap uptime
**Severity:** Medium
**Affected subsystems:** `packages/basemap`
**Description:** Self-hosters without a bundled PMTiles file depend on OpenFreeMap's public
tile endpoint for basemap rendering. If OpenFreeMap's CDN goes down, the basemap goes blank.
Protomaps/PMTiles mitigates this for the bundled default (Q3), but the fallback path still
references OpenFreeMap. (GAP-5: spec §10 has not been updated post-Q3)

**Current mitigation:** Q3 mandates bundled PMTiles as the default (hybrid default). The bundled
file eliminates the uptime dependency for standard deployments.

**Residual risk:** Operators who use a remote OpenFreeMap URL instead of the bundled file have
no fallback. The documentation should recommend the bundled path for production deployments.

---

### R-11: Maintainer bandwidth exhaustion
**Severity:** Medium
**Affected subsystems:** All
**Description:** An 8-phase, 12+ month roadmap for what may initially be a small team. The
monthly upstream merge ritual (ADR 0004), the E-01 E2EE decision, the Phase 7 milestone bundle
(six concurrent features), and the hosted-flagship operations are all simultaneous obligations.
If maintainer capacity contracts, phases will slip and the upstream merge ritual will lapse.

**Current mitigation:** Hard-exit threshold in ADR 0004 allows graceful abandonment of upstream
tracking. Phase 7 features are explicitly a "milestone bundle, not a single release" — each has
an independent ship gate. (plan-7)

**Residual risk:** No mitigation for hosted-flagship operations cost. If the flagship does not
generate revenue (Stripe billing), maintenance incentive weakens. [CONFIDENCE: low]

---

### R-14: Observability gap on hosted instance
**Severity:** Medium
**Affected subsystems:** `apps/storage`, `apps/realtime`
**Description:** GAP-6 in the cross-phase audit notes that no phase plan adds structured error
logging, distributed tracing, or health endpoints beyond basic Docker healthchecks. The hosted
flagship will run with no error visibility. GAP-9 notes the telemetry endpoint
`telemetry.atlasdraw.org` is referenced in ADR 0006 but no phase plan includes a task to
deploy or test it.

**Current mitigation:** Phase 6 ADR 0006 defines the telemetry policy. pino logging is
mentioned in Phase 4 tech stack context. `/health` endpoint is implied by Docker healthchecks.

**Residual risk:** A hosted-flagship production incident (storage data loss, relay memory leak)
will be investigated without structured logs or traces. This is a known gap that should be
addressed before Phase 6 "Hosted Mode" ships to real users.

---

## Market Risks

### R-12: Atlas.co competition
**Severity:** Medium
**Affected subsystems:** All (strategic)
**Description:** Atlas.co is identified in the PRD as the closest feature-comparable competitor.
Atlasdraw's differentiation depends on OSS permanence, self-host first-class, and AGPL licensing.
If Atlas.co open-sources (or closes down), the positioning changes.

**Current mitigation:** Atlasdraw is designed as an OSS-first product. The self-host path
(Phase 4 Show HN) and the MIT-licensed embed SDK (Phase 6) create distribution moats that a
SaaS-only competitor cannot easily replicate.

**Residual risk:** If Atlas.co open-sources with a permissive license, Atlasdraw's AGPL
copyleft may be a disadvantage for developer adoption. [CONFIDENCE: low — market speculation]
