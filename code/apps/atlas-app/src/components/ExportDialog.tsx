/**
 * ExportDialog — unified export surface for all formats.
 *
 * One dialog for every export format. Format selector cards at top,
 * format-specific settings below, export button in footer.
 *
 * The PDF pane owns the full PDF export (page size / orientation / title →
 * lib/print-pdf). Do not chain a second modal for it: one dialog asks for
 * each setting once.
 *
 * Design: drafting-room output panel — all formats visible at once, settings
 * appear for the selected format, single export action.
 *
 * Wording rule: say what the file contains. Every row here is a setting that
 * changes the file, or a plain statement of what the file is — never a label
 * the file contradicts ("vector" over a JPEG) or a row that cannot change.
 */

import { useState } from "react";

import {
  PNG_PIXEL_RATIOS,
  exportSize,
  type PngPixelRatio,
} from "../lib/export";
import {
  PRINT_DPI,
  exportPDF,
  printPixelRatio,
  scaleUnitsForLocale,
  type LayerLegendEntry,
  type Orientation,
  type PageSize,
  type PrintOptions,
  type PrintView,
} from "../lib/print-pdf";
import { safeFileName } from "../lib/safeFileName";

import { creditLine } from "../lib/tileLayers";

import { useDocument } from "../state/document";

import styles from "../styles/ExportDialog.module.css";

import { Modal } from "./Modal";

import type { GeoJsonExportOptions } from "../lib/dataLayerExport";

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
    hint: "Image of the map and drawings",
  },
  {
    id: "pdf",
    label: "PDF",
    icon: "#",
    hint: "Page with a map image, legend and scale",
  },
  {
    id: "geojson",
    label: "GeoJSON",
    icon: "&",
    hint: "Drawn shapes, and data layers if you choose",
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
  /** Export a PNG of the view at `pixelRatio` output px per CSS px. */
  onExportPNG: (pixelRatio: PngPixelRatio) => void;
  onExportGeoJSON: (opts: GeoJsonExportOptions) => void;
  onExportAtlasdraw: () => void;
  /**
   * The live view's CSS size and ground resolution (`measureView`), or null
   * when the map is not ready. Sizes the PNG choices and the PDF layout.
   */
  getView: () => PrintView | null;
  /**
   * Returns the composited view (map + Excalidraw annotations) rendered at
   * `pixelRatio` and encoded as a `data:image/jpeg;base64,...` URL, or null
   * if the map isn't ready yet. Called at export time so the PDF shows the
   * current viewport, not the moment the dialog opened.
   */
  getMapImageDataUrl: (pixelRatio: number) => Promise<string | null>;
  /**
   * Document layers projected to legend shape, evaluated at export time so
   * the legend and the image answer the same viewport. A snapshot
   * taken when the dialog opened could disagree with the image if the camera
   * was still animating.
   */
  getLegendEntries: () => LayerLegendEntry[];
  /**
   * Screen rotation of geographic east, degrees, y-down — see
   * `PrintOptions.cameraRotationDeg`. A callback for the same reason the two
   * above are: it is read at export time, so a camera still settling cannot
   * leave the north arrow describing a viewport the image does not show.
   */
  getCameraRotationDeg?: () => number;
  /**
   * The active basemap's credit, printed on the PDF page. The credit of each
   * visible tile layer is added to it (lib/tileLayers#creditLine).
   */
  attribution?: string;
  /** Decides the PDF's scale-bar units. Default `navigator.language`. */
  locale?: string;
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
  getView,
  getMapImageDataUrl,
  getLegendEntries,
  getCameraRotationDeg,
  attribution,
  locale = navigator.language,
  initialFormat = "png",
  exportPDFImpl = exportPDF,
}: ExportDialogProps) {
  const [format, setFormat] = useState<ExportFormat>(initialFormat);

  // Read once on open: the dialog is modal, so the view cannot change under it.
  const [view] = useState(getView);
  const [pixelRatio, setPixelRatio] = useState<PngPixelRatio>(2);

  // PDF pane state.
  const [pageSize, setPageSize] = useState<PageSize>("letter");
  const [orientation, setOrientation] = useState<Orientation>("landscape");
  // Seeded from the document name, then editable — a one-off PDF title
  // shouldn't rename the map, so this stays local state and never writes
  // back to the store. The dialog mounts fresh on each open (ExportDialog is
  // conditionally rendered), so the seed re-reads the current name.
  const documentTitle = useDocument((s) => s.title);
  const overlays = useDocument((s) => s.overlays);
  const [title, setTitle] = useState(documentTitle);
  // Off by default: the GeoJSON file keeps what it held before the option
  // existed until the user asks for more.
  const [includeDataLayers, setIncludeDataLayers] = useState(false);
  const hasDataLayers = overlays.some((e) => e.kind === "data");
  const [exporting, setExporting] = useState(false);
  const [error, setError] = useState<string | null>(null);

  const handleExportPDF = async () => {
    if (exporting) {
      return;
    }
    setExporting(true);
    setError(null);
    try {
      // The view, legend and image are all read now, so they describe the
      // same viewport. The legend is read before the image because its length
      // sets the size of the map frame, and the image is rendered for that
      // frame at PRINT_DPI.
      const printView = getView();
      if (!printView) {
        setError("The map is not ready. Try again in a moment.");
        return;
      }
      const layers = getLegendEntries();
      const page = { pageSize, orientation };
      // Compositing is async and can fail (no 2D context, image too large),
      // so it runs inside the try with the export itself.
      const mapImageDataUrl = await getMapImageDataUrl(
        printPixelRatio(page, printView, layers.length),
      );
      if (!mapImageDataUrl) {
        setError("The map is not ready. Try again in a moment.");
        return;
      }
      const blob = await exportPDFImpl({
        ...page,
        title: title.trim() || documentTitle,
        mapImageDataUrl,
        view: printView,
        layers,
        attribution: creditLine(attribution, overlays),
        units: scaleUnitsForLocale(locale),
        cameraRotationDeg: getCameraRotationDeg?.() ?? 0,
      });
      const safeName = `${safeFileName(title.trim() || documentTitle)}.pdf`;
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
        onExportPNG(pixelRatio);
        onCloseRequest();
        break;
      case "pdf":
        // Async, owns its own close-on-success (stays open to show errors).
        void handleExportPDF();
        break;
      case "geojson":
        onExportGeoJSON({
          includeDataLayers: hasDataLayers && includeDataLayers,
        });
        onCloseRequest();
        break;
      case "atlasdraw":
        onExportAtlasdraw();
        onCloseRequest();
        break;
    }
  };

  return (
    // Escape, a press outside and the × button close it (Modal).
    <Modal
      label="Export"
      onClose={onCloseRequest}
      scrimClassName={styles.scrim}
      scrimTestId="export-dialog-scrim"
      className={styles.dialog}
      testId="export-dialog"
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
              <label
                className={styles.settingLabel}
                htmlFor="export-png-pixel-ratio"
              >
                Size
              </label>
              <select
                id="export-png-pixel-ratio"
                className={styles.settingControl}
                value={pixelRatio}
                onChange={(e) =>
                  setPixelRatio(Number(e.target.value) as PngPixelRatio)
                }
                data-testid="export-png-pixel-ratio"
              >
                {PNG_PIXEL_RATIOS.map((ratio) => {
                  const px = view && exportSize(view, ratio);
                  return (
                    <option key={ratio} value={ratio}>
                      {px
                        ? `${ratio}× — ${px.width} × ${px.height} px`
                        : `${ratio}×`}
                    </option>
                  );
                })}
              </select>
            </div>
            <div className={styles.settingRow}>
              <span className={styles.settingHint}>
                The map and the drawings are drawn again at this size. They are
                not enlarged from the screen.
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
                onChange={(e) => setOrientation(e.target.value as Orientation)}
                data-testid="export-pdf-orientation"
              >
                <option value="portrait">Portrait</option>
                <option value="landscape">Landscape</option>
              </select>
            </div>
            <div className={styles.settingRow}>
              <label className={styles.settingLabel} htmlFor="export-pdf-title">
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
            <div className={styles.settingRow}>
              <span
                className={styles.settingHint}
                data-testid="export-pdf-note"
              >
                The map is an image at {PRINT_DPI} dpi, not vector shapes. The
                page also has a legend, a scale bar, a north arrow and the
                basemap credit.
              </span>
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
                Drawn shapes that are fixed to the map
              </span>
            </div>
            {hasDataLayers && (
              <>
                <div className={styles.settingRow}>
                  <label
                    className={styles.settingLabel}
                    htmlFor="export-geojson-include-data"
                  >
                    Include imported data layers
                  </label>
                  <input
                    id="export-geojson-include-data"
                    type="checkbox"
                    checked={includeDataLayers}
                    onChange={(e) => setIncludeDataLayers(e.target.checked)}
                    data-testid="export-geojson-include-data"
                  />
                </div>
                <div className={styles.settingRow}>
                  <span className={styles.settingHint}>
                    Adds all features of all data layers, also hidden layers.
                    Each feature keeps its properties and gets a "layer"
                    property with the layer name. Raster and tile layers are not
                    vector data and are not included.
                  </span>
                </div>
              </>
            )}
          </>
        )}
        {format === "atlasdraw" && (
          <>
            <div className={styles.settingRow}>
              <span className={styles.settingLabel}>Bundle</span>
              <span className={styles.settingHint}>
                Complete map document — drawing, data layers, and basemap style
                in one portable file
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
    </Modal>
  );
}
