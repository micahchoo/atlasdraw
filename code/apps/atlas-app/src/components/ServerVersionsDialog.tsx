// SPDX-License-Identifier: AGPL-3.0-only
//
// Server versions: the revisions the storage server keeps of the open map
// (docs/architecture/adr/0020-server-version-history.md), the current one
// first. "Restore" makes a version the map's content again, as a new
// revision, after a question; "Open a copy" opens it as a new map of its own
// and changes nothing. The actions are state/myMaps.ts; this lists and asks.
//
// A modal, as My maps is: it lists things, which the main menu cannot. It
// uses My maps' styles, so the two lists look and read the same. Its
// question is a Modal inside it, so Escape answers the question first.

import React, { useEffect, useRef, useState } from "react";

import type { ExcalidrawImperativeAPI } from "@atlasdraw/excalidraw";

import styles from "../styles/MyMapsDialog.module.css";
import { relativeTime } from "../lib/relativeTime";
import { currentDocument } from "../state/document";
import {
  openServerVersionCopy,
  restoreServerVersion,
  type MapActionContext,
} from "../state/myMaps";
import { serverVersions } from "../state/remoteMapIdCache";

import { ConfirmDialog } from "./ConfirmDialog";
import { Modal } from "./Modal";

import type {
  ServerVersion,
  StorageClient,
} from "../services/createHttpStorageClient";

export interface ServerVersionsDialogProps {
  excalidrawAPI: ExcalidrawImperativeAPI;
  /** The editor's map; null while it loads. */
  map?: MapActionContext["map"];
  persistence: MapActionContext["persistence"];
  history: MapActionContext["history"];
  notify: MapActionContext["notify"];
  client: StorageClient;
  onClose: () => void;
  /** The clock the relative times are read against. */
  now?: () => number;
}

/** "640 bytes", "12 KB", "3.4 MB". */
export function byteText(bytes: number): string {
  if (bytes < 1024) {
    return `${bytes} bytes`;
  }
  if (bytes < 1024 * 1024) {
    return `${Math.round(bytes / 1024)} KB`;
  }
  return `${(bytes / (1024 * 1024)).toFixed(1)} MB`;
}

type Listing =
  | { kind: "loading" }
  | { kind: "error" }
  | { kind: "ready"; current: number; versions: ServerVersion[] };

export function ServerVersionsDialog({
  excalidrawAPI,
  map = null,
  persistence,
  history,
  notify,
  client,
  onClose,
  now = Date.now,
}: ServerVersionsDialogProps) {
  const [listing, setListing] = useState<Listing>({ kind: "loading" });
  const [asking, setAsking] = useState<ServerVersion | null>(null);
  const answer = useRef<((yes: boolean) => void) | null>(null);

  useEffect(() => {
    let live = true;
    serverVersions(client, currentDocument().id).then(
      (found) => {
        if (live) {
          setListing(
            found
              ? { kind: "ready", ...found }
              : { kind: "ready", current: 0, versions: [] },
          );
        }
      },
      (err: unknown) => {
        // eslint-disable-next-line no-console
        console.warn("[atlasdraw] server versions failed", err);
        if (live) {
          setListing({ kind: "error" });
        }
      },
    );
    return () => {
      live = false;
      // The dialog going answers an open question.
      answer.current?.(false);
    };
  }, [client]);

  const ctx: MapActionContext = {
    api: excalidrawAPI,
    map,
    persistence,
    history,
    notify,
  };

  const restore = async (version: ServerVersion) => {
    await restoreServerVersion(
      {
        ...ctx,
        client,
        confirm: () =>
          new Promise<boolean>((resolve) => {
            answer.current = (yes) => {
              answer.current = null;
              setAsking(null);
              resolve(yes);
            };
            setAsking(version);
          }),
      },
      version.revision,
    );
    onClose();
  };

  const openCopy = async (version: ServerVersion) => {
    await openServerVersionCopy({ ...ctx, client }, version.revision);
    onClose();
  };

  return (
    <Modal
      labelledBy="server-versions-title"
      onClose={onClose}
      scrimClassName={styles.scrim}
      scrimTestId="server-versions-scrim"
      className={styles.dialog}
      testId="server-versions-dialog"
    >
      <div className={styles.header}>
        <h2 id="server-versions-title" className={styles.title}>
          Server versions
        </h2>
        <button
          type="button"
          className={styles.closeBtn}
          onClick={onClose}
          aria-label="Close"
          data-testid="server-versions-close"
        >
          ×
        </button>
      </div>

      <div className={styles.body}>
        {listing.kind === "loading" && (
          <p className={styles.empty}>Getting the versions from the server…</p>
        )}
        {listing.kind === "error" && (
          <p className={styles.empty} data-testid="server-versions-error">
            Could not get the versions from the server. Try again later.
          </p>
        )}
        {listing.kind === "ready" && listing.versions.length === 0 && (
          <p className={styles.empty}>This map has no server copy yet.</p>
        )}
        {listing.kind === "ready" && listing.versions.length > 0 && (
          <ul
            className={styles.list}
            aria-label="Server versions"
            data-testid="server-versions-list"
          >
            {listing.versions.map((version) => {
              const current = version.revision === listing.current;
              const when = relativeTime(version.savedAt, now());
              return (
                <li
                  key={version.revision}
                  className={styles.row}
                  data-testid="server-versions-row"
                  data-revision={version.revision}
                >
                  <div className={styles.meta}>
                    <span className={styles.mapTitle}>
                      <time dateTime={version.savedAt}>{when}</time>
                    </span>
                    <span className={styles.detail}>
                      {byteText(version.byteSize)}
                      {current && (
                        <span className={styles.openBadge}>Current</span>
                      )}
                    </span>
                  </div>
                  <button
                    type="button"
                    className={styles.button}
                    onClick={() => void openCopy(version)}
                    aria-label={`Open a copy of the version saved ${when}`}
                    data-testid="server-versions-copy"
                  >
                    Open a copy
                  </button>
                  <button
                    type="button"
                    className={styles.button}
                    onClick={() => void restore(version)}
                    aria-label={`Restore the version saved ${when}`}
                    data-testid="server-versions-restore"
                  >
                    Restore
                  </button>
                </li>
              );
            })}
          </ul>
        )}
      </div>

      {asking && (
        <ConfirmDialog
          title="Restore this version?"
          body={`The version saved ${relativeTime(
            asking.savedAt,
            now(),
          )} replaces the map you see, here and on the server. The server keeps the version it replaces, so you can go back to it.`}
          confirmLabel="Restore"
          onConfirm={() => answer.current?.(true)}
          onCancel={() => answer.current?.(false)}
        />
      )}
    </Modal>
  );
}
