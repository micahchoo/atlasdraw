# Project Expertise (via Mulch)

## excalidraw-integration (8 records, updated 6h ago)
- [convention] Before any worker brief, plan section, or implementation code names an Excalidraw API (prop, hook, f... (mx-145cd3)
- [failure] Excalidraw v0.18: viewBackgroundColor is NOT a top-level <Excalidraw> prop — it lives in AppState (d... → Pass via initialData.appState: <Excalidraw initialData={{ appState: { viewBackgroundColor: 'transpar... (mx-52992e)
- [failure] Excalidraw v0.18 has NO customTools prop on <Excalidraw>. → Atlasdraw tools dispatch independently of Excalidraw's tool system: AtlasdrawTool interface (code/pa... (mx-00e024)
- [failure] Plan said 'use newElementWith or newTextElement' for creating fresh Excalidraw elements. → Use the factory functions from @excalidraw/element (vendored at code/packages/element/src/newElement... (mx-5d3554)
- [pattern] appstate-newElement-signals-actively-drafting: Excalidraw's AppState exposes a 'newElement' field (NonDeleted<ExcalidrawNonSelectionElement> | null... (mx-ff1394)
- [pattern] atlasdraw-tools-dispatch-via-overlay: Atlasdraw's geo-aware tools (PinTool, future PolygonTool/LineTool) cannot register with Excalidraw v... (mx-dce08c)
- [failure] Excalidraw layer with pointer-events:auto (drawing-mode default in any tool except hand) captures WH... → Install a capture-phase wheel listener on the editor root that intercepts wheel and forwards delta d... (mx-13a1b4) [relates to: mx-52992e, mx-145cd3]
- [decision] wheel-event routing: capture-phase listener on root container → map.easeTo, not synthetic WheelEvent: Root cause of atlasdraw-5afc: Excalidraw layer pointer-events:auto in drawing mode captures wheel be... (mx-a45744)

## Quick Reference

- `mulch search "query"` — find relevant records before implementing
- `mulch prime --files src/foo.ts` — load records for specific files
- `mulch prime --context` — load records for git-changed files
- `mulch record <domain> --type <type> --description "..."`
  - Types: `convention`, `pattern`, `failure`, `decision`, `reference`, `guide`
  - Evidence: `--evidence-commit <sha>`, `--evidence-bead <id>`
- `mulch doctor` — check record health

# 🚨 SESSION CLOSE PROTOCOL 🚨

**CRITICAL**: Before saying "done" or "complete", you MUST run this checklist:

```
[ ] 1. mulch learn              # see what files changed — decide what to record
[ ] 2. mulch record <domain> --type <type> --description "..."
[ ] 3. mulch sync               # validate, stage, and commit .mulch/ changes
```

**NEVER skip this.** Unrecorded learnings are lost for the next session.

## Recent deltas (this session)

error: too many arguments for 'diff'. Expected 0 arguments but got 1.
