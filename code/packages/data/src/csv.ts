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
//
// Phase 6 A8 — optional geocoder hook (CsvReadOptions.geocoder). When set
// AND the CSV has an address column, rows that don't already carry a valid
// lat/lng pair are resolved via the geocoder. The geocoder is operator-
// configured (ADR-0006 / ADR-0011, zero call-home); when `opts.geocoder`
// is absent the reader's behaviour is identical to pre-A8.

import Papa from "papaparse";

import type { Feature, FeatureCollection } from "geojson";

import type { PhotonGeocoder } from "./geocode.js";

/**
 * Optional parameters for `parseCSV`. Forward-compatible: existing callers
 * pass nothing and get the pre-A8 behaviour.
 */
export interface CsvReadOptions {
  /**
   * Phase 6 A8 — Photon-compatible geocoder used to resolve rows that have
   * an address column but no parseable lat/lng. When omitted, geocoding is
   * skipped entirely and the reader makes NO network calls.
   */
  geocoder?: PhotonGeocoder;
}

/**
 * Max in-flight geocoder requests during a single CSV import. Keeps Photon
 * happy (Komoot's public instance is rate-limited) and bounds memory.
 */
const GEOCODE_MAX_CONCURRENCY = 5;

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

export async function parseCSV(
  blob: Blob,
  opts?: CsvReadOptions,
): Promise<FeatureCollection> {
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
    throw new CSVParseError("EMPTY_FILE", "CSV has a header but no data rows.");
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

  const addressCol = headers.find((h) => ADDRESS_NAME_RE.test(h));
  const hasCoordCols = latCol !== null && lngCol !== null && latCol !== lngCol;

  // A8: if there are no coord columns but a geocoder + address column are
  // available, fall through to the geocoder pass instead of throwing.
  // Without a geocoder, behaviour matches pre-A8 (throw).
  if (!hasCoordCols && !(opts?.geocoder && addressCol !== undefined)) {
    throw new CSVParseError(
      "NO_COORD_COLUMNS",
      "Could not identify latitude and longitude columns. " +
        "Use headers like lat/lng or include columns whose values fall in " +
        "[-90,90] / [-180,180] for the majority of rows.",
    );
  }

  // Pass 1: emit features that already have valid lat/lng. Track rows that
  // are missing coords but carry an address — pass 2 geocodes those.
  interface PendingRow {
    properties: Record<string, unknown>;
    address: string;
  }
  const features: Feature[] = [];
  const pending: PendingRow[] = [];

  for (const row of rows) {
    const lat = hasCoordCols ? toFiniteNumber(row[latCol!]) : null;
    const lng = hasCoordCols ? toFiniteNumber(row[lngCol!]) : null;
    const latOk = lat !== null && lat >= -90 && lat <= 90;
    const lngOk = lng !== null && lng >= -180 && lng <= 180;

    const properties: Record<string, unknown> = {};
    for (const key of headers) {
      if (hasCoordCols && (key === latCol || key === lngCol)) {
        continue;
      }
      properties[key] = row[key];
    }
    if (addressCol !== undefined) {
      properties._addressColumn_v1 = addressCol;
    }

    if (latOk && lngOk) {
      features.push({
        type: "Feature",
        geometry: { type: "Point", coordinates: [lng!, lat!] },
        properties,
      });
      continue;
    }

    // Missing/invalid coords. If a geocoder is wired and we have an
    // address value, defer to pass 2. Otherwise the row is dropped
    // (matches pre-A8 behaviour).
    if (opts?.geocoder && addressCol !== undefined) {
      const addr = row[addressCol];
      if (typeof addr === "string" && addr.trim() !== "") {
        pending.push({ properties, address: addr });
      }
    }
  }

  // Pass 2: geocode pending rows. Concurrency-capped — Komoot rate-limits
  // the public Photon instance, and self-hosted instances appreciate the
  // courtesy too. Null geocoder results drop the row (do NOT throw).
  // Per-row network errors also drop the row to keep imports resilient.
  if (opts?.geocoder && pending.length > 0) {
    const resolved = await runWithConcurrency(
      pending,
      GEOCODE_MAX_CONCURRENCY,
      async (p) => {
        try {
          const r = await opts.geocoder!.geocode(p.address);
          if (!r) {
            return null;
          }
          const feat: Feature = {
            type: "Feature",
            geometry: { type: "Point", coordinates: [r.lng, r.lat] },
            properties: {
              ...p.properties,
              _geocoded_v1: true,
              _geocodeConfidence_v1: r.confidence,
              _geocodeDisplayName_v1: r.displayName,
            },
          };
          return feat;
        } catch {
          return null;
        }
      },
    );
    for (const feat of resolved) {
      if (feat) {
        features.push(feat);
      }
    }
  }

  return { type: "FeatureCollection", features };
}

/**
 * Promise-pool semaphore. `worker` runs against each item; at most `cap`
 * worker invocations are in-flight at any time. Results are returned in
 * the same order as `items`.
 */
async function runWithConcurrency<T, R>(
  items: T[],
  cap: number,
  worker: (item: T) => Promise<R>,
): Promise<R[]> {
  const results: R[] = new Array(items.length);
  let next = 0;
  const runners: Promise<void>[] = [];
  const workers = Math.max(1, Math.min(cap, items.length));
  for (let w = 0; w < workers; w++) {
    runners.push(
      // eslint-disable-next-line no-loop-func
      (async () => {
        while (true) {
          const i = next++;
          if (i >= items.length) {
            return;
          }
          results[i] = await worker(items[i]!);
        }
      })(),
    );
  }
  await Promise.all(runners);
  return results;
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
    if (exclude.has(col)) {
      continue;
    }
    let inRange = 0;
    for (const row of rows) {
      const n = toFiniteNumber(row[col]);
      if (n === null) {
        continue;
      }
      if (n >= min && n <= max) {
        inRange++;
      }
    }
    const score = inRange / rows.length;
    if (score >= threshold && (best === null || score > best.score)) {
      best = { col, score };
    }
  }
  return best?.col ?? null;
}

function toFiniteNumber(v: unknown): number | null {
  if (typeof v === "number") {
    return Number.isFinite(v) ? v : null;
  }
  if (typeof v !== "string") {
    return null;
  }
  const trimmed = v.trim();
  if (trimmed === "") {
    return null;
  }
  const n = Number.parseFloat(trimmed);
  // parseFloat("12abc") === 12. Reject strings whose entire trimmed body
  // isn't a numeric literal — otherwise "United States" might score as 0
  // but "32 St" would score as 32 and corrupt the lat detector.
  if (!/^[-+]?(\d+\.?\d*|\.\d+)([eE][-+]?\d+)?$/.test(trimmed)) {
    return null;
  }
  return Number.isFinite(n) ? n : null;
}
