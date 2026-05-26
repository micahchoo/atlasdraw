// SPDX-License-Identifier: AGPL-3.0-only
// Phase 6 A4 — Maputnik basemap-style editor modal.
//
// Hosts the open-source MapLibre style editor (Maputnik) in an iframe,
// pointed at the active basemap style URL. Mirrors BasemapPickerDialog's
// overlay/escape/click-outside/focus-trap structure for consistency.
//
// Security posture (cites ADR-0010): we do not trust the iframe to escape
// its boundary. `sandbox="allow-scripts allow-same-origin allow-forms"` is
// enough to let Maputnik run but does NOT include `allow-top-navigation`,
// so the iframe cannot redirect our window. Maputnik has no postMessage
// write-back path in v1 — edits are not saved back to the host map; users
// must copy the style JSON out of Maputnik manually. Do NOT invent a
// postMessage protocol here (per A4 constraints + Q-P6-1: no third-party
// automation surface).
//
// Telemetry posture (cites ADR-0006 / ADR-0011): zero client telemetry. The
// iframe URL is configurable via `getAppConfig().maputnikUrl` so self-hosters
// who don't want the public maputnik.github.io can point at a self-hosted
// instance — no analytics is injected by us.

import React, { useEffect, useMemo, useRef, useState } from "react";

import { FocusTrap } from "./FocusTrap";

export interface MaputnikDialogProps {
  /**
   * URL of the active basemap style JSON. Passed to Maputnik as the `style`
   * query parameter (URL-encoded). Maputnik fetches it directly; this dialog
   * does not proxy or modify the JSON.
   */
  activeStyleUrl: string;
  /**
   * Base URL of the Maputnik editor. Typically `getAppConfig().maputnikUrl`;
   * default is `https://maputnik.github.io/editor/`.
   */
  maputnikUrl: string;
  onCloseRequest: () => void;
}

function buildMaputnikSrc(maputnikUrl: string, styleUrl: string): string {
  return `${maputnikUrl}?style=${encodeURIComponent(styleUrl)}`;
}

export const MaputnikDialog: React.FC<MaputnikDialogProps> = ({
  activeStyleUrl,
  maputnikUrl,
  onCloseRequest,
}) => {
  const panelRef = useRef<HTMLDivElement>(null);
  const closeBtnRef = useRef<HTMLButtonElement>(null);
  // Bumping this cache-buster forces the iframe to remount → effectively
  // "reset to defaults" by re-loading the original style URL.
  const [resetNonce, setResetNonce] = useState(0);

  const src = useMemo(
    () => buildMaputnikSrc(maputnikUrl, activeStyleUrl),
    [maputnikUrl, activeStyleUrl],
  );

  // Focus the close button on open + Escape to close + Tab focus trap.
  useEffect(() => {
    const panel = panelRef.current;
    if (!panel) {
      return;
    }

    closeBtnRef.current?.focus();

    const handleKeyDown = (e: KeyboardEvent) => {
      if (e.key === "Escape") {
        onCloseRequest();
        return;
      }
      if (e.key === "Tab") {
        const focusables = Array.from(
          panel.querySelectorAll<HTMLElement>(
            'button, a, iframe, [tabindex]:not([tabindex="-1"])',
          ),
        );
        if (focusables.length === 0) {
          return;
        }
        const first = focusables[0];
        const last = focusables[focusables.length - 1];
        if (e.shiftKey && document.activeElement === first) {
          last.focus();
          e.preventDefault();
        } else if (!e.shiftKey && document.activeElement === last) {
          first.focus();
          e.preventDefault();
        }
      }
    };

    document.addEventListener("keydown", handleKeyDown);
    return () => document.removeEventListener("keydown", handleKeyDown);
  }, [onCloseRequest]);

  // Click outside to close. Deferred so the click that opened the dialog
  // doesn't immediately close it.
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
      data-testid="maputnik-dialog-overlay"
    >
      <FocusTrap>
        <div
          ref={panelRef}
          role="dialog"
          aria-modal="true"
          aria-label="Maputnik basemap style editor"
          style={{
            background: "var(--color-surface, #fff)",
            borderRadius: "0.5rem",
            padding: "0.75rem",
            width: "min(90vw, 1200px)",
            height: "min(85vh, 800px)",
            boxShadow: "0 4px 20px rgba(0,0,0,0.15)",
            display: "flex",
            flexDirection: "column",
          }}
        >
          {/* Header */}
          <div
            style={{
              display: "flex",
              alignItems: "center",
              justifyContent: "space-between",
              marginBottom: "0.5rem",
              gap: "0.5rem",
            }}
          >
            <h3
              style={{
                margin: 0,
                fontSize: "1rem",
                fontWeight: 600,
              }}
            >
              Edit basemap style
            </h3>
            <div
              style={{ display: "flex", gap: "0.75rem", alignItems: "center" }}
            >
              <button
                type="button"
                data-testid="maputnik-dialog-reset"
                onClick={() => setResetNonce((n) => n + 1)}
                style={{
                  background: "transparent",
                  border: "none",
                  color: "#0aa",
                  cursor: "pointer",
                  fontSize: "0.8125rem",
                  padding: 0,
                  textDecoration: "underline",
                }}
              >
                Reset to defaults
              </button>
              <button
                ref={closeBtnRef}
                type="button"
                aria-label="Close"
                data-testid="maputnik-dialog-close"
                onClick={onCloseRequest}
                style={{
                  background: "transparent",
                  border: "1px solid #ddd",
                  borderRadius: "0.25rem",
                  cursor: "pointer",
                  fontSize: "1rem",
                  lineHeight: 1,
                  padding: "0.25rem 0.5rem",
                  color: "#333",
                }}
              >
                ×
              </button>
            </div>
          </div>

          {/* Iframe body */}
          <iframe
            // Bumping resetNonce remounts the iframe element → reload to defaults.
            key={resetNonce}
            data-testid="maputnik-dialog-iframe"
            title="Maputnik basemap style editor"
            src={src}
            // Sandbox: allow-scripts (Maputnik is JS-driven), allow-same-origin
            // (needed for Maputnik's local fetch of the style URL), allow-forms
            // (Maputnik's import/export dialogs use forms). Deliberately NOT
            // including allow-top-navigation or allow-popups-to-escape-sandbox
            // — see header comment for security posture.
            sandbox="allow-scripts allow-same-origin allow-forms"
            style={{
              flex: 1,
              width: "100%",
              border: "1px solid #ddd",
              borderRadius: "0.25rem",
              background: "#fff",
            }}
          />

          {/* Footer hint */}
          <div
            data-testid="maputnik-dialog-hint"
            style={{
              marginTop: "0.5rem",
              fontSize: "0.75rem",
              color: "#666",
              textAlign: "center",
            }}
          >
            Edits in Maputnik are not saved back to your map — copy the style
            JSON from Maputnik and paste it into your config to apply.
          </div>
        </div>
      </FocusTrap>
    </div>
  );
};
