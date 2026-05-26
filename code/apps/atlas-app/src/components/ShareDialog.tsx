// SPDX-License-Identifier: AGPL-3.0-only
// ShareDialog — Phase 4 T8 + Phase 5 collab integration (Step 7).
//
// Mirrors AboutDialog: inline styles, root-level mount, no @excalidraw/Dialog
// dependency, fully testable in jsdom outside the Excalidraw provider tree.
//
// Phase 5 amendment: the dialog now opens to a mode picker — "Share read-only"
// vs "Collaborate" — instead of auto-firing useShareLink.generate(). Read-only
// preserves the existing hash/upload heuristic inside useShareLink (the user
// only picks the user-facing capability; hash vs upload remains an internal
// size-based decision). Collaborate goes through generateRoomKey() + CollabState.
//
// Q-P5-2: a `#room:` URL grants write capability — anyone with the link can
// edit. Existing share URLs (`/m#v1:`, `/m/<token>`) remain read-only via the
// ShareView path. The hint text in the collab success state surfaces this
// explicitly to the user.

import React, { useEffect, useRef, useState } from "react";

import { generateRoomKey } from "@atlasdraw/protocol";

import { useShareLink, type ShareMode } from "../hooks/useShareLink";

import { FocusTrap } from "./FocusTrap";

import type { AtlasdrawDocument } from "@atlasdraw/data";
import type { HttpStorageClient } from "../services/createHttpStorageClient";
import type { CollabState } from "../state/collab";

export interface ShareDialogProps {
  onCloseRequest: () => void;
  getDoc: () => AtlasdrawDocument;
  client: HttpStorageClient;
  /**
   * CollabState owned by MapEditor. The dialog reuses this instance so the
   * resulting collab session is the same socket as the editor's live session
   * — no double-connect to the same room.
   */
  collabState: CollabState;
}

type DialogView =
  | { kind: "picker" }
  | { kind: "readonly-loading" }
  | { kind: "readonly-success"; url: string; mode: ShareMode }
  | { kind: "collab-loading" }
  | { kind: "collab-success"; url: string }
  | { kind: "error"; message: string };

const READONLY_MODE_HINT: Record<ShareMode, string> = {
  hash: "Tiny map — link is fully self-contained (no server lookup).",
  upload:
    "Uploaded to server; link expires in 7 days. Edits after sharing won't update this link.",
};

// Q-P5-2: this hint text surfaces the write-capability semantics of the
// collab link to the user. Anyone holding the URL can edit; there is no
// server-side auth in Phase 5.
const COLLAB_HINT = "Collaborative — anyone with this link can edit.";

export const ShareDialog: React.FC<ShareDialogProps> = ({
  onCloseRequest,
  getDoc,
  client,
  collabState,
}) => {
  const panelRef = useRef<HTMLDivElement>(null);
  const inputRef = useRef<HTMLInputElement>(null);
  const [view, setView] = useState<DialogView>({ kind: "picker" });
  const [copied, setCopied] = useState(false);
  const { generate } = useShareLink({ getDoc, client });

  // Escape to close.
  useEffect(() => {
    const panel = panelRef.current;
    if (!panel) {
      return;
    }
    panel.querySelector<HTMLButtonElement>("button")?.focus();
    const handleKeyDown = (e: KeyboardEvent) => {
      if (e.key === "Escape") {
        onCloseRequest();
      }
    };
    document.addEventListener("keydown", handleKeyDown);
    return () => document.removeEventListener("keydown", handleKeyDown);
  }, [onCloseRequest]);

  // Click outside to close.
  useEffect(() => {
    const handleClick = (e: MouseEvent) => {
      if (panelRef.current && !panelRef.current.contains(e.target as Node)) {
        onCloseRequest();
      }
    };
    const id = setTimeout(() => {
      document.addEventListener("click", handleClick);
    }, 0);
    return () => {
      clearTimeout(id);
      document.removeEventListener("click", handleClick);
    };
  }, [onCloseRequest]);

  const startReadonly = async () => {
    setView({ kind: "readonly-loading" });
    const result = await generate();
    if (result === null) {
      setView({
        kind: "error",
        message: "Failed to generate share link.",
      });
      return;
    }
    // useShareLink's internal `mode` state is set synchronously inside
    // generate() before it returns the URL, but the React state is stale
    // for our purposes — re-derive from the URL shape.
    const mode: ShareMode = result.includes("/m#v1:") ? "hash" : "upload";
    setView({ kind: "readonly-success", url: result, mode });
  };

  const startCollab = async () => {
    setView({ kind: "collab-loading" });
    try {
      const { roomId, key, fragment } = await generateRoomKey();
      // Reuse the editor's CollabState instance — opens the live session for
      // THIS tab too so any subsequent edits broadcast immediately.
      collabState.connect(roomId, key);
      // `fragment` already starts with `#`; concatenating onto origin yields
      // a same-path `/#room:...` URL (editor route).
      const url = `${window.location.origin}/${fragment}`;
      setView({ kind: "collab-success", url });
    } catch (err) {
      const message =
        err instanceof Error ? err.message : "Failed to start collaboration.";
      setView({ kind: "error", message });
    }
  };

  const currentUrl =
    view.kind === "readonly-success" || view.kind === "collab-success"
      ? view.url
      : null;

  const handleCopy = async () => {
    if (!currentUrl) {
      return;
    }
    try {
      await navigator.clipboard.writeText(currentUrl);
      setCopied(true);
      setTimeout(() => setCopied(false), 1500);
    } catch {
      inputRef.current?.select();
    }
  };

  return (
    <div
      style={{
        position: "fixed",
        inset: 0,
        background: "rgba(0,0,0,0.25)",
        display: "flex",
        alignItems: "center",
        justifyContent: "center",
        zIndex: 999,
      }}
      data-testid="share-dialog-overlay"
    >
      <FocusTrap>
        <div
          ref={panelRef}
          role="dialog"
          aria-modal="true"
          aria-label="Share map"
          style={{
            background: "var(--ad-surface-raised, #fff)",
            borderRadius: "0.5rem",
            padding: "1.25rem 1.5rem",
            maxWidth: "480px",
            width: "calc(100% - 2rem)",
            boxShadow: "0 4px 20px rgba(0,0,0,0.15)",
            color: "var(--ad-ink, #212529)",
            fontSize: "0.875rem",
            lineHeight: 1.5,
          }}
          data-testid="share-dialog-panel"
        >
          <h2
            style={{
              margin: "0 0 0.75rem 0",
              fontSize: "1.125rem",
              fontWeight: 600,
            }}
          >
            Share map
          </h2>

          {view.kind === "picker" && (
            <div
              data-testid="share-dialog-mode-picker"
              style={{
                display: "flex",
                flexDirection: "column",
                gap: "0.5rem",
                margin: "0 0 0.75rem 0",
              }}
            >
              <button
                type="button"
                onClick={startReadonly}
                data-testid="share-dialog-pick-readonly"
                style={{
                  padding: "10px 14px",
                  border: "1px solid #adb5bd",
                  borderRadius: "4px",
                  background: "var(--ad-surface-raised, #ffffff)",
                  color: "var(--ad-ink, #212529)",
                  fontSize: "0.875rem",
                  fontWeight: 600,
                  cursor: "pointer",
                  textAlign: "left",
                }}
              >
                Share read-only
                <div
                  style={{
                    fontSize: "0.75rem",
                    fontWeight: 400,
                    color: "var(--ad-ink-secondary, #495057)",
                    marginTop: "2px",
                  }}
                >
                  Recipients view a snapshot — no live editing.
                </div>
              </button>
              <button
                type="button"
                onClick={startCollab}
                data-testid="share-dialog-pick-collab"
                style={{
                  padding: "10px 14px",
                  border: "1px solid var(--ad-accent, #1971c2)",
                  borderRadius: "4px",
                  background: "var(--ad-accent, #1971c2)",
                  color: "var(--ad-ink-inverse, #ffffff)",
                  fontSize: "0.875rem",
                  fontWeight: 600,
                  cursor: "pointer",
                  textAlign: "left",
                }}
              >
                Collaborate
                <div
                  style={{
                    fontSize: "0.75rem",
                    fontWeight: 400,
                    color: "#dbeafe",
                    marginTop: "2px",
                  }}
                >
                  Live editing — anyone with the link can edit.
                </div>
              </button>
            </div>
          )}

          {(view.kind === "readonly-loading" ||
            view.kind === "collab-loading") && (
            <div
              data-testid="share-dialog-loading"
              style={{ padding: "0.5rem 0" }}
            >
              {view.kind === "collab-loading"
                ? "Starting collaboration…"
                : "Generating share link…"}
            </div>
          )}

          {view.kind === "error" && (
            <div
              data-testid="share-dialog-error"
              role="alert"
              style={{
                background: "#fff5f5",
                border: "1px solid #ffc9c9",
                color: "#c92a2a",
                padding: "0.5rem 0.75rem",
                borderRadius: "4px",
                margin: "0 0 0.75rem 0",
                fontSize: "0.8125rem",
              }}
            >
              {view.message}
            </div>
          )}

          {currentUrl && (
            <>
              <div
                style={{
                  display: "flex",
                  gap: "0.5rem",
                  marginBottom: "0.5rem",
                }}
              >
                <input
                  ref={inputRef}
                  type="text"
                  readOnly
                  value={currentUrl}
                  data-testid="share-dialog-url"
                  onFocus={(e) => e.currentTarget.select()}
                  style={{
                    flex: 1,
                    padding: "6px 8px",
                    border: "1px solid #ced4da",
                    borderRadius: "4px",
                    fontSize: "0.8125rem",
                    fontFamily: "var(--ad-font-mono, ui-monospace, monospace)",
                    background: "#f8f9fa",
                    color: "var(--ad-ink, #212529)",
                  }}
                />
                <button
                  type="button"
                  onClick={handleCopy}
                  data-testid="share-dialog-copy"
                  style={{
                    padding: "6px 14px",
                    border: "1px solid var(--ad-accent, #1971c2)",
                    borderRadius: "4px",
                    background: copied
                      ? "#37b24d"
                      : "var(--ad-accent, #1971c2)",
                    color: "var(--ad-ink-inverse, #fff)",
                    fontSize: "0.875rem",
                    fontWeight: 600,
                    cursor: "pointer",
                  }}
                >
                  {copied ? "Copied" : "Copy link"}
                </button>
              </div>
              {view.kind === "readonly-success" && (
                <p
                  data-testid="share-dialog-mode-hint"
                  data-mode={view.mode}
                  style={{
                    margin: "0 0 0.75rem 0",
                    fontSize: "0.75rem",
                    color: "var(--ad-ink-secondary, #495057)",
                  }}
                >
                  {READONLY_MODE_HINT[view.mode]}
                </p>
              )}
              {view.kind === "collab-success" && (
                <p
                  data-testid="share-dialog-mode-hint"
                  data-mode="collab"
                  style={{
                    margin: "0 0 0.75rem 0",
                    fontSize: "0.75rem",
                    color: "var(--ad-ink-secondary, #495057)",
                  }}
                >
                  {COLLAB_HINT}
                </p>
              )}
            </>
          )}

          <div style={{ display: "flex", justifyContent: "flex-end" }}>
            <button
              type="button"
              onClick={onCloseRequest}
              data-testid="share-dialog-close"
              style={{
                padding: "6px 14px",
                border: "1px solid #adb5bd",
                borderRadius: "4px",
                background: "var(--ad-surface-raised, #fff)",
                color: "var(--ad-ink, #212529)",
                fontSize: "0.875rem",
                fontWeight: 600,
                cursor: "pointer",
              }}
            >
              Close
            </button>
          </div>
        </div>
      </FocusTrap>
    </div>
  );
};
