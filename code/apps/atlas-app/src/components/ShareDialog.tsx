// SPDX-License-Identifier: AGPL-3.0-only
// ShareDialog — share the map read-only, or make it a shared room.
//
// Mirrors AboutDialog: inline styles, root-level mount, no @excalidraw/Dialog
// dependency, fully testable in jsdom outside the Excalidraw provider tree.
//
// The dialog opens to a mode picker — "Share read-only" vs "Collaborate".
// Read-only keeps the hash/upload choice inside useShareLink (the user picks
// the capability; hash vs upload is a size-based decision). An upload link
// reads the document's server map, so a save updates the link and every
// embed; it lasts until the owner stops it, unless the owner chose an
// expiry. Collaborate makes a room from the open map (hooks/useRoom.ts) and
// shows its link; in a room it shows the link of that room.
//
// The dialog closes on a press on its backdrop, tested at mousedown on the
// backdrop element itself. A document-level click test is wrong here: the
// picker button unmounts while React handles its click, and a detached
// target is "outside" every panel.
//
// A `#room:` link lets anyone who has it edit; the room id alone grants
// nothing (ADR-0014). Read-only links (`/m#v2:`, `/m#v1:`, `/m/<token>`) stay
// read-only. The hint in the collab success state says so.

import React, { useEffect, useRef, useState } from "react";

import type { AtlasdrawDocument } from "@atlasdraw/data";

import { getAppConfig } from "../config/app-config";
import { useShareLink, type ShareMode } from "../hooks/useShareLink";

import { FocusTrap } from "./FocusTrap";

import type { HttpStorageClient } from "../services/createHttpStorageClient";

export interface ShareDialogProps {
  onCloseRequest: () => void;
  getDoc: () => AtlasdrawDocument;
  client: HttpStorageClient;
  /**
   * Make a room from the open map, or keep the editor's room; resolves with
   * its URL. Null when the editor offers no rooms: Collaborate is not shown.
   */
  startRoom: (() => Promise<string>) | null;
}

type DialogView =
  | { kind: "picker" }
  | { kind: "readonly-loading" }
  | {
      kind: "readonly-success";
      url: string;
      mode: ShareMode;
      token: string | null;
      expiresAt: string | null;
    }
  | { kind: "revoked" }
  | { kind: "collab-loading" }
  | { kind: "collab-success"; url: string }
  /** `message` null: the share hook's own error says what went wrong. */
  | { kind: "error"; message: string | null };

/** The read-only link's lifetime, as the picker offers it. "" is none. */
const EXPIRY_CHOICES: ReadonlyArray<{ value: string; label: string }> = [
  { value: "", label: "Until you stop it" },
  { value: "7", label: "7 days" },
  { value: "30", label: "30 days" },
];

const HASH_HINT =
  "This link holds a copy of the map. Later edits do not change it.";

/** What an upload link does when the map changes, and how long it works. */
function uploadHint(expiresAt: string | null): string {
  const updates = getAppConfig().enableBackendPersistence
    ? "Each save updates this link and every embed made from it."
    : "Share again to update this link and every embed made from it.";
  const lasts =
    expiresAt === null
      ? "It works until you stop it."
      : `It stops working on ${new Date(expiresAt).toLocaleDateString()}.`;
  return `Anyone with this link can view the map. ${updates} ${lasts}`;
}

// The capability of a room link, said to the person who shares it.
const COLLAB_HINT = "Collaborative — anyone with this link can edit.";

export const ShareDialog: React.FC<ShareDialogProps> = ({
  onCloseRequest,
  getDoc,
  client,
  startRoom,
}) => {
  const panelRef = useRef<HTMLDivElement>(null);
  const inputRef = useRef<HTMLInputElement>(null);
  const [view, setView] = useState<DialogView>({ kind: "picker" });
  const [copied, setCopied] = useState(false);
  const [expiry, setExpiry] = useState("");
  const {
    generate,
    revoke,
    error: shareError,
  } = useShareLink({
    getDoc,
    client,
  });

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

  const startReadonly = async () => {
    setView({ kind: "readonly-loading" });
    const link = await generate(expiry === "" ? null : Number(expiry));
    if (link === null) {
      setView({ kind: "error", message: null });
      return;
    }
    setView({ kind: "readonly-success", ...link });
  };

  const stopSharing = async (token: string) => {
    if (await revoke(token)) {
      setView({ kind: "revoked" });
    } else {
      setView({ kind: "error", message: null });
    }
  };

  const startCollab = async () => {
    setView({ kind: "collab-loading" });
    try {
      if (!startRoom) {
        throw new Error("Shared maps are not available here.");
      }
      setView({ kind: "collab-success", url: await startRoom() });
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
      onMouseDown={(e) => {
        if (e.target === e.currentTarget) {
          onCloseRequest();
        }
      }}
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
                  Recipients can view the map, not edit it.
                </div>
              </button>
              <label
                style={{
                  display: "flex",
                  alignItems: "center",
                  gap: "0.5rem",
                  fontSize: "0.75rem",
                  color: "var(--ad-ink-secondary, #495057)",
                }}
              >
                Read-only link works
                <select
                  value={expiry}
                  onChange={(e) => setExpiry(e.target.value)}
                  data-testid="share-dialog-expiry"
                  style={{ fontSize: "0.75rem" }}
                >
                  {EXPIRY_CHOICES.map((c) => (
                    <option key={c.value} value={c.value}>
                      {c.label}
                    </option>
                  ))}
                </select>
              </label>
              {startRoom && (
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
              )}
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

          {view.kind === "revoked" && (
            <p
              data-testid="share-dialog-revoked"
              role="status"
              style={{ margin: "0 0 0.75rem 0" }}
            >
              This link no longer works. Embeds made from it are blank.
            </p>
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
              {view.message ?? shareError ?? "Failed to generate share link."}
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
                  {view.mode === "hash"
                    ? HASH_HINT
                    : uploadHint(view.expiresAt)}
                </p>
              )}
              {view.kind === "readonly-success" && view.token !== null && (
                <button
                  type="button"
                  onClick={() => void stopSharing(view.token!)}
                  data-testid="share-dialog-revoke"
                  style={{
                    margin: "0 0 0.75rem 0",
                    padding: "5px 12px",
                    border: "1px solid #c92a2a",
                    borderRadius: "4px",
                    background: "transparent",
                    color: "#c92a2a",
                    fontSize: "0.8125rem",
                    fontWeight: 600,
                    cursor: "pointer",
                  }}
                >
                  Stop sharing this link
                </button>
              )}
              {view.kind === "readonly-success" && (
                <EmbedSnippet shareUrl={currentUrl} />
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

// ---------------------------------------------------------------------------
// Embed snippet (D1) — a read-only share URL doubles as a map embed. The embed
// route (`/embed…`) mounts the same document chromeless for cross-origin
// <iframe> use; the snippet just repoints the `/m` share URL at `/embed`.
// ---------------------------------------------------------------------------

/** `/m#v2:<enc>` → `/embed#v2:<enc>` · `/m/<token>` → `/embed/<token>`. */
export function toEmbedUrl(shareUrl: string): string {
  return shareUrl.replace(/\/m(#v[12]:|\/)/, "/embed$1");
}

const EmbedSnippet: React.FC<{ shareUrl: string }> = ({ shareUrl }) => {
  const [copied, setCopied] = useState(false);
  const snippet = `<iframe src="${toEmbedUrl(
    shareUrl,
  )}" width="800" height="500" style="border:0;border-radius:8px" loading="lazy" title="Atlasdraw map"></iframe>`;

  const copy = async () => {
    try {
      await navigator.clipboard.writeText(snippet);
      setCopied(true);
      window.setTimeout(() => setCopied(false), 1500);
    } catch {
      // Clipboard blocked — the textarea is selectable as a manual fallback.
    }
  };

  return (
    <div data-testid="embed-snippet-section" style={{ marginTop: "0.25rem" }}>
      <label
        style={{
          display: "block",
          margin: "0 0 0.25rem 0",
          fontSize: "0.75rem",
          fontWeight: 600,
          color: "var(--ad-ink-secondary, #495057)",
        }}
      >
        Embed this map
      </label>
      <textarea
        readOnly
        value={snippet}
        data-testid="embed-snippet"
        onFocus={(e) => e.currentTarget.select()}
        rows={2}
        style={{
          width: "100%",
          boxSizing: "border-box",
          padding: "6px 8px",
          border: "1px solid #ced4da",
          borderRadius: "4px",
          fontSize: "0.75rem",
          fontFamily: "var(--ad-font-mono, ui-monospace, monospace)",
          background: "#f8f9fa",
          color: "var(--ad-ink, #212529)",
          resize: "vertical",
        }}
      />
      <button
        type="button"
        onClick={copy}
        data-testid="embed-snippet-copy"
        style={{
          marginTop: "0.375rem",
          padding: "5px 12px",
          border: "1px solid var(--ad-accent, #1971c2)",
          borderRadius: "4px",
          background: copied ? "#37b24d" : "transparent",
          color: copied
            ? "var(--ad-ink-inverse, #fff)"
            : "var(--ad-accent, #1971c2)",
          fontSize: "0.8125rem",
          fontWeight: 600,
          cursor: "pointer",
        }}
      >
        {copied ? "Copied" : "Copy embed code"}
      </button>
    </div>
  );
};
