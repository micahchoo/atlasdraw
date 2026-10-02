// SPDX-License-Identifier: AGPL-3.0-only
// AboutDialog — telemetry policy + version + license surface.
//
// Inline styles, root-level mount and no @excalidraw/Dialog dependency, so
// it is testable in jsdom outside the Excalidraw provider tree.

import React from "react";

import { getAppConfig } from "../config/app-config";

import { Button } from "./Button";
import { Modal } from "./Modal";

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
  const cfg = getAppConfig();
  const version = cfg.appVersion;
  const gitHash = cfg.gitHash;

  return (
    <Modal
      labelledBy="about-dialog-title"
      onClose={onCloseRequest}
      scrimStyle={{
        position: "fixed",
        inset: 0,
        background: "rgba(0,0,0,0.25)",
        display: "flex",
        alignItems: "center",
        justifyContent: "center",
        zIndex: 999,
      }}
      scrimTestId="about-dialog-overlay"
      style={{
        background: "var(--ad-surface-raised, #fff)",
        borderRadius: "0.5rem",
        padding: "1.25rem 1.5rem",
        maxWidth: "420px",
        width: "calc(100% - 2rem)",
        boxShadow: "0 4px 20px rgba(0,0,0,0.15)",
        color: "var(--ad-ink, #212529)",
        fontSize: "0.875rem",
        lineHeight: 1.5,
      }}
    >
      <h2
        id="about-dialog-title"
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
        <dt style={{ color: "var(--ad-ink-tertiary, #868e96)" }}>Version</dt>
        <dd
          data-testid="about-dialog-version"
          style={{
            margin: 0,
            fontFamily: "var(--ad-font-mono, ui-monospace, monospace)",
          }}
        >
          {version}
        </dd>
        <dt style={{ color: "var(--ad-ink-tertiary, #868e96)" }}>Build</dt>
        <dd
          data-testid="about-dialog-git-hash"
          style={{
            margin: 0,
            fontFamily: "var(--ad-font-mono, ui-monospace, monospace)",
          }}
        >
          {gitHash}
        </dd>
        <dt style={{ color: "var(--ad-ink-tertiary, #868e96)" }}>License</dt>
        <dd style={{ margin: 0 }}>
          <span
            style={{
              display: "inline-block",
              padding: "1px 6px",
              borderRadius: "var(--ad-radius-sm, 3px)",
              background: "#dbeafe",
              color: "#1e3a8a",
              fontSize: "0.6875rem",
              fontWeight: 500,
            }}
          >
            AGPL-3.0
          </span>
        </dd>
        <dt style={{ color: "var(--ad-ink-tertiary, #868e96)" }}>Edition</dt>
        <dd data-testid="about-dialog-build-target" style={{ margin: 0 }}>
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
          No analytics. No call-home. No required API keys.{" "}
          <a
            href="https://github.com/atlasdraw/atlasdraw/blob/main/docs/architecture/adr/0006-telemetry.md"
            target="_blank"
            rel="noopener noreferrer"
            style={{ color: "var(--ad-accent, #1971c2)" }}
          >
            ADR-0006
          </a>
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
            style={{ color: "var(--ad-accent, #1971c2)" }}
          >
            self-hosted Atlasdraw
          </a>
          .
        </section>
      )}

      <div style={{ display: "flex", justifyContent: "flex-end" }}>
        <Button
          onClick={onCloseRequest}
          data-testid="about-dialog-close"
          autoFocus
        >
          Close
        </Button>
      </div>
    </Modal>
  );
};
