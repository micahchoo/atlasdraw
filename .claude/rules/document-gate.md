---
paths:
  - code/apps/atlas-app/src/state/documentGate.ts
  - code/apps/atlas-app/src/state/documentIO.ts
  - code/apps/atlas-app/src/state/loadShareDocument.ts
  - code/apps/atlas-app/src/state/myMaps.ts
  - code/apps/atlas-app/src/state/persistence.ts
  - code/apps/atlas-app/src/state/room.ts
  - code/apps/atlas-app/src/session/fileActions.ts
  - code/apps/atlas-app/src/session/mapOwnership.ts
  - code/apps/atlas-app/src/hooks/usePersistenceWiring.ts
  - code/apps/atlas-app/src/components/EmbedView.tsx
  - code/packages/data/src/atlasdraw.ts
  - code/packages/protocol/src/limits.ts
tags: [document, validation, security, limits]
priority: high
source: hand-written
---

# One door for a document from outside the tab

`state/documentGate.ts#admit(input, from)` is the only way a document from
a file, a share link, a server copy, the browser's saved copy or a
`.excalidraw` import reaches the editor. `loadDocument` and `fromFile` take
an `Admitted`, which only `admit` makes, so the type system closes the door.
Do not add a cast that builds an `Admitted`; spread an existing one only to
change identity (`copyOfSharedMap`).

- **The record checks are `roomValidation.ts`.** The gate calls
  `checkElement`, `checkFeatures`, `checkOverlay` and `isImageType`; a room
  calls the same ones per record. A new rule goes there once.
- **A corrupt part is dropped and counted, never fatal**: elements, layers,
  files (`dropped`). A style the map cannot draw is reset to the default
  (`repaired`). `loadDocument`'s `onDropped` shows `droppedMessage`; every
  editor caller passes it.
- **A frame is refused, never guessed.** `worldProblem` refuses a missing
  frame and a `z0` other than geo `REFERENCE_ZOOM`, for files and for rooms
  (`room.ts` status `damaged`). A room with an id and no frame is made and
  damaged: never write a new frame into it.
- **Every size cap is `@atlasdraw/protocol` `LIMITS`.** `read()` counts
  inflated bytes as they arrive (declared zip sizes lie) and reads the entry
  count before JSZip allocates. `limits.test.ts` holds the order:
  record ≤ message ≤ room, import ≤ upload, upload's layer ≤ archive entry.
  The storage server's `MAX_MAP_BYTES` default is a copy of `LIMITS.upload`.

Verify with `cd code && npx vitest run apps/atlas-app/src/state
packages/data packages/protocol`.
