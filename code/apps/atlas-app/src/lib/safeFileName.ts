// SPDX-License-Identifier: AGPL-3.0-only
//
// safeFileName — turn a document title into a download filename stem.
//
// The document name is free text (the user types it in the collar head bar)
// and reaches two download paths that used to hardcode their filenames: the
// `.atlasdraw` save picker (state/persistence.ts) and the PDF export
// (components/ExportDialog.tsx). Both need the same conservative reduction,
// so it lives here rather than being written twice.
//
// Conservative on purpose: `\w`, dash and space survive; everything else
// collapses to a single underscore. That covers path separators, the Windows
// reserved set (`<>:"|?*`), leading dots, and control characters in one rule
// instead of a blocklist that has to stay current.

const FALLBACK = "atlasdraw";

export function safeFileName(title: string): string {
  const stem = title
    .replace(/[^\w\- ]+/g, "_")
    .trim()
    // Collapse runs so "map: v2 / final" doesn't become "map__v2___final".
    .replace(/_{2,}/g, "_")
    // A name of only punctuation reduces to underscores — not a filename.
    .replace(/^_+|_+$/g, "")
    .trim();
  return stem === "" ? FALLBACK : stem;
}
