// SPDX-License-Identifier: AGPL-3.0-only
// Phase 6 A10 — PrintDialog (PDF export).
//
// Modal mirroring BasemapPickerDialog / MaputnikDialog: overlay scrim,
// Escape + click-outside to close, focus trap on Tab, role="dialog" with
// aria-modal. The dialog owns the form fields (page size, orientation,
// title) and is wired to a caller-provided `getMapCanvas` callback so it
// never reaches into useMapRef directly — the live MapLibre canvas only
// lives inside MapEditor's render tree.
//
// Style conventions: follows atlasdraw-ui-conventions (slot-first dialog,
// inline styles only for runtime values, fixed-position overlay, ARIA on
// all interactive elements, data-testid on every actionable element).
//
// Plan: §A10 in 2026-05-15-atlasdraw-phase-6-amended-scope.md.

import React, { useCallback, useEffect, useId, useRef, useState } from "react";

import {
  exportPDF,
  type LayerLegendEntry,
  type Orientation,
  type PageSize,
  type PrintOptions,
} from "../lib/print-pdf";

import { FocusTrap } from "./FocusTrap";

export interface PrintDialogProps {
  /**
   * Returns the live MapLibre canvas, or null if the map isn't ready yet.
   * Called at submit time so the snapshot reflects the current viewport,
   * not the moment the dialog opened.
   */
  getMapCanvas: () => HTMLCanvasElement | null;
  /** Snapshot of registry entries projected to legend shape (caller-mapped). */
  layers: LayerLegendEntry[];
  onCloseRequest: () => void;
  /**
   * Test seam: lets tests swap in a mock exportPDF without intercepting
   * the module import. Defaults to the real `exportPDF`.
   */
  exportPDFImpl?: (opts: PrintOptions) => Promise<Blob>;
}

const PAGE_SIZE_OPTIONS: { value: PageSize; label: string }[] = [
  { value: "letter", label: "Letter (8.5×11 in)" },
  { value: "a4", label: "A4 (210×297 mm)" },
  { value: "tabloid", label: "Tabloid (11×17 in)" },
];

export const PrintDialog: React.FC<PrintDialogProps> = ({
  getMapCanvas,
  layers,
  onCloseRequest,
  exportPDFImpl = exportPDF,
}) => {
  const panelRef = useRef<HTMLDivElement>(null);
  const submitBtnRef = useRef<HTMLButtonElement>(null);
  const formId = useId();

  const [pageSize, setPageSize] = useState<PageSize>("letter");
  const [orientation, setOrientation] = useState<Orientation>("landscape");
  const [title, setTitle] = useState("Untitled map");
  const [exporting, setExporting] = useState(false);
  const [error, setError] = useState<string | null>(null);

  // Focus trap + Escape (mirrors MaputnikDialog).
  useEffect(() => {
    const panel = panelRef.current;
    if (!panel) {
      return;
    }
    submitBtnRef.current?.focus();

    const handleKeyDown = (e: KeyboardEvent) => {
      if (e.key === "Escape") {
        onCloseRequest();
        return;
      }
      if (e.key === "Tab") {
        const focusables = Array.from(
          panel.querySelectorAll<HTMLElement>(
            'button, input, select, textarea, [tabindex]:not([tabindex="-1"])',
          ),
        ).filter((el) => !el.hasAttribute("disabled"));
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

  // Click-outside to close. Deferred so the click that opened the dialog
  // doesn't immediately dismiss it.
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

  const handleSubmit = useCallback(
    async (e: React.FormEvent) => {
      e.preventDefault();
      if (exporting) {
        return;
      }
      const canvas = getMapCanvas();
      if (!canvas) {
        setError("Map is not ready yet — try again in a moment.");
        return;
      }
      setExporting(true);
      setError(null);
      try {
        const blob = await exportPDFImpl({
          pageSize,
          orientation,
          title: title.trim() || "Untitled map",
          mapCanvas: canvas,
          layers,
        });
        const safeName = `${(title.trim() || "Untitled map").replace(
          /[^\w\- ]+/g,
          "_",
        )}.pdf`;
        const url = URL.createObjectURL(blob);
        try {
          const a = document.createElement("a");
          a.href = url;
          a.download = safeName;
          a.click();
        } finally {
          URL.revokeObjectURL(url);
        }
        onCloseRequest();
      } catch (err) {
        setError(err instanceof Error ? err.message : String(err));
      } finally {
        setExporting(false);
      }
    },
    [
      exporting,
      getMapCanvas,
      exportPDFImpl,
      pageSize,
      orientation,
      title,
      layers,
      onCloseRequest,
    ],
  );

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
      data-testid="print-dialog-overlay"
    >
      <FocusTrap>
        <div
          ref={panelRef}
          role="dialog"
          aria-modal="true"
          aria-label="Export PDF"
          style={{
            background: "var(--color-surface, #fff)",
            borderRadius: "0.5rem",
            padding: "1rem",
            minWidth: 360,
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
            Export PDF
          </h3>

          <form id={formId} onSubmit={handleSubmit}>
            {/* Page size */}
            <fieldset
              style={{
                border: "1px solid #ddd",
                borderRadius: "0.25rem",
                padding: "0.5rem 0.75rem",
                margin: "0 0 0.75rem 0",
              }}
              data-testid="print-dialog-page-size"
            >
              <legend
                style={{
                  fontSize: "0.75rem",
                  color: "var(--ad-ink-secondary, #555)",
                }}
              >
                Page size
              </legend>
              {PAGE_SIZE_OPTIONS.map((opt) => (
                <label
                  key={opt.value}
                  style={{
                    display: "flex",
                    alignItems: "center",
                    gap: 6,
                    fontSize: "0.8125rem",
                    cursor: "pointer",
                    padding: "2px 0",
                  }}
                >
                  <input
                    type="radio"
                    name="pageSize"
                    value={opt.value}
                    checked={pageSize === opt.value}
                    onChange={() => setPageSize(opt.value)}
                    data-testid={`print-dialog-page-size-${opt.value}`}
                  />
                  {opt.label}
                </label>
              ))}
            </fieldset>

            {/* Orientation */}
            <fieldset
              style={{
                border: "1px solid #ddd",
                borderRadius: "0.25rem",
                padding: "0.5rem 0.75rem",
                margin: "0 0 0.75rem 0",
              }}
              data-testid="print-dialog-orientation"
            >
              <legend
                style={{
                  fontSize: "0.75rem",
                  color: "var(--ad-ink-secondary, #555)",
                }}
              >
                Orientation
              </legend>
              <div style={{ display: "flex", gap: 12 }}>
                {(["portrait", "landscape"] as const).map((o) => (
                  <label
                    key={o}
                    style={{
                      display: "flex",
                      alignItems: "center",
                      gap: 4,
                      fontSize: "0.8125rem",
                      cursor: "pointer",
                    }}
                  >
                    <input
                      type="radio"
                      name="orientation"
                      value={o}
                      checked={orientation === o}
                      onChange={() => setOrientation(o)}
                      data-testid={`print-dialog-orientation-${o}`}
                    />
                    {o === "portrait" ? "Portrait" : "Landscape"}
                  </label>
                ))}
              </div>
            </fieldset>

            {/* Title */}
            <label
              style={{
                display: "block",
                fontSize: "0.75rem",
                color: "#555",
                margin: "0 0 0.25rem 0",
              }}
              htmlFor={`${formId}-title`}
            >
              Title
            </label>
            <input
              id={`${formId}-title`}
              type="text"
              value={title}
              onChange={(e) => setTitle(e.target.value)}
              data-testid="print-dialog-title-input"
              style={{
                width: "100%",
                padding: "6px 8px",
                border: "1px solid #adb5bd",
                borderRadius: 4,
                fontSize: "0.875rem",
                boxSizing: "border-box",
                marginBottom: "0.75rem",
              }}
            />

            {error && (
              <div
                role="alert"
                data-testid="print-dialog-error"
                style={{
                  color: "#c92a2a",
                  fontSize: "0.8125rem",
                  margin: "0 0 0.5rem 0",
                }}
              >
                {error}
              </div>
            )}

            <div
              style={{
                display: "flex",
                justifyContent: "flex-end",
                gap: 8,
                marginTop: "0.5rem",
              }}
            >
              <button
                type="button"
                onClick={onCloseRequest}
                data-testid="print-dialog-cancel"
                style={{
                  padding: "6px 12px",
                  border: "1px solid #adb5bd",
                  borderRadius: 4,
                  background: "var(--ad-surface-raised, #fff)",
                  color: "var(--ad-ink, #212529)",
                  fontSize: 14,
                  cursor: "pointer",
                }}
              >
                Cancel
              </button>
              <button
                ref={submitBtnRef}
                type="submit"
                disabled={exporting}
                aria-disabled={exporting}
                data-testid="print-dialog-submit"
                style={{
                  padding: "6px 12px",
                  border: "1px solid var(--ad-accent, #1971c2)",
                  borderRadius: 4,
                  background: exporting
                    ? "#74c0fc"
                    : "var(--ad-accent, #1971c2)",
                  color: "var(--ad-ink-inverse, #ffffff)",
                  fontSize: 14,
                  fontWeight: 600,
                  cursor: exporting ? "wait" : "pointer",
                }}
              >
                {exporting ? "Exporting…" : "Export PDF"}
              </button>
            </div>
          </form>
        </div>
      </FocusTrap>
    </div>
  );
};
