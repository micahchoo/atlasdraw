/**
 * ExportDialog — unified export surface for all formats.
 *
 * Single dialog replacing 4 separate export paths (PNG menu item, PrintDialog,
 * GeoJSON menu item, renderCustomUI .atlasdraw cards). Format selector cards
 * at top, format-specific settings below, export button in footer.
 *
 * The PDF pane owns the full PDF export (page size / orientation / title →
 * lib/print-pdf) — absorbed from the former PrintDialog, which used to open
 * as a SECOND modal chained behind this one and asked for the same settings
 * this dialog displayed as unwired placeholders (IA restructure, 2026-07-18).
 *
 * Design: drafting-room output panel — all formats visible at once, settings
 * appear for the selected format, single export action.
 */

import React, { useEffect, useState } from "react";

import {
  exportPDF,
  type LayerLegendEntry,
  type Orientation,
  type PageSize,
  type PrintOptions,
} from "../lib/print-pdf";

import styles from "../styles/ExportDialog.module.css";

import { FocusTrap } from "./FocusTrap";

// ---------------------------------------------------------------------------
// Types
// ---------------------------------------------------------------------------

export type ExportFormat = "png" | "pdf" | "geojson" | "atlasdraw";

interface FormatDef {
  id: ExportFormat;
  label: string;
  icon: string;
  hint: string;
}

const FORMATS: FormatDef[] = [
  {
    id: "png",
    label: "PNG",
    icon: "@",
    hint: "Composite raster image with basemap",
  },
  {
    id: "pdf",
    label: "PDF",
    icon: "#",
    hint: "Print-optimized vector document",
  },
  {
    id: "geojson",
    label: "GeoJSON",
    icon: "&",
    hint: "Geo-anchored annotations only",
  },
  {
    id: "atlasdraw",
    label: ".atlasdraw",
    icon: "%",
    hint: "Full project — JSON + data layers",
  },
];

const PAGE_SIZE_OPTIONS: { value: PageSize; label: string }[] = [
  { value: "letter", label: "Letter (8.5×11 in)" },
  { value: "a4", label: "A4 (210×297 mm)" },
  { value: "tabloid", label: "Tabloid (11×17 in)" },
];

// ---------------------------------------------------------------------------
// Props
// ---------------------------------------------------------------------------

interface ExportDialogProps {
  onCloseRequest: () => void;
  onExportPNG: () => void;
  onExportGeoJSON: () => void;
  onExportAtlasdraw: () => void;
  /**
   * Returns the live MapLibre canvas, or null if the map isn't ready yet.
   * Called at export time so the PDF snapshot reflects the current viewport,
   * not the moment the dialog opened.
   */
  getMapCanvas: () => HTMLCanvasElement | null;
  /** Snapshot of registry entries projected to legend shape (caller-mapped). */
  layers: LayerLegendEntry[];
  /** Preselected format card (e.g. quick-actions "Export PDF"). */
  initialFormat?: ExportFormat;
  /**
   * Test seam: lets tests swap in a mock exportPDF without intercepting
   * the module import. Defaults to the real `exportPDF`.
   */
  exportPDFImpl?: (opts: PrintOptions) => Promise<Blob>;
}

// ---------------------------------------------------------------------------

export function ExportDialog({
  onCloseRequest,
  onExportPNG,
  onExportGeoJSON,
  onExportAtlasdraw,
  getMapCanvas,
  layers,
  initialFormat = "png",
  exportPDFImpl = exportPDF,
}: ExportDialogProps) {
  const [format, setFormat] = useState<ExportFormat>(initialFormat);

  // Escape to close (FocusTrap deliberately leaves Escape to each modal).
  // Carried over from the absorbed PrintDialog; the pre-merge ExportDialog
  // only closed via scrim click / × button.
  useEffect(() => {
    const handleKeyDown = (e: KeyboardEvent) => {
      if (e.key === "Escape") {
        onCloseRequest();
      }
    };
    document.addEventListener("keydown", handleKeyDown);
    return () => document.removeEventListener("keydown", handleKeyDown);
  }, [onCloseRequest]);

  // PDF pane state (absorbed from PrintDialog).
  const [pageSize, setPageSize] = useState<PageSize>("letter");
  const [orientation, setOrientation] = useState<Orientation>("landscape");
  const [title, setTitle] = useState("Untitled map");
  const [exporting, setExporting] = useState(false);
  const [error, setError] = useState<string | null>(null);

  const handleExportPDF = async () => {
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
  };

  const handleExport = () => {
    switch (format) {
      case "png":
        onExportPNG();
        onCloseRequest();
        break;
      case "pdf":
        // Async, owns its own close-on-success (stays open to show errors).
        void handleExportPDF();
        break;
      case "geojson":
        onExportGeoJSON();
        onCloseRequest();
        break;
      case "atlasdraw":
        onExportAtlasdraw();
        onCloseRequest();
        break;
    }
  };

  return (
    <FocusTrap>
      <div
        className={styles.scrim}
        onClick={(e) => {
          if (e.target === e.currentTarget) {
            onCloseRequest();
          }
        }}
        data-testid="export-dialog-scrim"
      >
        <div
          className={styles.dialog}
          role="dialog"
          aria-label="Export"
          data-testid="export-dialog"
        >
          {/* Header */}
          <div className={styles.header}>
            <span className={styles.title}>Export</span>
            <button
              type="button"
              className={styles.closeBtn}
              onClick={onCloseRequest}
              aria-label="Close"
              data-testid="export-dialog-close"
            >
              ×
            </button>
          </div>

          {/* Format cards */}
          <div className={styles.formatRow}>
            {FORMATS.map((f) => (
              <div
                key={f.id}
                className={[
                  styles.formatCard,
                  format === f.id ? styles.formatCardActive : "",
                ]
                  .filter(Boolean)
                  .join(" ")}
                onClick={() => setFormat(f.id)}
                data-testid={`export-format-${f.id}`}
              >
                <span className={styles.formatIcon}>{f.icon}</span>
                <span className={styles.formatLabel}>{f.label}</span>
                <span className={styles.formatHint}>{f.hint}</span>
              </div>
            ))}
          </div>

          {/* Format-specific settings */}
          <div className={styles.settings}>
            {format === "png" && (
              <>
                <div className={styles.settingRow}>
                  <span className={styles.settingLabel}>Include basemap</span>
                  <span className={styles.settingHint}>
                    Always — composite render
                  </span>
                </div>
                <div className={styles.settingRow}>
                  <span className={styles.settingLabel}>Resolution</span>
                  <span className={styles.settingHint}>
                    Current viewport (match screen)
                  </span>
                </div>
              </>
            )}
            {format === "pdf" && (
              <>
                <div className={styles.settingRow}>
                  <label
                    className={styles.settingLabel}
                    htmlFor="export-pdf-page-size"
                  >
                    Page size
                  </label>
                  <select
                    id="export-pdf-page-size"
                    className={styles.settingControl}
                    value={pageSize}
                    onChange={(e) => setPageSize(e.target.value as PageSize)}
                    data-testid="export-pdf-page-size"
                  >
                    {PAGE_SIZE_OPTIONS.map((opt) => (
                      <option key={opt.value} value={opt.value}>
                        {opt.label}
                      </option>
                    ))}
                  </select>
                </div>
                <div className={styles.settingRow}>
                  <label
                    className={styles.settingLabel}
                    htmlFor="export-pdf-orientation"
                  >
                    Orientation
                  </label>
                  <select
                    id="export-pdf-orientation"
                    className={styles.settingControl}
                    value={orientation}
                    onChange={(e) =>
                      setOrientation(e.target.value as Orientation)
                    }
                    data-testid="export-pdf-orientation"
                  >
                    <option value="portrait">Portrait</option>
                    <option value="landscape">Landscape</option>
                  </select>
                </div>
                <div className={styles.settingRow}>
                  <label
                    className={styles.settingLabel}
                    htmlFor="export-pdf-title"
                  >
                    Title
                  </label>
                  <input
                    id="export-pdf-title"
                    type="text"
                    className={styles.settingInput}
                    value={title}
                    onChange={(e) => setTitle(e.target.value)}
                    data-testid="export-pdf-title-input"
                  />
                </div>
                {error && (
                  <div
                    role="alert"
                    className={styles.errorText}
                    data-testid="export-pdf-error"
                  >
                    {error}
                  </div>
                )}
              </>
            )}
            {format === "geojson" && (
              <>
                <div className={styles.settingRow}>
                  <span className={styles.settingLabel}>Content</span>
                  <span className={styles.settingHint}>
                    Geo-anchored annotations only (data layers excluded)
                  </span>
                </div>
              </>
            )}
            {format === "atlasdraw" && (
              <>
                <div className={styles.settingRow}>
                  <span className={styles.settingLabel}>Bundle</span>
                  <span className={styles.settingHint}>
                    Complete map document — drawing, data layers, and basemap
                    style in one portable file
                  </span>
                </div>
              </>
            )}
          </div>

          {/* Footer */}
          <div className={styles.footer}>
            <button
              type="button"
              className={styles.cancelBtn}
              onClick={onCloseRequest}
              data-testid="export-dialog-cancel"
            >
              Cancel
            </button>
            <button
              type="button"
              className={styles.exportBtn}
              onClick={handleExport}
              disabled={exporting}
              aria-disabled={exporting}
              data-testid="export-dialog-export"
            >
              {exporting
                ? "Exporting…"
                : `Export ${FORMATS.find((f) => f.id === format)?.label}`}
            </button>
          </div>
        </div>
      </div>
    </FocusTrap>
  );
}
