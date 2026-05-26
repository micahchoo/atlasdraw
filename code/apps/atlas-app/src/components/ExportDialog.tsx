/**
 * ExportDialog — unified export surface for all formats.
 *
 * Single dialog replacing 4 separate export paths (PNG menu item, PrintDialog,
 * GeoJSON menu item, renderCustomUI .atlasdraw cards). Format selector cards
 * at top, format-specific settings below, export button in footer.
 *
 * Design: drafting-room output panel — all formats visible at once, settings
 * appear for the selected format, single export action.
 */

import React, { useState } from "react";

import styles from "../styles/ExportDialog.module.css";

import { FocusTrap } from "./FocusTrap";

// ---------------------------------------------------------------------------
// Types
// ---------------------------------------------------------------------------

type ExportFormat = "png" | "pdf" | "geojson" | "atlasdraw";

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

// ---------------------------------------------------------------------------
// Props
// ---------------------------------------------------------------------------

interface ExportDialogProps {
  onCloseRequest: () => void;
  onExportPNG: () => void;
  onExportPDF: () => void;
  onExportGeoJSON: () => void;
  onExportAtlasdraw: () => void;
}

// ---------------------------------------------------------------------------

export function ExportDialog({
  onCloseRequest,
  onExportPNG,
  onExportPDF,
  onExportGeoJSON,
  onExportAtlasdraw,
}: ExportDialogProps) {
  const [format, setFormat] = useState<ExportFormat>("png");

  const handleExport = () => {
    switch (format) {
      case "png":
        onExportPNG();
        break;
      case "pdf":
        onExportPDF();
        break;
      case "geojson":
        onExportGeoJSON();
        break;
      case "atlasdraw":
        onExportAtlasdraw();
        break;
    }
    onCloseRequest();
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
                  <span className={styles.settingLabel}>Page size</span>
                  <select className={styles.settingControl} defaultValue="a4">
                    <option value="a4">A4</option>
                    <option value="letter">Letter</option>
                    <option value="a3">A3</option>
                  </select>
                </div>
                <div className={styles.settingRow}>
                  <span className={styles.settingLabel}>Orientation</span>
                  <select
                    className={styles.settingControl}
                    defaultValue="landscape"
                  >
                    <option value="portrait">Portrait</option>
                    <option value="landscape">Landscape</option>
                  </select>
                </div>
                <div className={styles.settingRow}>
                  <span className={styles.settingLabel}>Include legend</span>
                  <input type="checkbox" defaultChecked />
                </div>
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
                    scene.json + data/*.geojson + style.json + manifest.json
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
              data-testid="export-dialog-export"
            >
              Export {FORMATS.find((f) => f.id === format)?.label}
            </button>
          </div>
        </div>
      </div>
    </FocusTrap>
  );
}
