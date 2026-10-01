// SPDX-License-Identifier: AGPL-3.0-only
//
// Whether "Restore from server backup" is offered: when the build saves to a
// server and this browser holds a server map for the open document. The
// answer goes to the session view (`backupAvailable`), where the command
// reads it; session/fileActions.ts#restoreBackup does the restore.

import { useEffect } from "react";

import { getAppConfig } from "../config/app-config";
import { useDocumentStore } from "../state/document";
import { hasServerMap } from "../state/remoteMapIdCache";
import { usePersistenceStore } from "../state/usePersistenceStore";

import type { ViewStore } from "../session/view";

export function useServerBackup(view: ViewStore): void {
  const enabled = getAppConfig().enableBackendPersistence;
  const documentId = useDocumentStore((s) => s.doc.id);
  // The first push of a document makes its server map; look again after it.
  const lastSavedAt = usePersistenceStore((s) => s.lastSavedAt);

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
