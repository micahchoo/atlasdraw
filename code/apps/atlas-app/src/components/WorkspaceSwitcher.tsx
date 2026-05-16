// SPDX-License-Identifier: AGPL-3.0-only
// Phase 6 A13a — WorkspaceSwitcher.
//
// Top-right toolbar dropdown that lets a managed-mode user switch between
// their workspaces. Self-host (`getAppConfig().managed === false`) renders
// `null` — the FOSS edition has no multi-tenant surface; ADR-0011.
//
// Wiring:
//   - `activeId`     — currently-selected workspace id (`null` while loading
//                      or in single-workspace self-host fallbacks).
//   - `onSelect`     — invoked with the new id when the user picks one.
//                      Parent (MapEditor) owns the source-of-truth `useState`
//                      and threads the resolved id into `createHttpStorageClient`'s
//                      `getWorkspaceId` callback.
//   - `client`       — HttpStorageClient. `listWorkspaces()` is called on
//                      mount; result is held in local state.
//
// We do NOT touch the WorkspaceContext shape (constraint: read-only consumer
// for this wave). A9's branded type is the runtime identifier; this surface
// returns plain strings to keep the prop interface simple — the parent casts
// via `asWorkspaceId` when threading.
//
// Inline-style approach matches BasemapPickerDialog / MaputnikDialog so the
// switcher is testable in jsdom without depending on CSS-module pipeline.

import React, { useEffect, useRef, useState } from "react";
import { getAppConfig } from "../config/app-config";
import type {
  HttpStorageClient,
  WorkspaceSummary,
} from "../services/createHttpStorageClient";

export interface WorkspaceSwitcherProps {
  /**
   * HttpStorageClient. Only `listWorkspaces()` is consumed here; the rest
   * of the surface is passed through for typing convenience.
   */
  client: HttpStorageClient;
  /**
   * Currently-active workspace id (the same string surfaced by the A9
   * resolver). `null` while loading or when the list is empty.
   */
  activeId: string | null;
  /**
   * Fired when the user picks a workspace. The parent updates its
   * `WorkspaceContext` source-of-truth; this component does not mutate
   * context directly (constraint: A9's shape is read-only here).
   */
  onSelect: (id: string) => void;
  /**
   * Navigate-to-billing hook. Defaults to
   * `window.location.assign("/billing?workspaceId=<id>")` so the BillingPage
   * route can rehydrate the active workspace from the URL after the full-
   * page reload (App.tsx's hand-rolled router has no in-memory state).
   * Overrideable in tests so we can assert without a real navigation.
   */
  navigateToBilling?: (workspaceId: string) => void;
}

const PLAN_LABEL: Record<WorkspaceSummary["plan"], string> = {
  free: "Free",
  pro: "Pro",
};

const PLAN_BADGE_BG: Record<WorkspaceSummary["plan"], string> = {
  // Atlasdraw-ui-conventions §Color Tokens — reusing the existing data-layer
  // badge palette (blue-100 / blue-900) for "free" and amber-100 / amber-900
  // for "pro" to read as two distinct categories at a glance.
  free: "#dbeafe",
  pro: "#fef3c7",
};
const PLAN_BADGE_FG: Record<WorkspaceSummary["plan"], string> = {
  free: "#1e3a8a",
  pro: "#92400e",
};

export const WorkspaceSwitcher: React.FC<WorkspaceSwitcherProps> = ({
  client,
  activeId,
  onSelect,
  navigateToBilling,
}) => {
  const cfg = getAppConfig();
  const [open, setOpen] = useState(false);
  const [workspaces, setWorkspaces] = useState<WorkspaceSummary[]>([]);
  const [loadError, setLoadError] = useState<string | null>(null);
  const panelRef = useRef<HTMLDivElement>(null);

  // Self-host: render nothing. The hook order matters — call hooks before
  // bailing so React's call-order invariant holds across renders.
  useEffect(() => {
    if (!cfg.managed) return;
    let cancelled = false;
    client
      .listWorkspaces()
      .then((list) => {
        if (cancelled) return;
        setWorkspaces(list);
      })
      .catch((err: unknown) => {
        if (cancelled) return;
        setLoadError(err instanceof Error ? err.message : String(err));
      });
    return () => {
      cancelled = true;
    };
  }, [cfg.managed, client]);

  // Close on outside click — same defer-attach pattern as the dialogs so the
  // open-click doesn't immediately close us.
  useEffect(() => {
    if (!open) return;
    const handleClick = (e: MouseEvent) => {
      if (panelRef.current && !panelRef.current.contains(e.target as Node)) {
        setOpen(false);
      }
    };
    const id = setTimeout(() => {
      document.addEventListener("click", handleClick);
    }, 0);
    return () => {
      clearTimeout(id);
      document.removeEventListener("click", handleClick);
    };
  }, [open]);

  if (!cfg.managed) return null;

  const active =
    workspaces.find((w) => w.id === activeId) ?? workspaces[0] ?? null;

  const triggerLabel = active
    ? active.name
    : loadError
      ? "Workspaces unavailable"
      : "Loading workspaces…";

  const goBilling = (workspaceId: string) => {
    if (navigateToBilling) {
      navigateToBilling(workspaceId);
      return;
    }
    if (typeof window !== "undefined") {
      window.location.assign(
        `/billing?workspaceId=${encodeURIComponent(workspaceId)}`,
      );
    }
  };

  return (
    <div
      ref={panelRef}
      data-testid="workspace-switcher"
      style={{
        position: "absolute",
        top: 12,
        right: 12,
        zIndex: 10,
        fontFamily: "system-ui, sans-serif",
        fontSize: 14,
      }}
    >
      <button
        type="button"
        data-testid="workspace-switcher-trigger"
        aria-haspopup="listbox"
        aria-expanded={open}
        onClick={() => setOpen((v) => !v)}
        style={{
          padding: "6px 12px",
          border: "1px solid #adb5bd",
          borderRadius: 4,
          background: "#ffffff",
          color: "#212529",
          fontSize: 14,
          fontWeight: 600,
          cursor: "pointer",
          boxShadow: "0 1px 3px rgba(0, 0, 0, 0.12)",
          display: "inline-flex",
          alignItems: "center",
          gap: 8,
        }}
      >
        <span>{triggerLabel}</span>
        {active && (
          <span
            data-testid={`workspace-switcher-active-badge-${active.plan}`}
            style={{
              display: "inline-block",
              padding: "1px 6px",
              borderRadius: 3,
              background: PLAN_BADGE_BG[active.plan],
              color: PLAN_BADGE_FG[active.plan],
              fontSize: 11,
              fontWeight: 500,
            }}
          >
            {PLAN_LABEL[active.plan]}
          </span>
        )}
        <span aria-hidden="true" style={{ fontSize: 10, opacity: 0.6 }}>
          ▾
        </span>
      </button>

      {open && (
        <ul
          role="listbox"
          data-testid="workspace-switcher-list"
          style={{
            position: "absolute",
            top: "100%",
            right: 0,
            marginTop: 4,
            minWidth: 240,
            maxHeight: 320,
            overflowY: "auto",
            padding: 4,
            listStyle: "none",
            background: "#ffffff",
            border: "1px solid #ccc",
            borderRadius: 4,
            boxShadow: "0 4px 12px rgba(0, 0, 0, 0.12)",
            color: "#212529",
          }}
        >
          {loadError && (
            <li
              data-testid="workspace-switcher-error"
              style={{
                padding: "4px 8px",
                color: "#868e96",
                fontSize: 13,
              }}
            >
              {loadError}
            </li>
          )}
          {!loadError && workspaces.length === 0 && (
            <li
              data-testid="workspace-switcher-empty"
              style={{
                padding: "4px 8px",
                color: "#868e96",
                fontSize: 13,
              }}
            >
              No workspaces.
            </li>
          )}
          {workspaces.map((ws) => {
            const isActive = ws.id === (active?.id ?? null);
            return (
              <li key={ws.id} role="option" aria-selected={isActive}>
                <button
                  type="button"
                  data-testid={`workspace-switcher-option-${ws.id}`}
                  onClick={() => {
                    onSelect(ws.id);
                    setOpen(false);
                  }}
                  style={{
                    display: "flex",
                    alignItems: "center",
                    justifyContent: "space-between",
                    gap: 8,
                    width: "100%",
                    padding: "6px 8px",
                    border: "none",
                    background: isActive ? "#f8f9fa" : "transparent",
                    color: "#212529",
                    fontSize: 13,
                    textAlign: "left",
                    cursor: "pointer",
                    borderRadius: 3,
                  }}
                >
                  <span style={{ display: "flex", flexDirection: "column" }}>
                    <span style={{ fontWeight: isActive ? 600 : 400 }}>
                      {ws.name}
                    </span>
                    {ws.plan === "free" && (
                      <a
                        href={`/billing?workspaceId=${encodeURIComponent(ws.id)}`}
                        data-testid={`workspace-switcher-upgrade-${ws.id}`}
                        onClick={(e) => {
                          // Use the navigate hook so tests can intercept.
                          e.preventDefault();
                          e.stopPropagation();
                          setOpen(false);
                          goBilling(ws.id);
                        }}
                        style={{
                          fontSize: 11,
                          color: "#1971c2",
                          textDecoration: "underline",
                        }}
                      >
                        Upgrade
                      </a>
                    )}
                  </span>
                  <span
                    data-testid={`workspace-switcher-option-badge-${ws.id}`}
                    style={{
                      display: "inline-block",
                      padding: "1px 6px",
                      borderRadius: 3,
                      background: PLAN_BADGE_BG[ws.plan],
                      color: PLAN_BADGE_FG[ws.plan],
                      fontSize: 11,
                      fontWeight: 500,
                    }}
                  >
                    {PLAN_LABEL[ws.plan]}
                  </span>
                </button>
              </li>
            );
          })}
        </ul>
      )}
    </div>
  );
};
