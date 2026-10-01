---
scope:
  - code/packages/data/src/base64url.ts
  - code/packages/data/src/yjs-crypto.ts
  - code/apps/atlas-app/src/collab/scene-crypto.ts
tags: [canonicalization, crypto, dedup]
priority: medium
source: hand-written
---

# Base64url helpers live in one place — verify before "consolidating"

`uint8ArrayToBase64Url`/`base64UrlToUint8Array` live in exactly one place:
`packages/data/src/base64url.ts`, exported from the package barrel.
`yjs-crypto.ts` and `scene-crypto.ts` both import it. If you need base64url
framing anywhere else, import from `@atlasdraw/data` — do not write a private
copy. (See `CANON.md` for the full before/after: this pair was previously
copy-pasted verbatim, one file's header literally said "mirrors" the other.)

`encryptUpdate`/`decryptUpdate` (yjs-crypto.ts) and `encryptScene`/
`decryptScene` (scene-crypto.ts) are **not** duplicates of each other and
must not be merged. They encrypt different payloads (raw Yjs binary update
bytes vs. JSON-serialized Excalidraw scene) for different channels
(y-websocket vs. Socket.IO). `yjs-crypto.ts`'s functions are a deliberate,
ADR-0010-mandated unwired stub — ADR-0010 explicitly considered and rejected
deleting them. Don't "pick a winner" between these two pairs.

## Why this rule exists

Structural similarity (same helper names, same switch shape) is not proof
of duplicated logic. Issue 5 in ISSUES.md once called three files "the same
logic"; one of them did nothing of the kind and was dead code. Verify
consumers and data flow before picking a winner. Full writeup: `CANON.md`.
