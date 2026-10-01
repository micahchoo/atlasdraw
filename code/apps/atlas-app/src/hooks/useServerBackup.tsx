// SPDX-License-Identifier: AGPL-3.0-only
//
// "Restore from server backup": offered when the build saves to a server
// and this browser holds a server map for the open document. The question
// is a ConfirmDialog the caller mounts at the root (`dialog`), outside the
// MainMenu, whose auto-close would unmount it.

import React, { useCallback, useEffect, useMemo, useState } from "react";

import type { ExcalidrawImperativeAPI } from "@atlasdraw/excalidraw";

import { ConfirmDialog } from "../components/ConfirmDialog";
import { getAppConfig } from "../config/app-config";
import { createHttpStorageClient } from "../services/createHttpStorageClient";
import { useDocumentStore } from "../state/document";
import { restoreServerBackup, type MapActionContext } from "../state/myMaps";
import { hasServerMap } from "../state/remoteMapIdCache";
import { usePersistenceStore } from "../state/usePersistenceStore";

export interface ServerBackup {
  /** True when the menu item is shown. */
  available: boolean;
  /** Ask, then restore. */
  request: () => void;
  /** The question, or null. Mount it at the root. */
  dialog: React.ReactNode;
}

export function useServerBackup(
  excalidrawAPI: ExcalidrawImperativeAPI | null,
  notify: MapActionContext["notify"],
): ServerBackup {
  const enabled = getAppConfig().enableBackendPersistence;
  const documentId = useDocumentStore((s) => s.doc.id);
  // The first push of a document makes its server map; look again after it.
  const lastSavedAt = usePersistenceStore((s) => s.lastSavedAt);
  const [available, setAvailable] = useState(false);
  const [answer, setAnswer] = useState<((yes: boolean) => void) | null>(null);

  useEffect(() => {
    if (!enabled) {
      setAvailable(false);
      return;
    }
    let live = true;
    void hasServerMap(documentId).then((has) => {
      if (live) {
        setAvailable(has);
      }
    });
    return () => {
      live = false;
    };
  }, [enabled, documentId, lastSavedAt]);

  const request = useCallback(() => {
    if (!excalidrawAPI) {
      return;
    }
    void restoreServerBackup({
      api: excalidrawAPI,
      notify,
      client: createHttpStorageClient({
        baseUrl: getAppConfig().storageBaseUrl ?? "",
      }),
      confirm: () =>
        new Promise<boolean>((resolve) =>
          setAnswer(() => (yes: boolean) => {
            setAnswer(null);
            resolve(yes);
          }),
        ),
    });
  }, [excalidrawAPI, notify]);

  const dialog = useMemo(
    () =>
      answer && (
        <ConfirmDialog
          title="Restore from server backup?"
          body="The server copy of this map replaces the map you see. Changes that are not on the server are lost."
          confirmLabel="Restore"
          onConfirm={() => answer(true)}
          onCancel={() => answer(false)}
        />
      ),
    [answer],
  );

  return { available, request, dialog };
}
