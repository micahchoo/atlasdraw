---
paths:
  - code/apps/atlas-app/src/state/pinDetails.ts
  - code/apps/atlas-app/src/state/documentGate.ts
  - code/apps/atlas-app/src/state/documentIO.ts
  - code/apps/atlas-app/src/state/roomScene.ts
  - code/apps/atlas-app/src/state/roomValidation.ts
  - code/apps/atlas-app/src/components/FeaturePopup.tsx
  - code/apps/atlas-app/src/components/PinDetailsDialog.tsx
  - code/apps/atlas-app/src/components/EmbedView.tsx
tags: [pins, security, files]
priority: high
source: hand-written
---

# Pin details: one reader, and every file collector asks `elementFileIds`

A pin's title, description, link and photo live in `customData.pin` on the
pin element (R8c, 2026-10-01). They come from files and room peers the user
did not write.

- **Read them only through `pinDetails.ts#readPinDetails`.** It drops a
  field of the wrong type, an over-long field, and a link that is not http
  or https. The gate (`roomValidation.ts#checkElement`) repairs a pin with
  the same function. Show the fields as text nodes; a link gets
  `target="_blank" rel="noopener noreferrer"`.
- **A photo is a file of the drawing, named by id.** Three paths keep a
  drawing's files: the file gate (`documentGate.ts`), the save
  (`documentIO.ts`) and the room (`roomScene.ts`). Each asks
  `elementFileIds(el)`, never `el.fileId`. A new collector that reads
  `fileId` drops every pin photo as unused, with no error.
- **The popup shows only a `data:image/` photo** (`photoUrlOf`), never a
  URL of another host.
- **An edit is one step of the drawing's history**: `setPinDetails` uses
  `newElementWith` and `CaptureUpdateAction.IMMEDIATELY`. With `NEVER`, the
  e2e shows that Ctrl+Z skips the edit and removes the pin.

Verify with `cd code && npx vitest run apps/atlas-app/src/state
apps/atlas-app/src/components`, then in `apps/atlas-app`:
`E2E_PORT=5360 npx playwright test e2e/pin-details.spec.ts --project=chromium`.
