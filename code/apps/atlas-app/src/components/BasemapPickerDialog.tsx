// SPDX-License-Identifier: AGPL-3.0-only
// BasemapPickerDialog — Phase 4 T6 replacement for the canvas background picker.
//
// Wired into the MainMenu slot previously occupied by
// MainMenu.DefaultItems.ChangeCanvasBackground. A simple modal overlay
// (not Excalidraw's Dialog) so it works outside the Excalidraw provider
// tree and is fully testable in jsdom.

import React, { useEffect, useRef } from "react";
import { BASEMAPS, getBasemap } from "@atlasdraw/basemap";

import { FocusTrap } from "./FocusTrap";

import type { BasemapConfig } from "@atlasdraw/basemap";

export interface BasemapPickerDialogProps {
  activeId: BasemapConfig["id"];
  onSelect: (id: BasemapConfig["id"]) => void;
  onCloseRequest: () => void;
}

export const BasemapPickerDialog: React.FC<BasemapPickerDialogProps> = ({
  activeId,
  onSelect,
  onCloseRequest,
}) => {
  const active = getBasemap(activeId);
  const panelRef = useRef<HTMLDivElement>(null);

  // Focus trap + Escape to close.
  useEffect(() => {
    const panel = panelRef.current;
    if (!panel) {
      return;
    }

    // Auto-focus the first button.
    const firstBtn = panel.querySelector<HTMLButtonElement>("button");
    firstBtn?.focus();

    const handleKeyDown = (e: KeyboardEvent) => {
      if (e.key === "Escape") {
        onCloseRequest();
      }
      if (e.key === "Tab") {
        const buttons = Array.from(
          panel.querySelectorAll<HTMLButtonElement>("button"),
        );
        if (buttons.length === 0) {
          return;
        }
        const first = buttons[0];
        const last = buttons[buttons.length - 1];
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

  // Click outside to close.
  useEffect(() => {
    const handleClick = (e: MouseEvent) => {
      if (panelRef.current && !panelRef.current.contains(e.target as Node)) {
        onCloseRequest();
      }
    };
    // Defer so the click that opened the dialog doesn't immediately close it.
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
      data-testid="basemap-picker-overlay"
    >
      <FocusTrap>
        <div
          ref={panelRef}
          role="dialog"
          aria-modal="true"
          aria-label="Basemap picker"
          style={{
            background: "var(--color-surface, #fff)",
            borderRadius: "0.5rem",
            padding: "1rem",
            minWidth: "280px",
            boxShadow: "0 4px 20px rgba(0,0,0,0.15)",
          }}
        >
          <h3
            style={{
              margin: "0 0 0.75rem 0",
              fontSize: "1rem",
              fontWeight: 600,
            }}
          >
            Basemap
          </h3>
          <div
            style={{
              display: "grid",
              gridTemplateColumns: "repeat(3, 1fr)",
              gap: "0.75rem",
            }}
          >
            {BASEMAPS.map((b) => {
              const isActive = b.id === activeId;
              return (
                <button
                  key={b.id}
                  type="button"
                  data-testid={`basemap-option-${b.id}`}
                  aria-pressed={isActive}
                  onClick={() => {
                    onSelect(b.id);
                    onCloseRequest();
                  }}
                  style={{
                    display: "flex",
                    flexDirection: "column",
                    alignItems: "center",
                    gap: "0.5rem",
                    padding: "0.75rem",
                    borderRadius: "0.5rem",
                    border: isActive
                      ? "2px solid var(--ad-accent, #0aa)"
                      : "1px solid var(--ad-rule, #ddd)",
                    background: isActive
                      ? "var(--ad-accent-subtle, #e6f7ff)"
                      : "var(--ad-surface-raised, #fff)",
                    cursor: "pointer",
                    fontSize: "0.875rem",
                    color: "var(--ad-ink, #333)",
                  }}
                >
                  <div
                    style={{
                      width: "3rem",
                      height: "3rem",
                      borderRadius: "0.25rem",
                      background:
                        b.id === "protomaps-dark"
                          ? "var(--ad-ink, #1a1a1a)"
                          : b.id === "openfreemap-bright"
                          ? "#f0f0f0"
                          : "var(--ad-surface-raised, #ffffff)",
                      border: "1px solid var(--ad-rule, #ddd)",
                    }}
                  />
                  <span style={{ fontWeight: isActive ? 600 : 400 }}>
                    {b.label}
                  </span>
                  <span
                    data-testid={`basemap-source-${b.id}`}
                    style={{
                      fontSize: "0.6875rem",
                      fontWeight: 400,
                      color: b.requiresRemote ? "#92400e" : "#1e3a8a",
                      background: b.requiresRemote ? "#fef3c7" : "#dbeafe",
                      padding: "1px 6px",
                      borderRadius: "3px",
                    }}
                  >
                    {b.requiresRemote ? "Remote" : "Local"}
                  </span>
                </button>
              );
            })}
          </div>
          <div
            style={{
              marginTop: "0.75rem",
              fontSize: "0.75rem",
              color: "var(--ad-ink-tertiary, #666)",
              textAlign: "center",
            }}
          >
            {active?.requiresRemote
              ? "This basemap loads tiles from the internet."
              : "This basemap uses offline PMTiles — no network required."}
          </div>
        </div>
      </FocusTrap>
    </div>
  );
};
