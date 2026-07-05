/**
 * SettingsDialog — tabbed settings modal.
 *
 * Consolidates basemap selection + storage config + collaboration defaults
 * + workspace info into a single surface. Replaces the standalone
 * BasemapPickerDialog as the primary basemap selection UI.
 *
 * Design: drafting-room settings card — tabs for categorization, vellum
 * surface, blueprint accent on active tab. Clean, instrumental, quick.
 */

import React, { useEffect, useState } from "react";

import { getBasemap, type BasemapConfig } from "@atlasdraw/basemap";

import styles from "../styles/SettingsDialog.module.css";

import { getAppConfig } from "../config/app-config";

import { FocusTrap } from "./FocusTrap";

// ---------------------------------------------------------------------------
// Props
// ---------------------------------------------------------------------------

interface SettingsDialogProps {
  activeBasemapId: string;
  onBasemapChange: (id: BasemapConfig["id"]) => void;
  onCloseRequest: () => void;
  /** Managed-mode workspace id; empty string in self-host. */
  workspaceId?: string;
}

// ---------------------------------------------------------------------------
// Tabs
// ---------------------------------------------------------------------------

type Tab = "basemap" | "storage" | "collaboration" | "workspace";

const TABS: { id: Tab; label: string }[] = [
  { id: "basemap", label: "Basemap" },
  { id: "storage", label: "Storage" },
  { id: "collaboration", label: "Collab" },
  { id: "workspace", label: "Workspace" },
];

// ---------------------------------------------------------------------------

export function SettingsDialog({
  activeBasemapId,
  onBasemapChange,
  onCloseRequest,
  workspaceId,
}: SettingsDialogProps) {
  const [activeTab, setActiveTab] = useState<Tab>("basemap");

  return (
    <FocusTrap>
      <div
        className={styles.scrim}
        onClick={(e) => {
          if (e.target === e.currentTarget) {
            onCloseRequest();
          }
        }}
        data-testid="settings-dialog-scrim"
      >
        <div
          className={styles.dialog}
          role="dialog"
          aria-label="Settings"
          data-testid="settings-dialog"
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
                className={[
                  styles.tab,
                  activeTab === t.id ? styles.tabActive : "",
                ]
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
            {activeTab === "basemap" && (
              <BasemapTab
                activeId={activeBasemapId}
                onSelect={onBasemapChange}
              />
            )}
            {activeTab === "storage" && <StorageTab />}
            {activeTab === "collaboration" && <CollaborationTab />}
            {activeTab === "workspace" && (
              <WorkspaceTab workspaceId={workspaceId} />
            )}
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
        </div>
      </div>
    </FocusTrap>
  );
}

// ---------------------------------------------------------------------------
// Tab bodies
// ---------------------------------------------------------------------------

function BasemapTab({
  activeId,
  onSelect,
}: {
  activeId: string;
  onSelect: (id: BasemapConfig["id"]) => void;
}) {
  const basemaps = getBasemap("__all__") as unknown as BasemapConfig[];

  if (!Array.isArray(basemaps) || basemaps.length === 0) {
    return <p className={styles.fieldLabel}>No basemaps registered.</p>;
  }

  return (
    <div>
      <h3 className={styles.sectionTitle}>Active basemap</h3>
      <div className={styles.basemapList}>
        {(basemaps as BasemapConfig[]).map((b) => {
          const isActive = b.id === activeId;
          return (
            <div
              key={b.id}
              className={[
                styles.basemapItem,
                isActive ? styles.basemapItemActive : "",
              ]
                .filter(Boolean)
                .join(" ")}
              onClick={() => onSelect(b.id)}
              data-testid={`basemap-item-${b.id}`}
            >
              <span className={styles.basemapLabel}>{b.label}</span>
              <span className={styles.basemapSource}>
                {b.requiresRemote ? "Remote" : "Local"}
              </span>
            </div>
          );
        })}
      </div>
    </div>
  );
}

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

function WorkspaceTab({ workspaceId }: { workspaceId?: string }) {
  if (!workspaceId) {
    return (
      <div>
        <h3 className={styles.sectionTitle}>Workspace</h3>
        <p className={styles.fieldLabel}>
          Self-host mode — single default workspace. Workspace management is
          available in managed (hosted) deployments.
        </p>
      </div>
    );
  }

  return (
    <div>
      <h3 className={styles.sectionTitle}>Workspace</h3>
      <div className={styles.fieldGroup}>
        <span className={styles.fieldLabel}>Current workspace</span>
        <span className={styles.fieldValue}>{workspaceId}</span>
      </div>
    </div>
  );
}
