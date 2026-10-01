// SPDX-License-Identifier: AGPL-3.0-only
//
// My maps — every map saved in this browser, the last changed first. Open
// one, start a new one, or delete one. The actions are state/myMaps.ts; this
// shows the list and asks the questions.
//
// A modal, because no existing surface lists documents: the MainMenu holds
// actions, not lists, and the sidebar belongs to the open map's layers.

import React, { useCallback, useEffect, useMemo, useState } from "react";

import type { ExcalidrawImperativeAPI } from "@atlasdraw/excalidraw";

import styles from "../styles/MyMapsDialog.module.css";
import { relativeTime } from "../lib/relativeTime";
import { useDocumentStore } from "../state/document";
import {
  deleteSavedMap,
  distinctTitles,
  openSavedMap,
  startNewMap,
  type MapActionContext,
} from "../state/myMaps";
import { hasServerMap } from "../state/remoteMapIdCache";

import { ConfirmDialog } from "./ConfirmDialog";
import { FocusTrap } from "./FocusTrap";

import type { DocumentSummary } from "../state/persistence";
import type { StorageClient } from "../services/createHttpStorageClient";

export interface MyMapsDialogProps {
  excalidrawAPI: ExcalidrawImperativeAPI;
  /** The editor's map; null while it loads. */
  map?: MapActionContext["map"];
  /** The editor's autosave, which holds the maps. */
  persistence: MapActionContext["persistence"];
  notify: MapActionContext["notify"];
  onClose: () => void;
  /** The clock the relative times are read against. */
  now?: () => number;
  /** The storage server, when this build saves maps to one. */
  server?: StorageClient | null;
}

type Prompt =
  /** `onServer`: the map has a server copy this browser can delete. */
  | { kind: "delete"; map: DocumentSummary; onServer: boolean }
  | { kind: "loss"; answer: (yes: boolean) => void };

export function MyMapsDialog({
  excalidrawAPI,
  map = null,
  persistence,
  notify,
  onClose,
  now = Date.now,
  server = null,
}: MyMapsDialogProps) {
  const [maps, setMaps] = useState<DocumentSummary[] | null>(null);
  const [prompt, setPrompt] = useState<Prompt | null>(null);
  const [alsoServer, setAlsoServer] = useState(false);
  const openId = useDocumentStore((s) => s.doc.id);

  const refresh = useCallback(async () => {
    const state = persistence.getState();
    const store = state.persistenceStore;
    if (!store) {
      setMaps([]);
      return;
    }
    // The open map's latest changes belong in the list.
    if (store.isDirty()) {
      await state.forceSave().catch(() => undefined);
    }
    setMaps(await store.list());
  }, [persistence]);

  useEffect(() => {
    void refresh();
  }, [refresh]);

  useEffect(() => {
    const onKeyDown = (e: KeyboardEvent) => {
      // A question that is open answers its own Escape.
      if (e.key === "Escape" && !prompt) {
        onClose();
      }
    };
    document.addEventListener("keydown", onKeyDown);
    return () => document.removeEventListener("keydown", onKeyDown);
  }, [onClose, prompt]);

  const titles = useMemo(() => distinctTitles(maps ?? []), [maps]);

  const ctx: MapActionContext = {
    api: excalidrawAPI,
    map,
    persistence,
    notify,
    confirmLoss: () =>
      new Promise<boolean>((resolve) =>
        setPrompt({
          kind: "loss",
          answer: (yes) => {
            setPrompt(null);
            resolve(yes);
          },
        }),
      ),
  };

  const open = async (id: string) => {
    if (await openSavedMap(ctx, id)) {
      onClose();
    }
  };

  const startNew = async () => {
    if (await startNewMap(ctx)) {
      onClose();
    }
  };

  const askDelete = async (map: DocumentSummary) => {
    setAlsoServer(false);
    const onServer = server !== null && (await hasServerMap(map.id));
    setPrompt({ kind: "delete", map, onServer });
  };

  const remove = async (map: DocumentSummary, withServer: boolean) => {
    setPrompt(null);
    await deleteSavedMap(ctx, map.id, withServer && server ? { server } : {});
    await refresh();
  };

  return (
    <div
      className={styles.scrim}
      onClick={(e) => {
        if (e.target === e.currentTarget) {
          onClose();
        }
      }}
      data-testid="my-maps-scrim"
    >
      <FocusTrap>
        <div
          className={styles.dialog}
          role="dialog"
          aria-modal="true"
          aria-labelledby="my-maps-title"
          data-testid="my-maps-dialog"
        >
          <div className={styles.header}>
            <h2 id="my-maps-title" className={styles.title}>
              My maps
            </h2>
            <button
              type="button"
              className={styles.closeBtn}
              onClick={onClose}
              aria-label="Close"
              data-testid="my-maps-close"
            >
              ×
            </button>
          </div>

          <div className={styles.body}>
            {maps && maps.length === 0 && (
              <p className={styles.empty} data-testid="my-maps-empty">
                You have no saved maps. Draw on the map or import a file.
                Atlasdraw then saves your map here.
              </p>
            )}
            {maps && maps.length > 0 && (
              <ul
                className={styles.list}
                aria-label="My maps"
                data-testid="my-maps-list"
              >
                {maps.map((map) => {
                  const isOpen = map.id === openId;
                  const title = titles.get(map.id) ?? map.title;
                  return (
                    <li
                      key={map.id}
                      className={styles.row}
                      data-testid="my-maps-row"
                      data-map-id={map.id}
                    >
                      <div className={styles.meta}>
                        <span className={styles.mapTitle}>{title}</span>
                        <span className={styles.detail}>
                          <time dateTime={map.updatedAt}>
                            {relativeTime(map.updatedAt, now())}
                          </time>
                          {isOpen && (
                            <span className={styles.openBadge}>Open now</span>
                          )}
                        </span>
                      </div>
                      <button
                        type="button"
                        className={styles.button}
                        onClick={() => void open(map.id)}
                        disabled={isOpen}
                        aria-disabled={isOpen ? "true" : undefined}
                        title={isOpen ? "This map is open" : undefined}
                        aria-label={`Open ${title}`}
                        data-testid="my-maps-open"
                      >
                        Open
                      </button>
                      <button
                        type="button"
                        className={[styles.button, styles.buttonDanger].join(
                          " ",
                        )}
                        onClick={() => void askDelete(map)}
                        aria-label={`Delete ${title}`}
                        data-testid="my-maps-delete"
                      >
                        Delete
                      </button>
                    </li>
                  );
                })}
              </ul>
            )}
          </div>

          <div className={styles.footer}>
            <button
              type="button"
              className={[styles.button, styles.buttonPrimary].join(" ")}
              onClick={() => void startNew()}
              data-testid="my-maps-new"
            >
              New map
            </button>
          </div>
        </div>
      </FocusTrap>

      {prompt?.kind === "delete" && (
        <ConfirmDialog
          title="Delete map?"
          body={`"${
            titles.get(prompt.map.id) ?? prompt.map.title
          }" is deleted from this browser. You cannot undo this.`}
          confirmLabel="Delete map"
          tone="destructive"
          option={
            prompt.onServer
              ? {
                  label:
                    "Also delete the server copy. Its links and embeds stop working.",
                  checked: alsoServer,
                  onChange: setAlsoServer,
                }
              : undefined
          }
          onConfirm={() => void remove(prompt.map, alsoServer)}
          onCancel={() => setPrompt(null)}
        />
      )}
      {prompt?.kind === "loss" && (
        <ConfirmDialog
          title="Open another map?"
          body="The changes to this map could not be saved in this browser. If you continue, you lose them."
          confirmLabel="Continue"
          onConfirm={() => prompt.answer(true)}
          onCancel={() => prompt.answer(false)}
        />
      )}
    </div>
  );
}
