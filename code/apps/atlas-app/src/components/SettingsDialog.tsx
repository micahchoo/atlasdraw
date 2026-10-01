/**
 * SettingsDialog — tabbed settings modal: the storage backend and the
 * collaboration server this build uses. The basemap is chosen in the Layers
 * panel, as the bottom of the layer stack.
 *
 * Design: drafting-room settings card — tabs for categorization, vellum
 * surface, blueprint accent on active tab. Clean, instrumental, quick.
 */

import React, { useEffect, useState } from "react";

import styles from "../styles/SettingsDialog.module.css";

import { getAppConfig } from "../config/app-config";

import { Modal } from "./Modal";

// ---------------------------------------------------------------------------
// Props
// ---------------------------------------------------------------------------

interface SettingsDialogProps {
  onCloseRequest: () => void;
}

// ---------------------------------------------------------------------------
// Tabs
// ---------------------------------------------------------------------------

type Tab = "storage" | "collaboration";

const TABS: { id: Tab; label: string }[] = [
  { id: "storage", label: "Storage" },
  { id: "collaboration", label: "Collab" },
];

// ---------------------------------------------------------------------------

export function SettingsDialog({ onCloseRequest }: SettingsDialogProps) {
  const [activeTab, setActiveTab] = useState<Tab>("storage");

  return (
    <Modal
      label="Settings"
      onClose={onCloseRequest}
      scrimClassName={styles.scrim}
      scrimTestId="settings-dialog-scrim"
      className={styles.dialog}
      testId="settings-dialog"
    >
      {/* Header */}
      <div className={styles.header}>
        <span className={styles.title}>Settings</span>
        <button
          type="button"
          className={styles.closeBtn}
          onClick={onCloseRequest}
          aria-label="Close"
          data-testid="settings-dialog-close"
        >
          ×
        </button>
      </div>

      {/* Tabs */}
      <div className={styles.tabStrip}>
        {TABS.map((t) => (
          <button
            key={t.id}
            type="button"
            className={[styles.tab, activeTab === t.id ? styles.tabActive : ""]
              .filter(Boolean)
              .join(" ")}
            onClick={() => setActiveTab(t.id)}
            aria-pressed={activeTab === t.id}
            data-testid={`settings-tab-${t.id}`}
          >
            {t.label}
          </button>
        ))}
      </div>

      {/* Body */}
      <div className={styles.body}>
        {activeTab === "storage" && <StorageTab />}
        {activeTab === "collaboration" && <CollaborationTab />}
      </div>

      {/* Footer */}
      <div className={styles.footer}>
        <button
          type="button"
          className={styles.footerBtn}
          onClick={onCloseRequest}
          data-testid="settings-dialog-done"
        >
          Done
        </button>
      </div>
    </Modal>
  );
}

// ---------------------------------------------------------------------------
// Tab bodies
// ---------------------------------------------------------------------------

type StorageStatus = "checking" | "connected" | "unreachable";

function StorageTab() {
  const cfg = getAppConfig();
  const [status, setStatus] = useState<StorageStatus>("checking");

  // The client has no way to know postgres-minio vs. sqlite+filesystem — that
  // adapter choice is entirely server-side. What it CAN report honestly:
  // whether a backend is configured at all, and (if so) whether it's
  // actually reachable right now — a live check, not a hardcoded label.
  useEffect(() => {
    if (!cfg.enableBackendPersistence) {
      return;
    }
    let cancelled = false;
    void (async () => {
      try {
        const res = await fetch(`${cfg.storageBaseUrl}/health`);
        if (!cancelled) {
          setStatus(res.ok ? "connected" : "unreachable");
        }
      } catch {
        if (!cancelled) {
          setStatus("unreachable");
        }
      }
    })();
    return () => {
      cancelled = true;
    };
  }, [cfg.enableBackendPersistence, cfg.storageBaseUrl]);

  if (!cfg.enableBackendPersistence) {
    return (
      <div>
        <h3 className={styles.sectionTitle}>Storage backend</h3>
        <div className={styles.fieldGroup}>
          <span className={styles.fieldLabel}>Mode</span>
          <span className={styles.fieldValue} data-testid="storage-mode">
            Local-only (IndexedDB) — no backend configured
          </span>
        </div>
        <p className={styles.fieldLabel}>
          Configure storage via environment variables. See{" "}
          <code>docs/self-host/</code> for options.
        </p>
      </div>
    );
  }

  return (
    <div>
      <h3 className={styles.sectionTitle}>Storage backend</h3>
      <div className={styles.fieldGroup}>
        <span className={styles.fieldLabel}>Base URL</span>
        <span className={styles.fieldValue} data-testid="storage-mode">
          {cfg.storageBaseUrl || "(same-origin)"}
        </span>
      </div>
      <div className={styles.fieldGroup}>
        <span className={styles.fieldLabel}>Status</span>
        <span className={styles.fieldValue} data-testid="storage-status">
          {status === "checking" && "Checking…"}
          {status === "connected" && "Connected"}
          {status === "unreachable" && "Unreachable"}
        </span>
      </div>
      <p className={styles.fieldLabel}>
        Configure storage via environment variables. See{" "}
        <code>docs/self-host/</code> for options.
      </p>
    </div>
  );
}

function CollaborationTab() {
  const cfg = getAppConfig();
  return (
    <div>
      <h3 className={styles.sectionTitle}>Collaboration</h3>
      <div className={styles.fieldGroup}>
        <span className={styles.fieldLabel}>Realtime server</span>
        <span className={styles.fieldValue} data-testid="realtime-url">
          {cfg.realtime.enabled && cfg.realtime.wsUrl
            ? cfg.realtime.wsUrl
            : "Disabled (set VITE_REALTIME_ENABLED + VITE_REALTIME_WS_URL to enable)"}
        </span>
      </div>
      <div className={styles.fieldGroup}>
        <span className={styles.fieldLabel}>Presence</span>
        <span className={styles.fieldValue}>
          {cfg.realtime.enabled
            ? "Cursor + viewport sharing enabled"
            : "Disabled — no realtime server configured"}
        </span>
      </div>
    </div>
  );
}
