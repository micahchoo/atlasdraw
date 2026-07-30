// SPDX-License-Identifier: AGPL-3.0-only
// Document title — Zustand store.
//
// The sheet name printed in the collar head bar (CollarShell) and written to
// `Manifest.title` on every save. It gets its own store for the same reason
// `state/basemap.ts` does: three surfaces read or write it and none of them
// can pass props to the others —
//
//   SheetNameField  — click-to-edit field in the collar head bar
//   selectDocument  — stamps `manifest.title` on every auto-save tick
//   hydrate         — restores the title when a document is opened
//
// Empty is not a representable state: `setTitle` folds blank input back to
// DEFAULT_DOCUMENT_TITLE so the head bar can never render an invisible name
// and `manifest.title` is never "".

import { create } from "zustand";

export const DEFAULT_DOCUMENT_TITLE = "Untitled atlasdraw";

export type DocumentTitleState = {
  title: string;
  setTitle: (title: string) => void;
};

export const useDocumentTitleStore = create<DocumentTitleState>((set) => ({
  title: DEFAULT_DOCUMENT_TITLE,
  setTitle: (title) => set({ title: title.trim() || DEFAULT_DOCUMENT_TITLE }),
}));
