# Phase 6 Open-Questions Research Notes

**Date:** 2026-05-03
**Researcher:** open-questions resolver agent (claude-sonnet-4-6)
**Plan:** `docs/superpowers/plans/2026-05-03-atlasdraw-phase-6-v1-embeds-comments.md`
**Method:** Primary-source web fetch via context-mode sandbox (raw HTML never entered context)

---

## Locked Decisions (Phase 6 amendment, 2026-05-15)

### Q-P6-1 — Drop Felt importer and entire Embed-SDK / AtlasdrawAPI direction; v1.0 is the standalone app, not a platform

**Recorded:** 2026-05-15
**Constrains:** `docs/superpowers/plans/2026-05-15-atlasdraw-phase-6-amended-scope.md`

**Decision.** Phase 6 ships v1.0 of Atlasdraw the *application*, not Atlasdraw the *platform*. The following original-plan features are removed:

- **Felt importer** (original Tasks 3 and 15) — the project takes inspiration from Felt but does not target file-format compatibility. CSV/GeoJSON/KML/SHP readers in `@atlasdraw/data` (Phase 3) remain the import surface.
- **AtlasdrawAPI postMessage interface** (original Task 1, ADR-0005) — no programmatic third-party automation surface in v1.0.
- **Embed SDK** (`packages/sdk`, original Tasks 4a/4b/5) — no `<AtlasdrawEmbed>` widget, no `mount()`, no iframe bridge.
- **Workspace-scoped AtlasdrawAPI auth boundary** (original Task 19) — collapses with the API drop.
- **SDK CI gates** (original Tasks 22 bundle-size, 23 postMessage round-trip, 24 telemetry guard) — irrelevant without an SDK package.
- **AtlasdrawAPI surface freeze** (original Task 26) — v1.0 tags ship without an API contract; replaced by a simpler "v1.0 standalone app release" gate.

**Kept.** Anchored comments, Maputnik integration, layer styling UI + style compiler, geocoding, workspace abstraction (for self-host multi-document organization, not multi-tenant SaaS), print-to-PDF, asset library, hosted-mode quotas + Stripe (the maintainer-funded hosting story still stands), accessibility pass, hosted-mode E2E.

**Why.** The user (Atlasdraw owner) is not building a Felt competitor or a developer-platform product. The original plan's "Felt-class" framing inherited features that exist because Felt monetizes around them — file-import compatibility for migration, an SDK for embed partnerships. Atlasdraw's product story is the *standalone editor* with self-host. Removing the API direction removes 7 tasks, an entire `packages/sdk` workspace, two ADRs of contract surface, and the bundle-size / postMessage CI infrastructure — none of which serve the standalone-app product.

**Downstream impact — Phase 7.** The plugin sandbox plan (`docs/superpowers/plans/2026-05-03-atlasdraw-phase-7-v1.5-field-plugins.md`) consumes `AtlasdrawAPI` as the load-bearing Worker postMessage contract (Task 2, Q11 assumption). Dropping AtlasdrawAPI invalidates that assumption and requires Phase 7 to be rearchitected — most likely as direct npm-loaded extensions rather than a Worker-sandboxed plugin host, or deferred indefinitely. Phase 7 plan is **flagged for revision** but not amended in this scope; see seeds issue (to be filed) for follow-up.

---

## OQ1 — Felt format: ZIP archive or JSON blob?

**Finding:** There is no public `.felt` binary format. Felt exposes map data exclusively through its REST API, which requires a bearer token (OAuth / API key).

**API endpoints (verified 2026-05-03):**
- `GET /api/v2/maps/{map_id}/layers/{layer_id}/get_export_link` → returns `{export_link: string}` pointing to a GeoPackage (vector) or GeoTIFF (raster) download.
- `POST /api/v2/maps/{map_id}/layers/{layer_id}/custom_export` with body `{output_format: "geojson"|"csv"|"gpkg"|"geotiff"|"pmtiles"}` → async; poll `poll_endpoint` until `status: "completed"`; download URL is a `.zip` file (`Felt-Export.zip`) containing the GeoJSON.

**Auth requirement:** Bearer token required for all export endpoints. No unauthenticated export path exists in the public API.

**What this changes in the plan:**
- Task 3 downgraded from "reverse-engineer proprietary format" to "verify API flow and capture GeoJSON schema as fixtures."
- Fixture files renamed `.felt.json` (GeoJSON snapshots) instead of `.felt` (binary unknown).
- Task 15 importer input type updated: `GeoJSON FeatureCollection | Felt-Export.zip` instead of opaque binary.
- If a Felt API key is unavailable at Task 3 execution time, synthetic fixtures constructed from the documented Felt Style Language schema are an acceptable fallback.

**Source:** https://developers.felt.com/rest-api/api-reference/layers/layer-exports

---

## OQ2 — LngLat structured-clone behavior

**Finding:** Confirmed — `LngLat` is a TypeScript class (`export class LngLat`) with instance methods: `toArray()`, `distanceTo()`, `wrap()`, `toBounds()`, `toString()`. `structuredClone` copies only own enumerable data properties; class prototype methods are stripped and the clone loses its `LngLat` prototype identity. `structuredClone(new LngLat(0,0))` produces a plain object `{lng: 0, lat: 0}` — it does not throw, but the clone is not a `LngLat` instance and any method call on it will fail.

**Practical impact:** Any `AtlasdrawAPI` method that returns a `LngLat` instance would silently produce a broken value after a postMessage round-trip. The `[number, number]` tuple approach already adopted in the plan is correct and required. The Wave 0 verification step in the plan (`structuredClone(new maplibregl.LngLat(0, 0))`) should be updated to assert the clone lacks `toArray` rather than assert it throws.

**What this changes in the plan:**
- No task changes needed. The tuple approach is already in place.
- Minor clarification: the Wave 0 verify step should check `typeof clone.toArray === "undefined"` not `throws` — structuredClone of a class instance with only data properties does not throw.

**Source:** https://github.com/maplibre/maplibre-gl-js/blob/main/src/geo/lng_lat.ts

---

## OQ3 — Stripe subscription model: per-seat or per-workspace?

**Finding:** Decision pre-made in the plan body ("per-workspace seats: $9/mo up to 5 members; $19/mo for 6–25"). Stripe Checkout (hosted page) is the v1.0 approach; no embedded payment element required. Per Q4 constraint, all billing features ship in Phase 6 and are available in OSS docker-compose.

**What this changes in the plan:** Nothing. No research needed.

---

## OQ4 — Maputnik origin allowlist in self-host

**Finding:** Resolution already fully specified in the question body: `config.toml [style_editor] maputnik_url` key + `MAPUTNIK_URL` env var, defaulting to `https://maputnik.github.io`. Whether the public `maputnik.github.io` instance accepts `postMessage` from arbitrary origins is a **Key Assumption** (plan §Key Assumptions item 4), not an open question — it is verified before Task 8 begins.

**What this changes in the plan:** Nothing. The config.toml pattern is the implementation target.

---

## OQ5 — Comments ACL: can a view-only user post comments?

**Finding:** Design decision pre-made in the plan body: yes, viewer-role tokens receive `COMMENT_WRITE` permission via separate auth on the comments Y.Doc. Verification is a Task 6 acceptance criterion gate, not a pre-phase research item.

**What this changes in the plan:** Nothing.

---

## OQ6 — PDF tile attribution requirement

**Finding:** Attribution is mandatory under ODbL and is not skippable.

**OSM ODbL requirements for PDFs and printed maps** (OSMF Attribution Guidelines, adopted 2021-06-25):
- Credit must appear beside the map, in a footnote/endnote, or in the acknowledgements section.
- **The URL `https://www.openstreetmap.org/copyright` must be printed out** (not just rendered as a link, since PDF links may not be followed).
- Required attribution text: `"© OpenStreetMap contributors"` (historical form acceptable).
- Attribution must be legible and placed where "customarily attribution would be expected."

**For OpenFreeMap tiles** (additional layer):
- OpenFreeMap's own homepage displays: `© OpenMapTiles | Data from OpenStreetMap`
- Both strings are required when using OpenFreeMap as the tile source.

**Combined required string for `print-pdf.ts` title block:**
```
© OpenStreetMap contributors (openstreetmap.org/copyright) | © OpenMapTiles
```
(When using OpenFreeMap/Protomaps basemap derived from OpenMapTiles + OSM.)

**What this changes in the plan:**
- Task 13's `print-pdf.ts` title block must embed the above attribution string as non-removable text. This is a legal obligation, not optional.
- The OQ6 plan text already says "must include the tile attribution string" — this note provides the exact string.

**Sources:**
- https://osmfoundation.org/wiki/Licence/Attribution_Guidelines §"Books, magazines, and printed maps"
- https://openfreemap.org (homepage attribution display)

---

## OQ7 — Asset library content licensing audit

**Finding: Both proposed sources (OpenMoji, game-icons.net) FAIL the MIT provenance requirement.**

| Source | Actual license | MIT compatible? | Problem |
|---|---|---|---|
| OpenMoji | CC BY-SA 4.0 | NO | ShareAlike clause: derivatives must use same license — incompatible with MIT package bundling |
| game-icons.net | CC BY 3.0 | NO | Requires per-author credit in every distribution; not MIT |

**Sources:**
- https://openmoji.org — homepage states: "All emojis are free to use under the CC BY-SA 4.0 license"
- https://game-icons.net/about.html — states: "provided under the terms of the Creative Commons 3.0 BY license"

**Approved MIT/CC0 alternatives for Task 14b:**
| Source | License | Notes |
|---|---|---|
| [Phosphor Icons](https://github.com/phosphor-icons/core) | MIT | Large set, well-maintained, SVG |
| [Heroicons](https://github.com/tailwindlabs/heroicons) | MIT | Tailwind Labs, SVG, outline + solid |
| [Lucide](https://github.com/lucide-icons/lucide) | ISC | MIT-compatible fork of Feather Icons |
| Hand-drawn in-house SVG | MIT by authorship | Best provenance story |
| CC0/public domain SVG | CC0 | Any CC0-licensed collection |

**What this changes in the plan:**
- Task 14b Step 1 updated: OpenMoji and game-icons.net removed as source candidates; approved list above substituted.
- The commit message in Task 14b Step 4 already says "(MIT)" — this is now accurate only if sources from the approved list above are used.
- `LICENSE.txt` requirement stands: must cite exact source, SPDX identifier, and upstream license URL.

---

## OQ8 — `size-limit` baseline: what's the current `packages/sdk` size?

**Finding:** Cannot be answered before the bundle exists. This is deferred by design to Task 4 Step 4 — first build → measure → decision. No pre-phase research is possible or useful.

**What this changes in the plan:** Nothing.

---

## Summary

| OQ | Status | Tasks changed |
|---|---|---|
| OQ1 — Felt format | RESOLVED — API only, bearer token required; no binary format | Task 3 (downgraded spike→verify), Task 15 (input type updated) |
| OQ2 — LngLat structured-clone | RESOLVED — class with methods; clone silently loses prototype | No task change (tuple approach already correct) |
| OQ3 — Stripe model | RESOLVED — pre-decided in plan | None |
| OQ4 — Maputnik origin | RESOLVED — config.toml pattern already specified | None |
| OQ5 — Comments ACL | RESOLVED — pre-decided in plan | None |
| OQ6 — PDF attribution | RESOLVED — mandatory ODbL; exact string documented | Task 13 (exact attribution string now specified) |
| OQ7 — Asset library MIT | RESOLVED — OpenMoji CC BY-SA 4.0 / game-icons CC BY 3.0 FAIL MIT; approved list provided | Task 14b Step 1 (source list corrected) |
| OQ8 — size-limit baseline | RESOLVED — deferred to Task 4 Step 4 by design | None |

**Blockers cleared:** OQ7 was a latent legal risk — shipping icons from CC BY-SA sources in an MIT package would have been a license violation. Corrected before implementation.

**Task 3 gate effect:** Downgraded from "discover unknown format" to "verify known API schema" — this is a meaningful scope reduction. Task 3 is no longer a discovery risk; it is documentation work.
