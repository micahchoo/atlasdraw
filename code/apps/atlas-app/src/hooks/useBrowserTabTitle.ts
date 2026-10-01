// SPDX-License-Identifier: AGPL-3.0-only
//
// useBrowserTabTitle — mirrors the document name into `document.title`.
//
// Without it the tab reads "Atlasdraw" (index.html), so a user with three
// maps open has three identical tabs. The suffix is kept so the app is
// still identifiable when the sheet name is generic.

import { useEffect } from "react";

import { useDocument } from "../state/document";

const SUFFIX = "Atlasdraw";

export function useBrowserTabTitle(): void {
  const title = useDocument((s) => s.title);

  useEffect(() => {
    document.title = `${title} — ${SUFFIX}`;
    // No cleanup that restores the old title: this hook mounts once with the
    // editor and the next value it writes is the correct one anyway.
  }, [title]);
}
