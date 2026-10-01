# Handoff: roadmap/2026-10 (2026-10-01)

Branch `roadmap/2026-10` (worktree ../atlasdraw-roadmap) is pushed to origin.
`main` is NOT updated. Pushing to main deploys Pages, and the permission
classifier blocked it once; the user asked for a push to main after all waves
and again after the repeat audit.

## Done and merged (each gated: typecheck, vitest, lint, prettier, falsifiable)
W0 stop data loss + share-link write hole; W1 known-red tests; W2 CI gates,
Dockerfiles, same-origin minimal stack, Postgres CI; W3 Document owner;
W4 world coordinates (+W4b units, pinch, Ctrl+0); W5 single map-style writer;
W6 collab on one Y.Doc per room (+W6b input validation, relay limits, names);
W8 managed mode, SDK, fork extras deleted, write keys + lasting links;
W9 KML/GPX, hi-DPI export, My maps, popups, tile layers, labels/filters,
data-layer export, measure tool.

## In flight
- W7a (worktree ../atlasdraw-w7a, branch w7a/shell): one viewer (/m shows a
  map), routes.ts, config schema, backlog UI fixes. Agent may still be running;
  merge w7a/shell when its gate is green.

## Left
1. W7b: EditorSession + command registry (menu, palette, keys, shortcuts list).
2. W8 docs/comment pass: delete history-narration comments, fix false ones,
   docs/ADRs naming removed modules (avoid .agents/: another session deletes it).
3. Full chromium e2e on the merged branch; then push roadmap to main.
4. Repeat the whole exercise (7 subsystem audits + blind + product gaps,
   synthesis artifact https://claude.ai/artifact/BX3BF2F1MG75X2U7WWyJNT, new
   roadmap), execute it, push to main again.

Backlog of found defects: /tmp/claude-1000/-mnt-Ghar-2TA-DevStuff-atlasdraw/245f6bc3-9bc2-431b-bf89-f0e9e96a98f3/scratchpad/lead/backlog.md
Audit reports: /tmp/claude-1000/-mnt-Ghar-2TA-DevStuff-atlasdraw/245f6bc3-9bc2-431b-bf89-f0e9e96a98f3/scratchpad/audit-*.md, research-08-product-gaps.md
Lead gate: /tmp/claude-1000/-mnt-Ghar-2TA-DevStuff-atlasdraw/245f6bc3-9bc2-431b-bf89-f0e9e96a98f3/scratchpad/lead/roadmap-gate.sh "<msg>" [vitest paths]
