---
paths:
  - code/apps/atlas-app/src/state/room.ts
  - code/apps/atlas-app/src/state/roomScene.ts
  - code/apps/atlas-app/src/state/roomDocument.ts
  - code/apps/atlas-app/src/state/roomValidation.ts
  - code/apps/atlas-app/src/state/comments.ts
tags: [collab, rooms, validation, security]
priority: high
source: hand-written
---

# A room doc is written by strangers

Anyone with the room link can write any value into any key of the room's
Y.Doc. The relay checks the token, not the content (ADR-0014). So:

- **Every read from the room doc goes through `roomValidation.ts`**:
  `checkElement`, `checkFile`, `checkOverlay`, `checkFeatures`,
  `checkImage`, `checkComment` and the meta checks. A new key in the room
  doc gets a check there before anything reads it. A record that fails is
  skipped, and `rejectFrom` says so once per peer. These checks are also
  the record-level half of the document gate (`documentGate.ts`): files
  and share links pass the same functions. A data layer's style is checked
  with `lib/layerStyle.ts#validateLayerStyle`, the style panel's own check.
- **The frame is refused, never guessed.** `joinRoom` refuses a room whose
  `meta.world` fails `documentGate.ts#worldProblem` (status `damaged`).
- **Never delete what was skipped.** A newer client may write a kind or a
  geometry this one does not know. `readContent` returns `skipped`: every
  layer entry it left out of the Document, both an entry that fails
  `checkOverlay` and a valid entry whose features or image fail. `toRoom`
  deletes an entry only when the Document showed it and its user removed
  it. Until 2026-10-01 `toRoom` asked only `checkOverlay`, so the first
  unrelated edit (a rename) deleted a peer's layer whose features this
  client could not read (audit 2-02 finding 7; `collab.known-red.test.ts`
  "what a client skipped stays in the room"). `writeScene` writes a local
  element over an invalid one, which is a repair, not a delete.
- **A record the client writes must fit one relay message.** The caps in
  `ROOM_LIMITS` that bound a record (raster, file) come from
  `@atlasdraw/protocol` `ROOM_SIZE`, as do the relay's. A seed goes through
  `roomDocument.ts#planSeed`, which packs writes under the message cap and
  refuses a map over a cap before anything connects. Do not write a seed
  or a bulk import as one transaction: one transaction is one message.
- **A repair never bumps `version`.** The per-element conflict rule
  (`roomScene.ts#wins`) depends on it. This is why Excalidraw's
  `restoreElements` is not the validator (it bumps versions, keeps wrong
  types, throws on null, and reads `devicePixelRatio` when imported).
- **`toRoom` waits while a remote transaction is open.** Observers run
  before `afterTransaction`; the comments' observer changes the Document,
  and a `toRoom` then would delete the layers the same transaction brought.
  Found 2026-10-01 (W6b) with a peer that wrote a layer and a comment at
  once.
- An observer of the room doc runs inside the provider's message handler.
  It must not throw: `bindScene` wraps its handlers.

Verify with `cd code && npx vitest run apps/atlas-app/src/state` —
`collab.known-red.test.ts` "what a peer writes is checked" runs a raw
y-websocket peer against two real clients through a real relay.
