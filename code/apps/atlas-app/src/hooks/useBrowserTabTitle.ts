// SPDX-License-Identifier: AGPL-3.0-only
//
// useBrowserTabTitle — mirrors the document name into `document.title`.
//
// Before this hook the tab always read "Atlasdraw" (index.html:6), so a user
// with three maps open had three identical tabs. The suffix is kept so the
// app is still identifiable when the sheet name is generic.

import { useEffect } from "react";

import { useDocumentTitleStore } from "../state/documentTitle";

const SUFFIX = "Atlasdraw";

export function useBrowserTabTitle(): void {
  const title = useDocumentTitleStore((s) => s.title);

  useEffect(() => {
    document.title = `${title} — ${SUFFIX}`;
    // No cleanup that restores the old title: this hook mounts once with the
    // editor and the next value it writes is the correct one anyway.
  }, [title]);
}
