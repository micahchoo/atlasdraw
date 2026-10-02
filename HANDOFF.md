# Handoff: roadmap/2026-10 (2026-10-01)

## Where the branches are

- `roadmap/2026-10` (worktree `../atlasdraw-roadmap`) is at `10b60c6` and
  is pushed to origin. It holds round 1 (waves W0 to W9) and round 2 (R0,
  R2 to R8c).
- `origin/main` is at `8600183`: round 1 and two CI fixes. Round 2 is not on
  `main`. A push to `main` deploys GitHub Pages.
- R9, the truth pass over docs, rules, ADRs and comments, is on `r9/truth`
  (worktree `../atlasdraw-r9`). It is not merged and not pushed.
- No commit names R1 (known-red tests). Check with the lead whether it ran.

## Round 2, as merged

R0 relay, storage and app hardening (`LIMITS` in `packages/protocol`); R2
one gate for documents from outside the tab, and the content security
policy; R3 one creation seam (`stampNewElements`); R4 one history, and
"unsaved" derived from it; R5 one `MapView` for exports, and the responsive
embed with a legend; R6 key scopes and one `Modal`; R7 the production-build
e2e, ESLint 9, `maplibre-gl` 6.11, `vite` 7.3.6, the boot-size budget; R8a
KML and GPX export, WKT in CSV, clusters, heatmap, the attribute table; R8b
server versions (ADR-0020), `If-Match`, frozen links, backup and restore of
maps with their write keys; R8c offline basemap labels, the blocked-tile
message, pin details.

## Left

1. Merge `r9/truth` into `roadmap/2026-10`.
2. Run the chromium e2e and the production-build e2e
   (`playwright.build.config.ts`, hosted and `E2E_TARGET=pages`) on the
   merged branch.
3. Push `roadmap/2026-10` to `main`.
4. The defects that R9 found and did not fix are in its report.
