// SPDX-License-Identifier: AGPL-3.0-only
// AboutDialog — Phase 4 T14. Telemetry policy + version + license surface.
//
// Modal pattern mirrors BasemapPickerDialog (inline styles, root-level mount,
// no @excalidraw/Dialog dependency) so it's testable in jsdom outside the
// Excalidraw provider tree.

import React, { useEffect, useRef } from "react";
import { getAppConfig } from "../config/app-config";
import type { BuildTarget } from "../config/app-config";

export interface AboutDialogProps {
  onCloseRequest: () => void;
}

const BUILD_TARGET_LABEL: Record<BuildTarget, string> = {
  pages: "Demo edition (static)",
  "local-only": "Local edition (no backend)",
  hosted: "Self-hosted edition",
};

export const AboutDialog: React.FC<AboutDialogProps> = ({ onCloseRequest }) => {
  const panelRef = useRef<HTMLDivElement>(null);
  const cfg = getAppConfig();
  const version = import.meta.env.VITE_APP_VERSION ?? "unknown";
  const gitHash = import.meta.env.VITE_GIT_HASH ?? "unknown";

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
      data-testid="about-dialog-overlay"
    >
      <div
        ref={panelRef}
        role="dialog"
        aria-modal="true"
        aria-label="About Atlasdraw"
        style={{
          background: "#fff",
          borderRadius: "0.5rem",
          padding: "1.25rem 1.5rem",
          maxWidth: "420px",
          width: "calc(100% - 2rem)",
          boxShadow: "0 4px 20px rgba(0,0,0,0.15)",
          color: "#212529",
          fontSize: "0.875rem",
          lineHeight: 1.5,
        }}
      >
        <h2
          style={{
            margin: "0 0 0.5rem 0",
            fontSize: "1.125rem",
            fontWeight: 600,
          }}
        >
          About Atlasdraw
        </h2>

        <dl
          data-testid="about-dialog-meta"
          style={{
            display: "grid",
            gridTemplateColumns: "auto 1fr",
            columnGap: "0.75rem",
            rowGap: "0.25rem",
            margin: "0 0 1rem 0",
            fontSize: "0.8125rem",
          }}
        >
          <dt style={{ color: "#868e96" }}>Version</dt>
          <dd
            data-testid="about-dialog-version"
            style={{ margin: 0, fontFamily: "ui-monospace, monospace" }}
          >
            {version}
          </dd>
          <dt style={{ color: "#868e96" }}>Build</dt>
          <dd
            data-testid="about-dialog-git-hash"
            style={{ margin: 0, fontFamily: "ui-monospace, monospace" }}
          >
            {gitHash}
          </dd>
          <dt style={{ color: "#868e96" }}>License</dt>
          <dd style={{ margin: 0 }}>
            <span
              style={{
                display: "inline-block",
                padding: "1px 6px",
                borderRadius: "3px",
                background: "#dbeafe",
                color: "#1e3a8a",
                fontSize: "0.6875rem",
                fontWeight: 500,
              }}
            >
              AGPL-3.0
            </span>
          </dd>
          <dt style={{ color: "#868e96" }}>Edition</dt>
          <dd
            data-testid="about-dialog-build-target"
            style={{ margin: 0 }}
          >
            {BUILD_TARGET_LABEL[cfg.buildTarget]}
          </dd>
        </dl>

        <section
          data-testid="about-dialog-telemetry"
          style={{
            background: "#f8f9fa",
            border: "1px solid #e9ecef",
            borderRadius: "4px",
            padding: "0.625rem 0.75rem",
            margin: "0 0 1rem 0",
          }}
        >
          <strong style={{ fontSize: "0.8125rem" }}>Telemetry policy</strong>
          <p style={{ margin: "0.25rem 0 0 0", fontSize: "0.8125rem" }}>
            No analytics. No call-home. No required API keys.
          </p>
        </section>

        {cfg.showDemoBadge && (
          <section
            data-testid="about-dialog-demo-note"
            style={{
              background: "#fef3c7",
              border: "1px solid #fde68a",
              borderRadius: "4px",
              padding: "0.625rem 0.75rem",
              margin: "0 0 1rem 0",
              fontSize: "0.8125rem",
            }}
          >
            You're using the static demo. Sharing, realtime collaboration, and
            persistent backends ship with{" "}
            <a
              href="https://github.com/atlasdraw/atlasdraw#self-host"
              target="_blank"
              rel="noopener noreferrer"
              style={{ color: "#1971c2" }}
            >
              self-hosted Atlasdraw
            </a>
            .
          </section>
        )}

        <div style={{ display: "flex", justifyContent: "flex-end" }}>
          <button
            type="button"
            onClick={onCloseRequest}
            data-testid="about-dialog-close"
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
