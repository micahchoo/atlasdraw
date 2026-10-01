---
paths:
  - code/packages/data/src/base64url.ts
tags: [canonicalization, dedup]
priority: medium
source: hand-written
---

# Base64url helpers live in one place

`uint8ArrayToBase64Url`/`base64UrlToUint8Array` live in exactly one place:
`packages/data/src/base64url.ts`, exported from the package barrel. The share
link (`hooks/useShareLink.ts`, `state/loadShareDocument.ts`) imports them. If
you need base64url framing anywhere else, import from `@atlasdraw/data` — do
not write a private copy. `@atlasdraw/protocol`'s room link keeps its own
small encoder on purpose: that package depends on nothing.

## Why this rule exists

Structural similarity (same helper names, same switch shape) is not proof
of duplicated logic. Verify consumers and data flow before picking a winner.
