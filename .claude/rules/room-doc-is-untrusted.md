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
  skipped, and `rejectFrom` says so once per peer.
- **Never delete what was skipped.** `toRoom` deletes a room entry only when
  the entry passes its check: a newer client may write a kind this one does
  not know. `writeScene` writes a local element over an invalid one, which
  is a repair, not a delete.
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
