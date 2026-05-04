# Atlasdraw — Open Questions Resolution

**Companion to:** PRD v0.1 §14 (Open Questions) + Tech Spec v0.1
**Status:** Draft v0.1 — proposed answers for founding contributors
**Audience:** Day-1 maintainers
**Purpose:** Lock the contested decisions before phase plans begin so each phase plan can treat them as constraints, not open variables.

This document closes the live debates so that downstream plans don't re-derive them. Each item lists: the question, the recommendation, the load-bearing reason, and the constraint it imposes on phase planning.

---

## Q1 — WebSocket: hard dependency or optional?

**Question (PRD §14):** Does the WebSocket server become a hard dependency, or is "single-player + file save" a first-class deployment mode?

**Recommendation:** **Single-player + file-save is a first-class deployment mode.** WebSocket is opt-in via `[realtime] enabled = true` in `config.toml`.

**Reason:** The laptop-airplane-mode story is differentiating (Personas A/C/D explicitly value it) and the docs hand-off promises "as portable as a Markdown file." A required relay breaks both. Operationally, a single-binary mode also makes the demo trivial — `docker run atlasdraw/atlas-app` should produce a working editor with no postgres, no minio, no realtime.

**Constraint on plans:**
- **Phase 4** ships single-player Docker only. The realtime container is added in Phase 5.
- `apps/atlas-app` MUST function with no `VITE_WS_URL` set; the collab UI degrades gracefully.
- File persistence (IndexedDB + File System Access in Phase 3) is the canonical store; relay-backed storage is the v1.0 enhancement, not the substrate.

---

## Q2 — Yjs vs Automerge for data-layer CRDT?

**Question (PRD §14):** Spike both in week one — which wins?

**Recommendation:** **Yjs for v1.** Spec §5.2 already calls this; we're confirming.

**Reason:** Yjs is faster on the workloads we expect (frequent small mutations on 100–10k feature collections), has a deeper plugin ecosystem (`y-websocket`, `y-indexeddb` for offline-first sync, `y-protocols` for awareness), and is what most production collaborative editors converge on (TipTap, BlockNote, Hocuspocus). Automerge has cleaner semantics and better history APIs but its bundle size (~200KB) and per-op cost don't earn their keep at our scale.

**Constraint on plans:**
- **Phase 5** wires `y-websocket` in `apps/realtime` alongside Socket.IO (separate connection, not multiplexed — see Q9).
- `packages/data` exposes `YjsLayer` as the canonical mutable layer type. GeoJSON FeatureCollection becomes a *snapshot* projection of the Yjs doc, not the source of truth.
- We do NOT design AtlasdrawAPI with Automerge-compatible semantics; commit to Yjs's ops model.

---

## Q3 — Default basemap: OpenFreeMap or Protomaps PMTiles?

**Question (PRD §14):** Faster-to-ship vs. zero-network-dependency?

**Recommendation:** **Hybrid default** — OpenFreeMap for the public-facing demo at `app.atlasdraw.org`; bundled minimal Protomaps PMTiles (one region, ~50–500 MB) for the default `docker-compose.yml` first run. A `make basemap-world` script downloads the full ~120 GB world PMTiles for users who want it.

**Reason:** PRD principle §5 explicitly states "no telemetry that calls home, no required basemap key." A docker-compose default that depends on `tiles.openfreemap.org` violates the principle. But shipping a 120 GB tile bundle violates the "single Docker command" principle. The hybrid resolves both: the public demo sits on shared infra (the trade-off is documented), and the self-hoster's first run uses local tiles by default.

**Constraint on plans:**
- **Phase 4** docker-compose ships with a minimal pre-built PMTiles file (`/data/world-low-zoom.pmtiles`, zoom 0–6, ~200 MB) so first-run shows a world map without network.
- `BasemapRegistry` in `packages/basemap` defaults to `local-pmtiles` when `realtime.enabled = false` and self-host config is detected; defaults to `openfreemap-bright` only when `[basemap.allow_remote] = true` is explicit.
- The PRD/spec text describing OpenFreeMap as "default basemap from OpenFreeMap public tiles" (spec §10) MUST be updated to reflect this hybrid.

---

## Q4 — Hosted flagship: do we run one?

**Question (PRD §14):** Yes/no, and when?

**Recommendation:** **Yes, by v1.0.** Run under a separate brand (`atlasdraw.app` or `studio.atlasdraw.org`) so the OSS project at `atlasdraw.org` stays pristine. Funded by usage tiers: free for personal/edu, $9–19/mo for pro hosted, custom for orgs. All hosted features ship in the OSS code under AGPL — no open-core split (Plausible-model, not n8n-model).

**Reason:** Three reasons converge: (1) it funds maintainer time, (2) it acts as the canonical "show me" demo for Show HN comments, (3) it provides the empirical performance baseline that justifies our budgets. Without a hosted instance running real workloads we'll never know if our 60fps-with-50k-features claim survives contact with users.

**Constraint on plans:**
- **Phase 6 (v1.0)** explicitly includes a "Hosted multi-tenant mode" task: workspace abstraction, billing hooks (Stripe), per-workspace quotas. Off-by-default in self-host configs.
- Telemetry/metrics for the hosted flagship MUST be opt-out toggleable for self-hosters AND wholly omitted from the embed SDK — the principle violation cost would be severe.
- We do NOT build any feature exclusive to the hosted instance. If we ship workspace billing, the OSS docker-compose can also enable workspace billing.

---

## Q5 — AGPL vs MPL-2.0 for the application?

**Question (PRD §14):** Stronger SaaS-reseller moat (AGPL) vs. friendlier contribution (MPL)?

**Recommendation:** **AGPL-3.0 for `apps/*` (atlas-app, realtime, storage). MIT for `packages/sdk`, `packages/cli`, `packages/geo`, `packages/data`. MPL-2.0 for `packages/basemap` and `packages/tools` (file-level copyleft, library-friendly).**

**Reason:** The libraries that need ecosystem velocity (embed SDK, file format CLI, pure-function math) carry no copyleft so any closed-source tool can read/write `.atlasdraw` files or embed the widget. The running application carries AGPL so a hyperscaler cannot fork our editor, host it as a SaaS, and contribute nothing back. Per-file MPL on the wrapper packages (`basemap`, `tools`) protects our core changes while permitting closed-source extensions.

**Constraint on plans:**
- **Phase 0** writes three license files: `LICENSE-AGPL`, `LICENSE-MIT`, `LICENSE-MPL`, plus `LICENSING.md` explaining the split with a worked example ("Embedding the iframe: fine. Modifying server, exposing as SaaS: open-source your changes.").
- Each `package.json` declares its own `"license"` field. CI fails if a package is missing it.
- Plugin manifest schema (Phase 7) MUST require an SPDX license identifier from contributors.

---

## Q6 — Excalidraw upstream divergence: how do we manage the merge tax?

**Question (Spec §11 risk; not in PRD §14 but operationally critical):** When does the monthly merge ritual become uneconomical, and what's the exit?

**Recommendation:** **Quarterly review with a hard exit threshold.** Continue monthly merges from `upstream/master` while: (a) merge time ≤ 2 hours, (b) no patch in `decisions/upstream-patches.md` is being broken more than once per quarter, (c) Excalidraw's `customData` field on `ExcalidrawElement` is not removed/renamed.

**If any of those break for two consecutive quarters,** abandon merges and treat upstream as a one-time vendor — pin the last-merged version and accept the divergence. At that point we re-evaluate going back to `@excalidraw/excalidraw` as a thin dependency wrapper plus our own renderer.

**Reason:** The spec's mitigation ("minimize patches") is hopeful, not structural. Excalidraw is actively developed and `packages/element`/rendering code churns. Without a stated exit, the team will spend years half-merging.

**Constraint on plans:**
- **Phase 0** creates `decisions/upstream-patches.md` with empty initial state and a CI check that fails if a PR modifies a vendored Excalidraw file without adding an entry.
- **Phase 0** adds `decisions/0004-upstream-merge-policy.md` documenting the threshold above.
- Every phase plan that touches `packages/excalidraw` must call out the patch in the task and update `upstream-patches.md`.

---

## Q7 — Phase 1 timeline: 3 weeks or 4?

**Question (My review of Spec §2.1):** Spec budgets weeks 2–4 for Geo Foundation. The hardest sub-problem (event routing across stacked canvases) gets one paragraph.

**Recommendation:** **Extend Phase 1 to weeks 2–5 (4 weeks).** Carve event routing out as its own week.

**Reason:** Excalidraw's pointer system is one of its most-rewritten subsystems. Inserting a foreign canvas underneath it with `pointerEvents` toggling, hit-testing, touch + pen + mouse + wheel coordination, and getting consistent behavior across Chrome/Firefox/Safari/Mobile Safari is not a one-week task. Better to plan for the reality than ship a buggy Phase 1 demo.

**Constraint on plans:**
- **Phase 1 plan** explicitly carves week 5 as "event-routing hardening" with an E2E test gate per browser.
- **Phase 1** acceptance criteria include a manual test matrix: pan + zoom + draw on Chrome/Firefox/Safari + iOS Safari + Android Chrome.
- The "first two weeks in commits" table in spec §12 is honest about the demo target (week 2 = pin tool dropping pins) but the *hardening* of that demo is week 5, not week 4.

---

## Q8 — Performance budget: assertions or measurements?

**Question (My review of Spec §8):** "60fps with 5k annotations + 50k features" and "<8ms `syncMapToScene` on 5k elements" — where do those numbers come from?

**Recommendation:** **Treat current numbers as preliminary targets. Make a Phase 1 benchmark milestone the gate before Phase 2 begins.**

**Reason:** `syncMapToScene` is an O(n) hot path running at up to 60Hz. Without a measured baseline from a Phase 1 spike, the budgets are wishes. If actual performance is 4x worse than budget, Phase 2 architecture (which assumes the budget) is wrong.

**Constraint on plans:**
- **Phase 1 plan** includes a "Coord-sync benchmark spike" task: synthetic scene of 5k elements, measure frame time during pan/zoom, record p50/p95/p99 in `bench/results/phase-1-baseline.json`.
- If baseline misses budget by >2x: add a "switch to incremental projection" task in Phase 1 before declaring it done.
- **Phase 2** acceptance gate re-runs the benchmark with real data layers added; regression budget is +20%.

---

## Q9 — Two protocols on one socket: head-of-line blocking?

**Question (My review of Spec §5.1):** Yjs initial state catch-up (potentially MB) on the same channel as 60Hz cursor updates will block.

**Recommendation:** **Split data-layer onto its own `y-websocket` connection.** Keep Socket.IO for `SCENE_UPDATE`, `MAP_CAMERA_UPDATE`, `CURSOR`, `COMMENT`. Open a second WebSocket on `/yjs/<roomId>` for Yjs sync.

**Reason:** Yjs sync messages can be tens of KB to MB during initial catch-up or large undo. Mixing those into the same Socket.IO connection that's delivering 60Hz cursor events creates head-of-line blocking — the cursor freezes until Yjs catches up. Two TCP connections is a small price for protocol separation.

**Constraint on plans:**
- **Phase 5 plan** wires two endpoints in `apps/realtime`: `/socket.io` (existing) and `/yjs/:roomId` (new, using `y-websocket` server).
- `packages/data/yjs-layer.ts` connects independently of the Socket.IO client.
- E2E test: open a room with a 5MB Yjs initial state; assert cursor frame rate stays >30fps during catch-up.

---

## Q10 — Docker compose service count: 3 or 5?

**Question (My review of PRD §9 vs Spec §10):** PRD says three services; spec ships five.

**Recommendation:** **Five services, but a `docker-compose.minimal.yml` ships three.** The five-service stack is the recommended deployment; the three-service variant (web + storage + sqlite-in-a-volume, no postgres no minio) is the "I want to try it" path.

**Reason:** Five containers is honest for a production-shaped self-host (web + realtime + storage + postgres + minio). Three is what a curious user wants to skim before clicking. The PRD prose currently overpromises by saying "three services."

**Constraint on plans:**
- **Phase 4 plan** ships both `docker-compose.yml` (5 services, recommended) and `docker-compose.minimal.yml` (3 services: web + storage + a single sqlite volume mount; no realtime, no minio, blob-as-filesystem).
- README first-run instructions point to `minimal.yml`. "Production self-host" docs point to the full file.
- PRD §9 wording is updated in `docs/PRD-v0.2.md` (out of scope for this phase plan but flagged here so the spec/PRD don't drift).

---

## Q11 — Plugin sandbox: design AtlasdrawAPI for postMessage today?

**Question (My review of Spec §7.2):** v1.5 promises Web Worker plugin sandboxing, but the AtlasdrawAPI surface is being designed in v1.

**Recommendation:** **Yes — design AtlasdrawAPI as worker-postMessage-friendly from day one.** No methods that return non-cloneable values, no methods that require shared memory, all callbacks async.

**Reason:** Retrofitting a synchronous API to be postMessage-safe in v1.5 means breaking every plugin author's contract. Cheaper to constrain v1 today than to publish a stable contract that contradicts the v1.5 sandbox.

**Constraint on plans:**
- **Phase 6 plan** (v1.0 SDK) writes AtlasdrawAPI with these rules in the type definitions: all methods are `async` or fire-and-forget, all return values are JSON-serializable (no DOM nodes, no class instances, no functions).
- **Phase 6 plan** includes a structural test: every public method on `AtlasdrawAPI` passes a structured-clone round-trip on its arguments and return value.
- ADR `0005-sdk-postmessage-contract.md` written in Phase 6.

---

## Q12 — Geo schema: add `projection` field today?

**Question (My review of Spec §3.1):** When MapLibre globe mode (v1.5+) lands, projection becomes non-Mercator and existing `customData.geo` anchoring breaks for tilted/curved views.

**Recommendation:** **Add `projection: "mercator"` field to `GeoCustomData` in the v1 schema. Default and only valid value in v1; reserved for future expansion.**

**Reason:** Schema changes after v1 require migrations. A reserved field is free now and saves a migration later.

**Constraint on plans:**
- **Phase 1 plan** includes the `projection` field in `GeoCustomData`. The CoordinateSync class asserts `geo.projection === "mercator"` and throws otherwise (forward-compat sentinel).
- Schema version bumped to `schemaVersion: 1` from day one (already there in spec).

---

## Q13 — Felt importer scope: does it ship in v1.0?

**Question (My review of PRD §12 vs §7.2):** Risk mitigation references a "Felt importer in v1.0" but the v1.0 scope list doesn't include it.

**Recommendation:** **Yes, ship a Felt importer in v1.0 — but scope it narrowly.** Read-only import of Felt's `.felt` export format (or its public API export) into `.atlasdraw`, mapping their layer model to ours. No round-trip; no sync.

**Reason:** "We can read your Felt files" is the single biggest unlock for the migration narrative on Show HN. Without it, the file-portability claim is theoretical.

**Constraint on plans:**
- **Phase 6 plan** adds an explicit "Felt importer" task in `packages/data/felt.ts`.
- The importer is permissive: log warnings on unknown feature types, never throw.
- A test fixture: 3 sample `.felt` files (donated by friendly Felt users or scraped from public Felt embeds) with expected `.atlasdraw` outputs.

---

## Cross-cutting: Telemetry policy

A consequence of Q3 + Q4 + Q10: we MUST publish a telemetry policy doc (ADR `0006-telemetry.md`) in Phase 0 stating:

1. The OSS app sends zero telemetry by default.
2. The hosted flagship sends usage analytics on opted-in events only.
3. The optional anonymous heartbeat (PRD §10 success metrics) is opt-in at install time, sends only `{instance_id, version, count_of_maps_created_this_week}`, configurable endpoint.
4. The embed SDK NEVER reports anything.

This is a constraint, not a phase task — every plan must respect it.

---

## Summary table — what each plan must treat as decided

| # | Decision | Affects phases |
|---|---|---|
| Q1 | Single-player is first-class; realtime opt-in | 4, 5 |
| Q2 | Yjs (not Automerge) | 5 |
| Q3 | Hybrid basemap default (PMTiles bundled, OpenFreeMap demo only) | 4 |
| Q4 | Hosted flagship by v1.0, no open-core split | 6 |
| Q5 | AGPL apps, MIT SDK/CLI/geo/data, MPL basemap/tools | 0, 6 |
| Q6 | Quarterly upstream review, hard exit threshold | 0, all |
| Q7 | Phase 1 = 4 weeks (2–5), event-routing has its own week | 1 |
| Q8 | Phase 1 ends with a measured benchmark gate | 1, 2 |
| Q9 | Yjs on a separate WebSocket from Socket.IO | 5 |
| Q10 | Ship `docker-compose.minimal.yml` (3 svc) and `docker-compose.yml` (5 svc) | 4 |
| Q11 | AtlasdrawAPI is postMessage-safe from v1 | 6 |
| Q12 | `projection: "mercator"` field in geo schema today | 1 |
| Q13 | Felt importer in v1.0 (read-only) | 6 |

Every phase plan that follows references this document by ID (Q1–Q13) when applying a constraint. If a plan needs to deviate, it surfaces the deviation as a new ADR — it doesn't silently drift.
