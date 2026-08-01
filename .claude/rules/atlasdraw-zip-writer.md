---
scope: code/packages/data/src/atlasdraw.ts
tags: [file-format, perf, invariant]
priority: high
source: hand-written
---

# .atlasdraw writer: every entry must be registered, or the sweep deletes it

`write()` ends with a stale-entry sweep: any non-dir zip entry whose path is
in neither the `texts` map nor the `binaryPaths` set is removed. This is what
makes incremental writes (`AtlasdrawWriteCache`) converge to a fresh write
after layer/file/thumbnail deletions — but it runs on every write.

**Adding a new archive entry type? Register its path in `texts` (DEFLATE'd
text) or `binaryPaths` (STORE'd binary) in the same change**, or the entry is
silently stripped from every archive.

Other invariants, enforced by `atlasdraw-incremental.test.ts`:

- Unchanged-entry reuse is keyed on serialized-string equality, never object
  identity (Excalidraw mutates scene elements in place — identity lies).
- `generateAsync` must keep `compression: "DEFLATE"` as its default; that is
  what lets loaded-but-untouched entries pass through without re-DEFLATE
  (the ~5× autosave win). Explicit per-file STORE overrides it for assets.
- `options.date` pins folder entries too (JSZip stamps implicit folders with
  `new Date()` and ignores the per-file date for them).
- Text bytes are re-wrapped in the local realm's `Uint8Array` before
  `zip.file()` — jsdom tests supply Node's TextEncoder, whose output fails
  JSZip's cross-realm `instanceof` check.

The byte-for-byte contract lives in `atlasdraw-incremental.test.ts` (legacy
writer inlined as reference). Any writer change must keep that suite green.
