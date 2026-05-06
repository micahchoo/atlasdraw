// SPDX-License-Identifier: MIT
// packages/data/src/csv.ts
// Phase 3 Wave 1 Task 6 — CSV → GeoJSON parser with column auto-detection.
//
// Pure module. Text-in / FeatureCollection-out, no Yjs / MapLibre / Excalidraw.
//
// Detection strategy (in order, "first found wins"):
//   1. Header-name match — column named lat/latitude/y wins as lat, lng/lon/
//      long/longitude/x wins as lng. Case-insensitive. Name-based detection
//      is authoritative: a column named "lat" is the lat column even if
//      half its values are blank or out-of-range. This is the single most
//      common shape in user CSVs and we don't second-guess it.
//   2. Value-range fallback — if no header name matched, scan each column
//      and pick the one whose values are finite and in lat-/lng-range for
//      at least THRESHOLD of rows.
//
// THRESHOLD: 0.8 (≥10 rows) / 1.0 (<10 rows). Small datasets get the strict
// 100% bar because the law of small numbers makes 0.8-of-5 unstable.
//
// Address column detection is name-only (address|location|street|addr,
// case-insensitive) and feeds the `_addressColumn_v1` property hint that
// downstream geocoding consumes.
//
// Rows whose lat/lng fail to parse are silently dropped — we don't surface
// per-row warnings here (Phase 5 concern). Empty file → EMPTY_FILE.
// No coord columns identifiable → NO_COORD_COLUMNS. Papa-level parse failure
// → PARSE_FAILED.

import Papa from "papaparse";
import type { Feature, FeatureCollection } from "geojson";

export const CSV_HEURISTIC_THRESHOLD = 0.8;
export const CSV_HEURISTIC_THRESHOLD_SMALL_DATASET = 1.0;

const LAT_NAME_RE = /^(lat|latitude|y)$/i;
const LNG_NAME_RE = /^(lng|lon|long|longitude|x)$/i;
const ADDRESS_NAME_RE = /^(address|location|street|addr)$/i;

type CSVErrorCode = "EMPTY_FILE" | "NO_COORD_COLUMNS" | "PARSE_FAILED";

export class CSVParseError extends Error {
  readonly code: CSVErrorCode;

  constructor(code: CSVErrorCode, message: string) {
    super(message);
    this.code = code;
    this.name = "CSVParseError";
  }
}

type Row = Record<string, unknown>;

export async function parseCSV(blob: Blob): Promise<FeatureCollection> {
  const text = await blob.text();

  let parsed: Papa.ParseResult<Row>;
  try {
    parsed = Papa.parse<Row>(text, {
      header: true,
      skipEmptyLines: true,
      dynamicTyping: false,
    });
  } catch (err) {
    const detail = err instanceof Error ? err.message : String(err);
    throw new CSVParseError("PARSE_FAILED", `CSV parse failed: ${detail}`);
  }

  const headers = parsed.meta?.fields ?? [];
  if (headers.length === 0) {
    throw new CSVParseError(
      "EMPTY_FILE",
      "CSV has no header row; cannot identify columns.",
    );
  }

  const rows = parsed.data ?? [];
  if (rows.length === 0) {
    throw new CSVParseError(
      "EMPTY_FILE",
      "CSV has a header but no data rows.",
    );
  }

  // Detection order matters: lng has the wider [-180, 180] range and would
  // also accept any column that satisfies lat's [-90, 90]. If we picked lat
  // first by name match and then asked lng to scan everything, lng would
  // happily reuse the same column. We pass the already-picked column as an
  // exclusion so the second pick lands on a different one. Symmetric for
  // the inverse (lng named, lat by value).
  const latNamed = headers.find((h) => LAT_NAME_RE.test(h)) ?? null;
  const lngNamed = headers.find((h) => LNG_NAME_RE.test(h)) ?? null;

  const latCol =
    latNamed ?? pickColumnByValue(headers, rows, -90, 90, [lngNamed]);
  const lngCol =
    lngNamed ?? pickColumnByValue(headers, rows, -180, 180, [latCol]);

  if (latCol === null || lngCol === null || latCol === lngCol) {
    throw new CSVParseError(
      "NO_COORD_COLUMNS",
      "Could not identify latitude and longitude columns. " +
        "Use headers like lat/lng or include columns whose values fall in " +
        "[-90,90] / [-180,180] for the majority of rows.",
    );
  }

  const addressCol = headers.find((h) => ADDRESS_NAME_RE.test(h));

  const features: Feature[] = [];
  for (const row of rows) {
    const lat = toFiniteNumber(row[latCol]);
    const lng = toFiniteNumber(row[lngCol]);
    if (lat === null || lng === null) continue;
    if (lat < -90 || lat > 90) continue;
    if (lng < -180 || lng > 180) continue;

    const properties: Record<string, unknown> = {};
    for (const key of headers) {
      if (key === latCol || key === lngCol) continue;
      properties[key] = row[key];
    }
    if (addressCol !== undefined) {
      properties["_addressColumn_v1"] = addressCol;
    }

    features.push({
      type: "Feature",
      geometry: { type: "Point", coordinates: [lng, lat] },
      properties,
    });
  }

  return { type: "FeatureCollection", features };
}

// ---------------------------------------------------------------------------
// internal

function pickColumnByValue(
  headers: string[],
  rows: Row[],
  min: number,
  max: number,
  excluded: (string | null)[],
): string | null {
  const exclude = new Set(excluded.filter((c): c is string => c !== null));
  const threshold =
    rows.length >= 10
      ? CSV_HEURISTIC_THRESHOLD
      : CSV_HEURISTIC_THRESHOLD_SMALL_DATASET;

  let best: { col: string; score: number } | null = null;
  for (const col of headers) {
    if (exclude.has(col)) continue;
    let inRange = 0;
    for (const row of rows) {
      const n = toFiniteNumber(row[col]);
      if (n === null) continue;
      if (n >= min && n <= max) inRange++;
    }
    const score = inRange / rows.length;
    if (score >= threshold && (best === null || score > best.score)) {
      best = { col, score };
    }
  }
  return best?.col ?? null;
}

function toFiniteNumber(v: unknown): number | null {
  if (typeof v === "number") return Number.isFinite(v) ? v : null;
  if (typeof v !== "string") return null;
  const trimmed = v.trim();
  if (trimmed === "") return null;
  const n = Number.parseFloat(trimmed);
  // parseFloat("12abc") === 12. Reject strings whose entire trimmed body
  // isn't a numeric literal — otherwise "United States" might score as 0
  // but "32 St" would score as 32 and corrupt the lat detector.
  if (!/^[-+]?(\d+\.?\d*|\.\d+)([eE][-+]?\d+)?$/.test(trimmed)) return null;
  return Number.isFinite(n) ? n : null;
}
