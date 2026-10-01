// SPDX-License-Identifier: AGPL-3.0-only
//
// A view of the open document's title, for the surfaces that show or edit
// it (the collar head bar, the browser tab, the export dialog). The document
// (state/document.ts) owns the title; `setTitle` dispatches `rename-document`,
// which folds blank input back to DEFAULT_DOCUMENT_TITLE.

import { create } from "zustand";

import {
  DEFAULT_DOCUMENT_TITLE,
  currentDocument,
  followDocument,
} from "./document";

export { DEFAULT_DOCUMENT_TITLE };

export type DocumentTitleState = {
  title: string;
  setTitle: (title: string) => void;
};

export const useDocumentTitleStore = create<DocumentTitleState>(() => ({
  title: currentDocument().snapshot().title,
  setTitle: (title) =>
    currentDocument().dispatch({ type: "rename-document", title }),
}));

followDocument((doc) => {
  const { title } = doc.snapshot();
  if (useDocumentTitleStore.getState().title !== title) {
    useDocumentTitleStore.setState({ title });
  }
});
