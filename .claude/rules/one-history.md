---
paths:
  - code/apps/atlas-app/src/session/history.ts
  - code/apps/atlas-app/src/state/documentUndo.ts
  - code/apps/atlas-app/src/state/document.ts
  - code/apps/atlas-app/src/state/roomDocument.ts
  - code/apps/atlas-app/src/state/persistence.ts
  - code/apps/atlas-app/src/state/persistenceState.ts
  - code/apps/atlas-app/src/state/myMaps.ts
  - code/apps/atlas-app/src/session/fileActions.ts
  - code/apps/atlas-app/src/hooks/usePersistenceWiring.ts
  - code/apps/atlas-app/src/hooks/useConvertToDataLayer.ts
  - code/packages/excalidraw/history.ts
  - code/packages/excalidraw/actions/actionHistory.tsx
tags: [history, undo, dirty, persistence]
priority: high
source: hand-written
---

# atlas-app: one history, and "unsaved" is its position

`session.history` (`session/history.ts`) is the one undo order over two
sources: document steps (`state/documentUndo.ts` records each local
command with its inverse; comments through `CommentsLayer.trackUndo`) and
the drawing's own entries, which stay in Excalidraw. The fork's
`api.history` is the drawing adapter, and the `historyHost` prop sends the
drawing's undo and redo keys and buttons to the history.

`history.dirty` is the position against the last save, and the only
"unsaved". Before R4 (2026-10-01) there were three flags that disagreed
(audit2-03 F9, blind #9); opening a map marked it dirty.

- **Never add a dirty flag.** An edit is a step. A thing that needs a save
  but is no edit (a new map, an opened file, a copy of a shared map, a
  server backup) calls `persistence.forceSave()` after it opens.
- **A new `DocumentCommand` needs a case in `inverseOf`.** The switch is
  exhaustive, so the compiler asks. A layer command's inverse is
  `put-layer` with the entry and payload from the state before, which keeps
  their identity.
- **A collaborator's change is no step.** A room dispatches with origin
  `"remote"` (`roomDocument.ts#fromRoom`). A new path that applies remote
  content must pass it too, or a user's undo takes a peer's work back.
- **A step that also changes the drawing** goes in `history.group`, with
  the drawing change made outside the drawing's own history
  (`annotations.ts#setDeletedOutsideDrawingHistory`, `NEVER`). Two steps
  for one action is the convert-duplicates-the-shape defect (F8).
- **A save marks the position read before the document**
  (`startAutoSave#saveNow`), so an edit made during the write stays dirty.
- **A document that is not open reads its own drawing.** `openDocument`
  freezes the scene of the document it replaces (blind #5).

Verify with `cd code && npx vitest run apps/atlas-app/src/session
apps/atlas-app/src/state packages/excalidraw/tests/atlasHistoryHost.test.tsx`,
then `e2e/one-history.spec.ts`.
