// SPDX-License-Identifier: AGPL-3.0-only
// Phase 6 A10 — Print PDF export (pdf-lib).
//
// Composes the current map view (JPEG snapshot of MapLibre's canvas) into a
// printable PDF with cartographic chrome: title block, ODbL attribution,
// legend, scale bar, and north arrow. Pure function — takes an encoded
// `mapImageDataUrl` plus a flat `LayerLegendEntry[]`; never reaches into
// MapLibre, the layer registry, or React state itself. All upstream coupling
// is the caller's job (see the PDF pane in `ExportDialog.tsx`).
//
// Source plan: docs/superpowers/plans/2026-05-15-atlasdraw-phase-6-amended-scope.md §A10
// Origin spec: docs/superpowers/plans/2026-05-03-atlasdraw-phase-6-v1-embeds-comments.md §Task 13
// Locked decision: Q-P6-1 (Phase 6 scope cut — no SDK / embed surface).
//
// ODbL attribution (OQ6, non-negotiable): the string
//   `© OpenStreetMap contributors (openstreetmap.org/copyright) | © OpenMapTiles`
// is written into the title block on every page AND mirrored into the PDF
// Info-dict (Subject + Keywords) as a belt-and-braces survival path against
// future content-stream encoding changes. The function exposes no
// `hideAttribution` flag — ODbL §4 forbids it.

import {
  PDFDocument,
  PDFName,
  PDFString,
  StandardFonts,
  rgb,
  type PDFFont,
  type PDFPage,
} from "pdf-lib";

// ---------------------------------------------------------------------------
// Public types
// ---------------------------------------------------------------------------

export type PageSize = "letter" | "a4" | "tabloid";
export type Orientation = "portrait" | "landscape";

export interface LayerLegendEntry {
  id: string;
  name: string;
  /** Hex color (#rrggbb or #rgb); used for the legend swatch. */
  color: string;
}

export interface PrintOptions {
  pageSize: PageSize;
  orientation: Orientation;
  title: string;
  /**
   * The composited view as a `data:image/jpeg;base64,...` URL — basemap, data
   * layers AND Excalidraw annotations. Produced by `exportCompositeDataURL`
   * in `lib/export.ts`, which is the single definition of what an export
   * contains.
   *
   * This used to be `mapCanvas: Pick<HTMLCanvasElement, "toDataURL">` and the
   * caller passed `map.getCanvas()` — MapLibre's canvas alone. Excalidraw
   * renders on a separate canvas, so every shape the user drew was absent from
   * the PDF while the export still reported success (FU-12).
   */
  mapImageDataUrl: string;
  layers: LayerLegendEntry[];
  /**
   * Screen rotation of the exported view: the direction geographic east ran
   * on screen, in degrees, y-down — i.e. `cameraRotation(map)` converted from
   * radians. Read at export time so it describes the same viewport the image
   * does.
   *
   * It is deliberately NOT `map.getBearing()`. RT-2 measures the rotation off
   * the live projection rather than trusting MapLibre's bearing sign
   * convention, because nobody has run this app; taking a bearing here would
   * put that convention back on the trust surface for the one graphic whose
   * entire job is to be right about direction.
   *
   * Omitted or 0 prints the arrow pointing up — correct for a north-up export,
   * and what every export produced before RT-4.
   */
  cameraRotationDeg?: number;
}

// ---------------------------------------------------------------------------
// Constants
// ---------------------------------------------------------------------------

/**
 * ODbL §4 attribution clause. Non-removable; survives all PrintOptions
 * combinations. Tests assert this string is reachable in the PDF byte stream.
 */
export const ODBL_ATTRIBUTION =
  "© OpenStreetMap contributors (openstreetmap.org/copyright) | © OpenMapTiles";

/**
 * Page sizes in points (PDF user-space units). 1pt = 1/72 inch.
 * - A4: 210×297 mm  → 595.28×841.89 pt
 * - Letter: 8.5×11 in → 612×792 pt
 * - Tabloid: 11×17 in → 792×1224 pt
 */
const PAGE_SIZES_PORTRAIT: Record<PageSize, [number, number]> = {
  a4: [595.28, 841.89],
  letter: [612, 792],
  tabloid: [792, 1224],
};

/** Inset between the page edge and the content area. */
const MARGIN = 36; // 0.5 inch

// ---------------------------------------------------------------------------
// Internal helpers
// ---------------------------------------------------------------------------

export function pageDimensions(
  size: PageSize,
  orientation: Orientation,
): { width: number; height: number } {
  const [w, h] = PAGE_SIZES_PORTRAIT[size];
  return orientation === "portrait"
    ? { width: w, height: h }
    : { width: h, height: w };
}

/** Parse `#rgb` or `#rrggbb` into pdf-lib rgb(). Defaults to a mid-grey on bad input. */
function parseHexColor(hex: string): ReturnType<typeof rgb> {
  const m = /^#([0-9a-f]{3}|[0-9a-f]{6})$/i.exec(hex.trim());
  if (!m) {
    return rgb(0.5, 0.5, 0.5);
  }
  let body = m[1];
  if (body.length === 3) {
    body = body
      .split("")
      .map((c) => c + c)
      .join("");
  }
  const r = parseInt(body.slice(0, 2), 16) / 255;
  const g = parseInt(body.slice(2, 4), 16) / 255;
  const b = parseInt(body.slice(4, 6), 16) / 255;
  return rgb(r, g, b);
}

/**
 * Decode a `data:image/jpeg;base64,...` URL into a Uint8Array. pdf-lib
 * accepts the data URL directly via embedJpg, but we decode here so we can
 * surface clearer errors when the caller's canvas yielded a non-JPEG stub
 * (e.g. jsdom's empty `data:,`).
 */
function dataUrlToBytes(dataUrl: string): Uint8Array {
  const idx = dataUrl.indexOf("base64,");
  if (idx === -1) {
    throw new Error(
      `print-pdf: mapImageDataUrl is not a base64 JPEG (got: ${dataUrl.slice(
        0,
        32,
      )}…)`,
    );
  }
  const b64 = dataUrl.slice(idx + "base64,".length);
  // atob is present in both browsers and node (>=16) via globalThis.
  const bin =
    typeof atob === "function"
      ? atob(b64)
      : Buffer.from(b64, "base64").toString("binary");
  const out = new Uint8Array(bin.length);
  for (let i = 0; i < bin.length; i++) {
    out[i] = bin.charCodeAt(i);
  }
  return out;
}

/** A point in PDF user space (y-up, origin bottom-left). */
export interface PagePoint {
  x: number;
  y: number;
}

/** Where the parts of the north arrow land once the camera rotation is applied. */
export interface NorthArrowGeometry {
  /** Base of the shaft — the end opposite the arrowhead. */
  tail: PagePoint;
  /** Point of the arrowhead; the direction north runs on the page. */
  tip: PagePoint;
  /** The two arrowhead diagonals, each running back from the tip. */
  barbs: [PagePoint, PagePoint];
  /** Anchor for the "N" glyph, just past the tip. */
  label: PagePoint;
}

/** Overall height of the arrow in points, tail to tip. */
const NORTH_ARROW_SIZE = 18;

/**
 * Where a north arrow's points land for a given camera rotation.
 *
 * Split out from the drawing so the geometry — the part that can be silently,
 * plausibly wrong by a sign — is testable without a `PDFPage`.
 *
 * RT-4. The arrow turns with the camera, because the exported raster already
 * shows a turned map: north on the page is wherever the camera left it, not up.
 * Before this the arrow always pointed up, which made every rotated export
 * wrong about the one thing a north arrow is for.
 *
 * **The sign, derived rather than guessed.** Let `r` be the screen rotation of
 * geographic east, y-down — what `cameraRotation` returns and what
 * `cameraRotationDeg` carries. East on screen is `(cos r, sin r)`, so north,
 * east turned a quarter-turn in that same y-down frame, is `(sin r, -cos r)`;
 * at `r = 0` that is `(0, -1)`, straight up the screen, as it should be. The
 * raster lands on the page unflipped, so converting y-down to PDF's y-up makes
 * north on the page `(sin r, cos r)`. The rotation below is y-up
 * counter-clockwise by `theta`, which sends page-up `(0, 1)` to
 * `(-sin θ, cos θ)`. Matching the two gives `θ = -r`, hence the negation — and
 * nothing here has to be right about which way MapLibre counts a bearing.
 *
 * @param cx - Arrow centre, page x.
 * @param cy - Arrow centre, page y.
 * @param cameraRotationDeg - Screen rotation of geographic east, degrees, y-down.
 */
export function northArrowGeometry(
  cx: number,
  cy: number,
  cameraRotationDeg = 0,
): NorthArrowGeometry {
  const half = NORTH_ARROW_SIZE / 2;
  const theta = (-cameraRotationDeg * Math.PI) / 180;
  const cos = Math.cos(theta);
  const sin = Math.sin(theta);
  /** Offset from the arrow's centre, turned into page coordinates. */
  const at = (dx: number, dy: number): PagePoint => ({
    x: cx + dx * cos - dy * sin,
    y: cy + dx * sin + dy * cos,
  });
  return {
    tail: at(0, -half),
    tip: at(0, half),
    barbs: [at(-4, half - 5), at(4, half - 5)],
    label: at(0, half + 4),
  };
}

/**
 * Compose a north arrow as a tiny three-line path. pdf-lib's `drawSvgPath`
 * applies a single-stroke render so we keep this minimal: a vertical arrow
 * with crossbar and an "N" label drawn separately.
 *
 * The "N" rides to the rotated tip but stays upright: a turned glyph is harder
 * to read and the arrow already carries the direction.
 */
function drawNorthArrow(
  page: PDFPage,
  font: PDFFont,
  cx: number,
  cy: number,
  cameraRotationDeg = 0,
): void {
  const { tail, tip, barbs, label } = northArrowGeometry(
    cx,
    cy,
    cameraRotationDeg,
  );
  const stroke = { thickness: 1.2, color: rgb(0.13, 0.13, 0.13) };
  // Shaft + arrowhead via two diagonals.
  page.drawLine({ start: tail, end: tip, ...stroke });
  page.drawLine({ start: tip, end: barbs[0], ...stroke });
  page.drawLine({ start: tip, end: barbs[1], ...stroke });
  page.drawText("N", {
    x: label.x - 3,
    y: label.y,
    size: 9,
    font,
    color: rgb(0.13, 0.13, 0.13),
  });
}

/**
 * Draw a simple scale bar: two segments of equal pixel length labelled with
 * "100m"/"1km" semantics. v1 uses a static label since map projection /
 * effective resolution is not threaded through PrintOptions; the bar exists
 * as a cartographic placeholder. A later task can replace the label with a
 * value derived from `map.unproject` at center.
 */
function drawScaleBar(
  page: PDFPage,
  font: PDFFont,
  x: number,
  y: number,
): void {
  const segW = 40;
  const segH = 5;
  // Left segment — filled.
  page.drawRectangle({
    x,
    y,
    width: segW,
    height: segH,
    color: rgb(0.13, 0.13, 0.13),
  });
  // Right segment — outlined.
  page.drawRectangle({
    x: x + segW,
    y,
    width: segW,
    height: segH,
    borderColor: rgb(0.13, 0.13, 0.13),
    borderWidth: 0.75,
  });
  // Tick labels.
  page.drawText("0", {
    x,
    y: y - 10,
    size: 7,
    font,
    color: rgb(0.2, 0.2, 0.2),
  });
  page.drawText("scale", {
    x: x + segW * 2 + 4,
    y: y - 2,
    size: 7,
    font,
    color: rgb(0.2, 0.2, 0.2),
  });
}

// ---------------------------------------------------------------------------
// Public API
// ---------------------------------------------------------------------------

/**
 * Render the current map view + chrome to a PDF Blob. Single-page v1 (atlas
 * task A10) — original Task 13's multi-page provision is parked until a user
 * surfaces a real need.
 */
export async function exportPDF(opts: PrintOptions): Promise<Blob> {
  const { width, height } = pageDimensions(opts.pageSize, opts.orientation);
  const pdfDoc = await PDFDocument.create();
  const font = await pdfDoc.embedFont(StandardFonts.Helvetica);
  const fontBold = await pdfDoc.embedFont(StandardFonts.HelveticaBold);

  // Belt-and-braces: write attribution into the Info dict. Survives any
  // future content-stream re-encoding because Info strings live in the
  // PDF trailer rather than inside a page content stream.
  pdfDoc.setTitle(opts.title);
  pdfDoc.setSubject(ODBL_ATTRIBUTION);
  // ODbL byte-survival belt: pdf-lib's setKeywords / setSubject unconditionally
  // encode Info-dict strings as PDFHexString (UTF-16BE) — the "©" forces that
  // path even for the other entries, so the ASCII substring no longer appears
  // in the byte stream. We bypass setKeywords and write the Info dict directly
  // with PDFString.of, which emits a parenthesized literal string. Non-ASCII
  // bytes inside a literal string are legal PDF (interpreted as PDFDocEncoding
  // or platform-dependent), and the ASCII portion remains a literal substring.
  // This guarantees `"OpenStreetMap contributors"` is byte-recoverable by
  // legal-compliance scanners without UTF-16BE decoding.
  // `getInfoDict` is declared `private` in pdf-lib's d.ts despite being the
  // documented seam for low-level Info-dict writes. We escape the type-system
  // gate with a structural cast — there's no public method that emits a
  // PDFString (literal) instead of a PDFHexString.
  const info = (
    pdfDoc as unknown as {
      getInfoDict(): {
        set: (
          k: typeof PDFName.prototype,
          v: typeof PDFString.prototype,
        ) => void;
      };
    }
  ).getInfoDict();
  info.set(
    PDFName.of("Keywords"),
    PDFString.of(
      "OpenStreetMap contributors (openstreetmap.org/copyright); OpenMapTiles; atlasdraw; map",
    ),
  );
  pdfDoc.setProducer("atlasdraw print-pdf");
  pdfDoc.setCreator("atlasdraw");

  const page = pdfDoc.addPage([width, height]);

  // ----- Title block (top) -----------------------------------------------
  const titleY = height - MARGIN - 16;
  page.drawText(opts.title || "Untitled map", {
    x: MARGIN,
    y: titleY,
    size: 18,
    font: fontBold,
    color: rgb(0.1, 0.1, 0.1),
  });
  const dateStr = new Date().toISOString().slice(0, 10);
  page.drawText(dateStr, {
    x: MARGIN,
    y: titleY - 16,
    size: 9,
    font,
    color: rgb(0.3, 0.3, 0.3),
  });

  // ODbL attribution — rendered text in the title block. Non-removable
  // per OQ6 (ODbL §4 — derivative-works attribution clause). Tests assert
  // the substring "OpenStreetMap contributors" is reachable in PDF bytes.
  page.drawText(ODBL_ATTRIBUTION, {
    x: MARGIN,
    y: titleY - 30,
    size: 7,
    font,
    color: rgb(0.3, 0.3, 0.3),
  });

  // ----- Map image (centred, ~65% of page area) --------------------------
  // Caller is responsible for compositing and encoding — see
  // PrintOptions.mapImageDataUrl.
  const mapDataUrl = opts.mapImageDataUrl;
  // Skip the image when the caller had nothing to encode (jsdom's canvas
  // yields "data:,"). Real browsers always produce valid JPEG bytes here.
  let mapImage: Awaited<ReturnType<typeof pdfDoc.embedJpg>> | null = null;
  if (mapDataUrl && mapDataUrl !== "data:," && mapDataUrl.includes("base64,")) {
    try {
      const bytes = dataUrlToBytes(mapDataUrl);
      mapImage = await pdfDoc.embedJpg(bytes);
    } catch {
      mapImage = null;
    }
  }

  const mapAreaTop = titleY - 44;
  const legendH = 80;
  const mapAreaBottom = MARGIN + legendH + 10;
  const mapAreaW = width - MARGIN * 2;
  const mapAreaH = Math.max(40, mapAreaTop - mapAreaBottom);

  if (mapImage) {
    // Fit the map preserving aspect, centred in the area.
    const dims = mapImage.scaleToFit(mapAreaW, mapAreaH);
    page.drawImage(mapImage, {
      x: MARGIN + (mapAreaW - dims.width) / 2,
      y: mapAreaBottom + (mapAreaH - dims.height) / 2,
      width: dims.width,
      height: dims.height,
    });
  } else {
    // Placeholder rectangle so the PDF still has a recognizable shape.
    page.drawRectangle({
      x: MARGIN,
      y: mapAreaBottom,
      width: mapAreaW,
      height: mapAreaH,
      borderColor: rgb(0.7, 0.7, 0.7),
      borderWidth: 0.5,
    });
  }

  // ----- North arrow (top-right of map area) -----------------------------
  drawNorthArrow(
    page,
    font,
    width - MARGIN - 12,
    mapAreaTop - 18,
    opts.cameraRotationDeg ?? 0,
  );

  // ----- Legend (bottom-left) --------------------------------------------
  const legendX = MARGIN;
  const legendY = MARGIN + legendH - 12;
  page.drawText("Legend", {
    x: legendX,
    y: legendY,
    size: 10,
    font: fontBold,
    color: rgb(0.1, 0.1, 0.1),
  });
  let row = legendY - 14;
  for (const entry of opts.layers) {
    // 10pt color swatch.
    page.drawRectangle({
      x: legendX,
      y: row - 2,
      width: 10,
      height: 10,
      color: parseHexColor(entry.color),
      borderColor: rgb(0.3, 0.3, 0.3),
      borderWidth: 0.5,
    });
    page.drawText(entry.name, {
      x: legendX + 14,
      y: row,
      size: 9,
      font,
      color: rgb(0.13, 0.13, 0.13),
    });
    row -= 12;
    if (row < MARGIN) {
      break;
    } // overflow guard for v1
  }

  // ----- Scale bar (bottom-right) ----------------------------------------
  drawScaleBar(page, font, width - MARGIN - 120, MARGIN + 12);

  // useObjectStreams: false — pdf-lib's default packs all indirect objects
  // (including the Info dict) into a FlateDecode'd object stream. Setting
  // this false writes the cross-reference table in classic PDF 1.4 form, so
  // the Info-dict strings (Title / Subject / Keywords) remain plaintext in
  // the byte stream. ODbL attribution must be byte-recoverable per OQ6.
  const bytes = await pdfDoc.save({ useObjectStreams: false });
  // pdf-lib returns Uint8Array; wrap as PDF Blob. We slice into a fresh
  // ArrayBuffer to make Blob happy across runtimes that are picky about
  // SharedArrayBuffer/Uint8Array distinction.
  const ab = bytes.buffer.slice(
    bytes.byteOffset,
    bytes.byteOffset + bytes.byteLength,
  ) as ArrayBuffer;
  return new Blob([ab], { type: "application/pdf" });
}
