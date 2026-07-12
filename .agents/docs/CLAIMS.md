# CLAIMS.md — claim-vs-reality ledger (ISSUES.md Issue 2) — CLOSED 2026-07-04

Loop: claim-vs-reality diff over the five package READMEs + `docs/PHASES.md`,
checked against source, `docs/decisions/escalations.md`, and `CHANGELOG.md`.
The diff also surfaced three false claims in CHANGELOG.md itself (rows 14–16),
and the recheck sweep surfaced two more package-README rows outside the
original scope (18–19). All fixes on branch `docs/claims-vs-reality`.

Types: **CNI** = claimed-not-implemented · **IND** = implemented-not-documented
· **ID** = implemented-differently.

| # | Claim | Where claimed | What the code does | Type | Resolution | Commit | Recheck |
|---|-------|--------------|--------------------|------|------------|--------|---------|
| 1 | "Phase 0 stub. Real implementation lands in Phase 2" | `code/packages/data/README.md:7` | 2,389 non-test LOC shipped: geojson/csv/shapefile/atlasdraw I/O, geocoder, yjs layer, asset library | ID | README rewritten to shipped state | 2748336 | pass |
| 2 | I/O formats "geojson/kml/gpx/csv/shapefile/atlasdraw" | `code/packages/data/README.md:3` | No KML/GPX source exists anywhere in the package | CNI | KML/GPX dropped; marked "not implemented" explicitly | 2748336 | pass |
| 3 | (nothing) — geocoder, thumbnail, asset library, yjs-snapshot, collab-undo-manager, manifest schema undocumented | `code/packages/data/README.md` | All shipped and exported from `src/index.ts` | IND | Documented in rewrite (incl. yjs-crypto's no-caller stub status, per managed-mode rule 1) | 2748336 | pass |
| 4 | Links `../../docs/architecture/subsystems/<pkg>/` | all five `code/packages/*/README.md:7` | Resolved to nonexistent `code/docs/architecture/`; real docs at repo-root `docs/architecture/subsystems/` (all five subdirs exist) | CNI | Repointed to `../../../docs/...` in each rewrite | 2748336, 5fb888b, 4b92d5c, 0812f20, 0c07a69 | pass (targets verified on disk) |
| 5 | "Phase 0 stub. Real implementation lands in Phase 1" | `code/packages/geo/README.md:7` | 822 non-test LOC shipped | ID | README rewritten | 5fb888b | pass |
| 6 | "Turf wrappers" | `code/packages/geo/README.md:3` | Zero `@turf`/turf references in source or package.json | CNI | Claim dropped | 5fb888b | pass |
| 7 | "Phase 0 stub. Real implementation lands in Phase 1" | `code/packages/basemap/README.md:7` | 904 non-test LOC shipped; feature line was accurate | ID | README rewritten (feature line kept) | 4b92d5c | pass |
| 8 | Tools "registered as Excalidraw customType tools" | `code/packages/tools/README.md:3` | v0.18 has no `customTools` API; tools dispatch via atlas-app overlay (`useAtlasdrawTool.ts`) | ID | Real mechanism documented with a callout; cross-linked `.claude/rules/excalidraw-api.md` | 0812f20 | pass |
| 9 | "Phase 0 stub. Real implementation lands in Phase 1" | `code/packages/tools/README.md:7` | 8 tools + classifyTool + convert shipped, 1,495 non-test LOC | ID | README rewritten | 0812f20 | pass |
| 10 | Headless tooling: "lint, convert, render" | `code/packages/cli/README.md:3` + `package.json` description | Only `lint` + `convert` registered (`atlasdraw.ts:23-24`); `render` (T12) never implemented; no build step exists (bin → TS source) | CNI | render dropped from README **and** package.json description; honest tsx invocation documented | 0c07a69 | pass |
| 11 | "Phase 0 stub. Real implementation lands in Phase 3" | `code/packages/cli/README.md:7` | 455 non-test LOC shipped | ID | README rewritten | 0c07a69 | pass |
| 12 | E-01/E-02/E-03 "Open — awaiting maintainer decision" | `docs/PHASES.md` | escalations.md: E-01+E-02 RESOLVED 2026-05-11 (Option C), E-03 RESOLVED 2026-05-25 (Option A) | ID | Escalations table corrected; historical banner added | d7b11f2 | pass |
| 13 | Phase 6 ships embeds/Felt importer/SDK freeze; Phases 5–7 future | `docs/PHASES.md` | v1.0 shipped 2026-05-15; Q-P6-1 cut SDK/embeds/Felt from v1.0 | ID | Banner: v1.0 shipped, Q-P6-1 scope cut, Phase 7 not started; narratives kept for provenance | d7b11f2 | pass |
| 14 | Phase 3 shipped "CSV, GeoJSON, KML, Shapefile" readers | `CHANGELOG.md:69` | No KML reader exists | CNI | Line corrected (KML/GPX noted unimplemented) | b819cea | pass |
| 15 | Quotas "free=3, pro/pro+=unlimited" | `CHANGELOG.md:40` | `QUOTA_PRO_MAPS` positive int, default 100 — unlimited not representable | ID | Corrected to default 100 + env vars named. Tier differentiation itself = Direction 5 (maintainer decision, untouched) | b819cea | pass |
| 16 | "Packages (`packages/*`) — MIT" | `CHANGELOG.md:112` | basemap + tools package.json: MPL-2.0 | ID | License section corrected, LICENSING.md linked | b819cea | pass |
| 17 | "Future format adapters (KML/GPX/CSV) will follow" | `code/packages/data/src/index.ts:5-7` | CSV shipped in Phase 3 | ID | Comment updated (KML/GPX only) | e7d88f0 | pass |
| 18 | "Real implementation lands in Phase 6" | `code/packages/sdk/README.md:7` (found by recheck sweep) | sdk **was cut from v1.0 per Q-P6-1**; package is a genuine placeholder stub | ID | Status now records the cut, not a phase that shipped without it | 056b228 | pass |
| 19 | (no README at all) | `code/packages/protocol/` (found by recheck sweep) | Ships CollabEvent union, RoomKey fragment parser, comment schema — consumed by atlas-app + realtime | IND | README added | 24c8995 | pass |

## Done-when — met

Final re-diff (2026-07-04): grep for the fixed claims across
`code/packages/*/README.md`, `docs/PHASES.md`, `CHANGELOG.md`,
`code/packages/data/src/index.ts` returns only intentional
"not implemented" notes; every README link target verified to exist on disk;
every usage snippet's symbols verified against actual exports
(`parseCSV`/`parseShapefile`/`read`/`write`, `projectPoint(map, lng, lat)`,
lint/convert commands). The github-readme audit script could not run (no
ruby on this machine); its checks (H1, usage section, license section,
fenced setup commands, short intro) were applied manually to all rewrites.
