// SPDX-License-Identifier: AGPL-3.0-only
//
// Whether "Server versions…" is offered: when the build saves to a server
// and this browser holds a server map for the open document. The answer goes
// to the session view (`backupAvailable`), where the command reads it.
// ServerVersionsDialog lists the versions; state/myMaps.ts#restoreServerVersion
// and #openServerVersionCopy open one.

import { useEffect } from "react";

import { useStore } from "zustand";

import { getAppConfig } from "../config/app-config";
import { useDocumentStore } from "../state/document";
import { hasServerMap } from "../state/remoteMapIdCache";

import type { EditorSession } from "../session/EditorSession";

export function useServerBackup(
  session: Pick<EditorSession, "view" | "persistence">,
): void {
  const { view } = session;
  const enabled = getAppConfig().enableBackendPersistence;
  const documentId = useDocumentStore((s) => s.doc.id);
  // The first push of a document makes its server map; look again after it.
  const lastSavedAt = useStore(session.persistence, (s) => s.lastSavedAt);

  useEffect(() => {
    if (!enabled) {
      view.setState({ backupAvailable: false });
      return;
    }
    let live = true;
    void hasServerMap(documentId).then((has) => {
      if (live) {
        view.setState({ backupAvailable: has });
      }
    });
    return () => {
      live = false;
    };
  }, [view, enabled, documentId, lastSavedAt]);
}
