// SPDX-License-Identifier: AGPL-3.0-only
// ShareDialog — Phase 4 T8. Share-link generation UI.
//
// Mirrors AboutDialog: inline styles, root-level mount, no @excalidraw/Dialog
// dependency, fully testable in jsdom outside the Excalidraw provider tree.
//
// States: idle → generating → success(url, mode) | error(message). Auto-fires
// generate() on mount; the user only sees the loading spinner briefly before
// the success state lands.

import React, { useEffect, useRef, useState } from "react";
import { useShareLink, type ShareMode } from "../hooks/useShareLink";
import type { AtlasdrawDocument } from "@atlasdraw/data";
import type { HttpStorageClient } from "../services/createHttpStorageClient";

export interface ShareDialogProps {
  onCloseRequest: () => void;
  getDoc: () => AtlasdrawDocument;
  client: HttpStorageClient;
}

const MODE_HINT: Record<ShareMode, string> = {
  hash: "Tiny map — link is fully self-contained (no server lookup).",
  upload:
    "Uploaded to server; link expires in 7 days. Edits after sharing won't update this link.",
};

export const ShareDialog: React.FC<ShareDialogProps> = ({
  onCloseRequest,
  getDoc,
  client,
}) => {
  const panelRef = useRef<HTMLDivElement>(null);
  const inputRef = useRef<HTMLInputElement>(null);
  const [url, setUrl] = useState<string | null>(null);
  const [copied, setCopied] = useState(false);
  const { isSharing, error, mode, generate } = useShareLink({
    getDoc,
    client,
  });

  // Auto-fire generation on mount. The dialog opens to "loading" then
  // resolves to success/error.
  useEffect(() => {
    let cancelled = false;
    void (async () => {
      const result = await generate();
      if (!cancelled) setUrl(result);
    })();
    return () => {
      cancelled = true;
    };
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);

  // Escape to close.
  useEffect(() => {
    const panel = panelRef.current;
    if (!panel) return;
    panel.querySelector<HTMLButtonElement>("button")?.focus();
    const handleKeyDown = (e: KeyboardEvent) => {
      if (e.key === "Escape") onCloseRequest();
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

  const handleCopy = async () => {
    if (!url) return;
    try {
      await navigator.clipboard.writeText(url);
      setCopied(true);
      setTimeout(() => setCopied(false), 1500);
    } catch {
      // Fallback: select the input contents so the user can Cmd-C.
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
      <div
        ref={panelRef}
        role="dialog"
        aria-modal="true"
        aria-label="Share map"
        style={{
          background: "#fff",
          borderRadius: "0.5rem",
          padding: "1.25rem 1.5rem",
          maxWidth: "480px",
          width: "calc(100% - 2rem)",
          boxShadow: "0 4px 20px rgba(0,0,0,0.15)",
          color: "#212529",
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

        {isSharing && !url && !error && (
          <div data-testid="share-dialog-loading" style={{ padding: "0.5rem 0" }}>
            Generating share link…
          </div>
        )}

        {error && (
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
            {error}
          </div>
        )}

        {url && (
          <>
            <div style={{ display: "flex", gap: "0.5rem", marginBottom: "0.5rem" }}>
              <input
                ref={inputRef}
                type="text"
                readOnly
                value={url}
                data-testid="share-dialog-url"
                onFocus={(e) => e.currentTarget.select()}
                style={{
                  flex: 1,
                  padding: "6px 8px",
                  border: "1px solid #ced4da",
                  borderRadius: "4px",
                  fontSize: "0.8125rem",
                  fontFamily: "ui-monospace, monospace",
                  background: "#f8f9fa",
                  color: "#212529",
                }}
              />
              <button
                type="button"
                onClick={handleCopy}
                data-testid="share-dialog-copy"
                style={{
                  padding: "6px 14px",
                  border: "1px solid #1971c2",
                  borderRadius: "4px",
                  background: copied ? "#37b24d" : "#1971c2",
                  color: "#fff",
                  fontSize: "0.875rem",
                  fontWeight: 600,
                  cursor: "pointer",
                }}
              >
                {copied ? "Copied" : "Copy link"}
              </button>
            </div>
            {mode && (
              <p
                data-testid="share-dialog-mode-hint"
                data-mode={mode}
                style={{
                  margin: "0 0 0.75rem 0",
                  fontSize: "0.75rem",
                  color: "#495057",
                }}
              >
                {MODE_HINT[mode]}
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
              background: "#fff",
              color: "#212529",
              fontSize: "0.875rem",
              fontWeight: 600,
              cursor: "pointer",
            }}
          >
            Close
          </button>
        </div>
      </div>
    </div>
  );
};
