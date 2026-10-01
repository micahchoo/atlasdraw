// SPDX-License-Identifier: AGPL-3.0-only
// Print PDF export (pdf-lib).
//
// What the PDF is: an IMAGE of the map on a page, not vector shapes. The
// image is the same composite the PNG export makes (basemap, data layers and
// drawings), rendered for the page at PRINT_DPI. Around it the page carries a
// title block, the basemap's own credit, a legend, a scale bar measured from
// the view, and a north arrow.
//
// Pure: takes an encoded image, the view's size and ground resolution, and a
// flat `LayerLegendEntry[]`. It never reaches into MapLibre, the layer
// registry or React state. The caller renders the image at the pixel ratio
// `printPixelRatio` gives for the same page and legend, so the layout that
// sized the image and the layout that places it are one function.
//
// Attribution: the credit is the active basemap's `attribution` string,
// written on the page and into the PDF Info dictionary. It is never
// hard-coded: a Protomaps page credited to OpenMapTiles is wrong in both
// directions. There is no flag to hide it.

import {
  PDFDocument,
  PDFName,
  PDFString,
  StandardFonts,
  rgb,
  type PDFFont,
  type PDFImage,
  type PDFPage,
} from "pdf-lib";

// ---------------------------------------------------------------------------
// Public types
// ---------------------------------------------------------------------------

export type PageSize = "letter" | "a4" | "tabloid";
export type Orientation = "portrait" | "landscape";

/**
 * Which scale bars the page prints. Metric always; feet and miles are added
 * where they are the everyday unit (`scaleUnitsForLocale`).
 */
export type ScaleUnits = "metric" | "metric+imperial";

export interface LayerLegendEntry {
  id: string;
  name: string;
  /** Hex color (#rrggbb or #rgb); used for the legend swatch. */
  color: string;
}

/** The exported view: its CSS-pixel size and its ground resolution. */
export interface PrintView {
  /** CSS px. */
  width: number;
  /** CSS px. */
  height: number;
  /**
   * Ground metres per CSS px at the centre of the view, measured off the live
   * projection (`measureView` in lib/export.ts). Mercator scale changes with
   * latitude, so the bar is true at the centre of the map.
   */
  metersPerPixel: number;
}

export interface PageSpec {
  pageSize: PageSize;
  orientation: Orientation;
}

export interface PrintOptions extends PageSpec {
  title: string;
  /**
   * The composited view as a `data:image/jpeg;base64,…` (or PNG) URL —
   * basemap, data layers AND Excalidraw annotations — rendered at
   * `printPixelRatio(page, view, layers.length)`. Produced by
   * `exportCompositeDataURL` in lib/export.ts, the single definition of what
   * an export contains (FU-12).
   */
  mapImageDataUrl: string;
  view: PrintView;
  layers: LayerLegendEntry[];
  /** The active basemap's credit line. Omitted only for a blank basemap. */
  attribution?: string;
  /** Default "metric". */
  units?: ScaleUnits;
  /**
   * Screen rotation of the exported view: the direction geographic east ran
   * on screen, in degrees, y-down — i.e. `cameraRotation(map)` converted from
   * radians. Read at export time so it describes the same viewport the image
   * does.
   *
   * It is deliberately NOT `map.getBearing()`. RT-2 measures the rotation off
   * the live projection rather than trusting MapLibre's bearing sign
   * convention; taking a bearing here would put that convention back on the
   * trust surface for the one graphic whose entire job is to be right about
   * direction.
   *
   * Omitted or 0 prints the arrow pointing up — correct for a north-up export.
   */
  cameraRotationDeg?: number;
}

// ---------------------------------------------------------------------------
// Constants
// ---------------------------------------------------------------------------

/**
 * Resolution of the map image on paper. 300 dpi is the usual print target;
 * the image is rendered for it, not upscaled to it.
 */
export const PRINT_DPI = 300;

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

/** Space the title, date and credit take at the top of the first page. */
const TITLE_BLOCK_H = 56;
/** Gap between the map and the band below it. */
const GAP = 10;

/** Width of the scale block at the right of the band below the map. */
const SCALE_BLOCK_W = 180;
/** The longest a scale bar may run. 100 pt is about 3.5 cm. */
const SCALE_BAR_MAX_PT = 100;
const SCALE_ROW_H = 16;

const LEGEND_HEADER_H = 16;
const LEGEND_ROW_H = 12;
const LEGEND_COL_W = 150;
const LEGEND_SWATCH = 9;
const LEGEND_TEXT_SIZE = 9;
/** The legend may take at most this share of the first page's height. */
const LEGEND_MAX_SHARE = 0.3;

const INK = rgb(0.13, 0.13, 0.13);
const MUTED = rgb(0.3, 0.3, 0.3);

const METERS_PER_FOOT = 0.3048;
const METERS_PER_MILE = 1609.344;
/** One point of paper, in metres. */
const METERS_PER_POINT_OF_PAPER = 0.0254 / 72;

// ---------------------------------------------------------------------------
// Layout
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

export interface Rect {
  x: number;
  y: number;
  width: number;
  height: number;
}

/** Where legend entries go on one page: a grid filled down each column first. */
interface LegendGrid {
  /** Top-left of the first row, PDF y-up. */
  x: number;
  top: number;
  cols: number;
  rows: number;
}

export interface PrintLayout {
  page: { width: number; height: number };
  /** Where the map image is drawn, in points. */
  frame: Rect;
  /** The scale block, right of the legend in the band below the map. */
  scaleBlock: Rect;
  /** Legend on the map page; `count` entries fit in it. */
  legend: LegendGrid & { count: number };
  /** Legend grid on each continuation page. */
  continuation: LegendGrid;
  /** Number of continuation pages the legend needs. */
  continuationPages: number;
}

/**
 * The page layout. It depends on the legend because the band under the map
 * grows with the number of rows, and the map frame takes what is left. Both
 * `printPixelRatio` (before the image is rendered) and `exportPDF` (when it
 * is placed) call this, so the image is rendered for the frame it lands in.
 */
export function printLayout(
  spec: PageSpec,
  view: Pick<PrintView, "width" | "height">,
  legendCount: number,
): PrintLayout {
  const page = pageDimensions(spec.pageSize, spec.orientation);
  const contentW = page.width - MARGIN * 2;
  const contentH = page.height - MARGIN * 2;

  const legendW = contentW - SCALE_BLOCK_W - GAP;
  const cols = Math.max(1, Math.floor(legendW / LEGEND_COL_W));
  const maxRows = Math.max(
    1,
    Math.floor((contentH * LEGEND_MAX_SHARE - LEGEND_HEADER_H) / LEGEND_ROW_H),
  );
  const firstCapacity = cols * maxRows;
  const count = Math.min(legendCount, firstCapacity);
  const rows = count === 0 ? 0 : Math.min(maxRows, Math.ceil(count / cols));
  const legendH = count === 0 ? 0 : LEGEND_HEADER_H + rows * LEGEND_ROW_H;
  const scaleH = SCALE_ROW_H * 3;
  const bandH = Math.max(legendH, scaleH);

  const areaTop = page.height - MARGIN - TITLE_BLOCK_H;
  const areaBottom = MARGIN + bandH + GAP;
  const areaH = Math.max(40, areaTop - areaBottom);
  const fit = Math.min(contentW / view.width, areaH / view.height);
  const frameW = view.width * fit;
  const frameH = view.height * fit;
  const frame: Rect = {
    x: MARGIN + (contentW - frameW) / 2,
    y: areaBottom + (areaH - frameH) / 2,
    width: frameW,
    height: frameH,
  };

  const contCols = Math.max(1, Math.floor(contentW / LEGEND_COL_W));
  const contRows = Math.max(
    1,
    Math.floor((contentH - LEGEND_HEADER_H) / LEGEND_ROW_H),
  );
  const rest = legendCount - count;

  return {
    page,
    frame,
    scaleBlock: {
      x: page.width - MARGIN - SCALE_BLOCK_W,
      y: MARGIN,
      width: SCALE_BLOCK_W,
      height: bandH,
    },
    legend: {
      x: MARGIN,
      top: MARGIN + bandH - LEGEND_HEADER_H,
      cols,
      rows,
      count,
    },
    continuation: {
      x: MARGIN,
      top: page.height - MARGIN - LEGEND_HEADER_H,
      cols: contCols,
      rows: contRows,
    },
    continuationPages: rest > 0 ? Math.ceil(rest / (contCols * contRows)) : 0,
  };
}

/**
 * The pixel ratio to render the view at so the map image is PRINT_DPI on the
 * page. Ratio, not pixels, because both renderers (MapLibre and Excalidraw)
 * take a ratio over the CSS-pixel view.
 */
export function printPixelRatio(
  spec: PageSpec,
  view: Pick<PrintView, "width" | "height">,
  legendCount: number,
): number {
  const { frame } = printLayout(spec, view, legendCount);
  return ((frame.width / 72) * PRINT_DPI) / view.width;
}

// ---------------------------------------------------------------------------
// Scale
// ---------------------------------------------------------------------------

/** The largest 1, 2 or 5 × 10^n that is not more than `x`. */
function niceFloor(x: number): number {
  let power = 10 ** Math.floor(Math.log10(x));
  // log10 of an exact power of ten can land a hair under the integer.
  if (x / power >= 10) {
    power *= 10;
  }
  const mantissa = x / power;
  const step = mantissa >= 5 ? 5 : mantissa >= 2 ? 2 : 1;
  return step * power;
}

/** `2000` → "2,000"; `0.5` → "0.5". */
function formatAmount(n: number): string {
  return n >= 1
    ? Math.round(n).toLocaleString("en-US")
    : String(Number(n.toPrecision(1)));
}

export interface ScaleBar {
  /** Ground distance the bar stands for. */
  meters: number;
  /** Length of the bar on the page. */
  lengthPt: number;
  label: string;
}

/**
 * The longest round-number bar (1, 2 or 5 × 10^n of one unit) that fits in
 * `maxLengthPt`, for a page where one point is `metersPerPoint` of ground.
 * Metric uses m below a kilometre and km from there; imperial uses ft below a
 * mile and mi from there.
 */
export function scaleBar(
  metersPerPoint: number,
  maxLengthPt: number,
  system: "metric" | "imperial",
): ScaleBar {
  const maxMeters = maxLengthPt * metersPerPoint;
  let unitMeters: number;
  let name: (amount: number) => string;
  if (system === "metric") {
    const km = maxMeters >= 1000;
    unitMeters = km ? 1000 : 1;
    name = (a) => `${formatAmount(a)} ${km ? "km" : "m"}`;
  } else {
    const mi = maxMeters >= METERS_PER_MILE;
    unitMeters = mi ? METERS_PER_MILE : METERS_PER_FOOT;
    name = (a) => `${formatAmount(a)} ${mi ? "mi" : "ft"}`;
  }
  const amount = niceFloor(maxMeters / unitMeters);
  const meters = amount * unitMeters;
  return { meters, lengthPt: meters / metersPerPoint, label: name(amount) };
}

/**
 * The representative fraction ("1:39,400") of a page where one point is
 * `metersPerPoint` of ground, to three significant figures. True only when
 * the page is printed at 100%, which is why the page says so.
 */
export function scaleRatioLabel(metersPerPoint: number): string {
  const denominator = Number(
    (metersPerPoint / METERS_PER_POINT_OF_PAPER).toPrecision(3),
  );
  return `1:${denominator.toLocaleString("en-US")}`;
}

/** Feet and miles are added for the United States. */
export function scaleUnitsForLocale(locale: string): ScaleUnits {
  let region: string | undefined;
  try {
    region = new Intl.Locale(locale).region;
  } catch {
    region = undefined;
  }
  return region === "US" ? "metric+imperial" : "metric";
}

// ---------------------------------------------------------------------------
// Drawing helpers
// ---------------------------------------------------------------------------

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
 * Text the standard font can encode. Helvetica is WinAnsi: a layer called
 * "東京" would make pdf-lib throw and lose the whole export, so each glyph the
 * font lacks prints as "?".
 */
function printable(font: PDFFont, text: string): string {
  const set = new Set(font.getCharacterSet());
  return Array.from(text, (ch) =>
    set.has(ch.codePointAt(0) ?? 0) ? ch : "?",
  ).join("");
}

/** Shorten `text` to `maxWidth` at `size`, ending in "…" when cut. */
function fitText(
  font: PDFFont,
  text: string,
  size: number,
  maxWidth: number,
): string {
  if (font.widthOfTextAtSize(text, size) <= maxWidth) {
    return text;
  }
  let lo = 0;
  let hi = text.length;
  while (lo < hi) {
    const mid = Math.ceil((lo + hi) / 2);
    const candidate = `${text.slice(0, mid).trimEnd()}…`;
    if (font.widthOfTextAtSize(candidate, size) <= maxWidth) {
      lo = mid;
    } else {
      hi = mid - 1;
    }
  }
  return `${text.slice(0, lo).trimEnd()}…`;
}

/**
 * Decode a `data:image/…;base64,…` URL. Throws on anything else: a PDF
 * without its map is a failed export, not a smaller success (FU-12).
 */
function dataUrlToBytes(dataUrl: string): Uint8Array {
  const idx = dataUrl.indexOf("base64,");
  if (idx === -1 || idx + "base64,".length === dataUrl.length) {
    throw new Error("print-pdf: the map image is empty");
  }
  const bin = atob(dataUrl.slice(idx + "base64,".length));
  const out = new Uint8Array(bin.length);
  for (let i = 0; i < bin.length; i++) {
    out[i] = bin.charCodeAt(i);
  }
  return out;
}

async function embedMapImage(
  pdfDoc: PDFDocument,
  dataUrl: string,
): Promise<PDFImage> {
  const bytes = dataUrlToBytes(dataUrl);
  return dataUrl.startsWith("data:image/png")
    ? pdfDoc.embedPng(bytes)
    : pdfDoc.embedJpg(bytes);
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

/** Draw one scale bar, two segments filled and hollow, with its label at the end. */
function drawScaleBar(
  page: PDFPage,
  font: PDFFont,
  x: number,
  y: number,
  bar: ScaleBar,
): void {
  const h = 4;
  const half = bar.lengthPt / 2;
  page.drawRectangle({ x, y, width: half, height: h, color: INK });
  page.drawRectangle({
    x: x + half,
    y,
    width: half,
    height: h,
    borderColor: INK,
    borderWidth: 0.75,
  });
  page.drawText(bar.label, {
    x: x + bar.lengthPt + 4,
    y: y - 1,
    size: 7,
    font,
    color: MUTED,
  });
}

/** Scale bars and the 1:n fraction, top-down in the scale block. */
function drawScaleBlock(
  page: PDFPage,
  font: PDFFont,
  layout: PrintLayout,
  view: PrintView,
  units: ScaleUnits,
): void {
  const metersPerPoint =
    (view.metersPerPixel * view.width) / layout.frame.width;
  if (!(metersPerPoint > 0) || !Number.isFinite(metersPerPoint)) {
    return;
  }
  const { x, y, height } = layout.scaleBlock;
  let row = y + height - SCALE_ROW_H + 6;
  drawScaleBar(
    page,
    font,
    x,
    row,
    scaleBar(metersPerPoint, SCALE_BAR_MAX_PT, "metric"),
  );
  if (units === "metric+imperial") {
    row -= SCALE_ROW_H;
    drawScaleBar(
      page,
      font,
      x,
      row,
      scaleBar(metersPerPoint, SCALE_BAR_MAX_PT, "imperial"),
    );
  }
  row -= SCALE_ROW_H;
  page.drawText(`${scaleRatioLabel(metersPerPoint)} at 100% print size`, {
    x,
    y: row,
    size: 7,
    font,
    color: MUTED,
  });
}

/** Draw `entries` into `grid`, filling each column top to bottom. */
function drawLegendGrid(
  page: PDFPage,
  font: PDFFont,
  grid: LegendGrid,
  entries: readonly LayerLegendEntry[],
): void {
  const textW = LEGEND_COL_W - LEGEND_SWATCH - 12;
  entries.forEach((entry, i) => {
    const col = Math.floor(i / grid.rows);
    const row = i % grid.rows;
    const x = grid.x + col * LEGEND_COL_W;
    const y = grid.top - (row + 1) * LEGEND_ROW_H;
    page.drawRectangle({
      x,
      y: y - 1,
      width: LEGEND_SWATCH,
      height: LEGEND_SWATCH,
      color: parseHexColor(entry.color),
      borderColor: MUTED,
      borderWidth: 0.5,
    });
    page.drawText(
      fitText(font, printable(font, entry.name), LEGEND_TEXT_SIZE, textW),
      {
        x: x + LEGEND_SWATCH + 5,
        y,
        size: LEGEND_TEXT_SIZE,
        font,
        color: INK,
      },
    );
  });
}

function drawLegendHeader(
  page: PDFPage,
  font: PDFFont,
  x: number,
  top: number,
  text: string,
): void {
  page.drawText(text, { x, y: top + 4, size: 10, font, color: INK });
}

// ---------------------------------------------------------------------------
// Public API
// ---------------------------------------------------------------------------

/**
 * Render the page: title block, map image, north arrow, legend, scale. A
 * legend too long for the band under the map continues on further pages of
 * the same size; no entry is dropped.
 */
export async function exportPDF(opts: PrintOptions): Promise<Blob> {
  const layout = printLayout(opts, opts.view, opts.layers.length);
  const { width, height } = layout.page;
  const pdfDoc = await PDFDocument.create();
  const font = await pdfDoc.embedFont(StandardFonts.Helvetica);
  const fontBold = await pdfDoc.embedFont(StandardFonts.HelveticaBold);
  const mapImage = await embedMapImage(pdfDoc, opts.mapImageDataUrl);
  const attribution = opts.attribution?.trim() ?? "";
  const title = printable(fontBold, opts.title || "Untitled map");

  pdfDoc.setTitle(opts.title || "Untitled map");
  pdfDoc.setProducer("atlasdraw print-pdf");
  pdfDoc.setCreator("atlasdraw");
  if (attribution) {
    pdfDoc.setSubject(attribution);
    // setSubject writes UTF-16 hex once the "©" is in the string, so the
    // credit's ASCII words are not a plain byte substring of the file. Keywords
    // is written as a literal string so a byte scan still finds them.
    // `getInfoDict` is `private` in pdf-lib's d.ts; there is no public method
    // that writes a literal string.
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
      PDFString.of(attribution.replace(/[^\x20-\x7e]/g, "").trim()),
    );
  }

  const page = pdfDoc.addPage([width, height]);

  // ----- Title block -----------------------------------------------------
  const titleY = height - MARGIN - 16;
  page.drawText(fitText(fontBold, title, 18, width - MARGIN * 2), {
    x: MARGIN,
    y: titleY,
    size: 18,
    font: fontBold,
    color: rgb(0.1, 0.1, 0.1),
  });
  page.drawText(new Date().toISOString().slice(0, 10), {
    x: MARGIN,
    y: titleY - 16,
    size: 9,
    font,
    color: MUTED,
  });
  if (attribution) {
    page.drawText(
      fitText(font, printable(font, attribution), 7, width - MARGIN * 2),
      { x: MARGIN, y: titleY - 30, size: 7, font, color: MUTED },
    );
  }

  // ----- Map image -------------------------------------------------------
  page.drawImage(mapImage, layout.frame);

  // ----- North arrow (top-right corner of the map) -----------------------
  const arrowX = layout.frame.x + layout.frame.width - 16;
  const arrowY = layout.frame.y + layout.frame.height - 20;
  page.drawCircle({
    x: arrowX,
    y: arrowY + 2,
    size: 15,
    color: rgb(1, 1, 1),
    opacity: 0.85,
  });
  drawNorthArrow(page, font, arrowX, arrowY, opts.cameraRotationDeg ?? 0);

  // ----- Legend ----------------------------------------------------------
  const { legend, continuation } = layout;
  if (legend.count > 0) {
    drawLegendHeader(
      page,
      fontBold,
      legend.x,
      legend.top,
      layout.continuationPages > 0 ? "Legend (continues on page 2)" : "Legend",
    );
    drawLegendGrid(page, font, legend, opts.layers.slice(0, legend.count));
  }
  const perPage = continuation.cols * continuation.rows;
  for (let p = 0; p < layout.continuationPages; p++) {
    const more = pdfDoc.addPage([width, height]);
    const start = legend.count + p * perPage;
    drawLegendHeader(
      more,
      fontBold,
      continuation.x,
      continuation.top,
      "Legend (continued)",
    );
    drawLegendGrid(
      more,
      font,
      continuation,
      opts.layers.slice(start, start + perPage),
    );
  }

  // ----- Scale -----------------------------------------------------------
  drawScaleBlock(page, font, layout, opts.view, opts.units ?? "metric");

  // useObjectStreams: false — keep the Info dictionary out of a compressed
  // object stream, so its literal strings stay readable in the file bytes.
  const bytes = await pdfDoc.save({ useObjectStreams: false });
  const ab = bytes.buffer.slice(
    bytes.byteOffset,
    bytes.byteOffset + bytes.byteLength,
  ) as ArrayBuffer;
  return new Blob([ab], { type: "application/pdf" });
}
