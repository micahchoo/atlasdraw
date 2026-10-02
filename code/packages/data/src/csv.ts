// SPDX-License-Identifier: MIT
// packages/data/src/csv.ts
// CSV → GeoJSON parser with column auto-detection.
//
// Pure module. Text-in / FeatureCollection-out, no Yjs / MapLibre / Excalidraw.
//
// Geometry from a column of Well-Known Text: a column named wkt, geometry or
// the_geom (case-insensitive) holds the geometry of each row, and no
// lat/lng detection runs. That is the column the CSV export writes for
// lines and areas (export.ts `toCSV`). A row whose text is not a geometry
// is dropped and counted, like a row with no coordinates.
//
// Otherwise, detection strategy (in order, "first found wins"):
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
// A column whose every non-empty value is a number becomes numbers; see
// `numericColumns`.
//
// Address column detection is name-only (address|location|street|addr,
// case-insensitive) and feeds the `_addressColumn_v1` property hint that
// downstream geocoding consumes.
//
// Rows whose lat/lng fail to parse are dropped with no per-row warning; the
// caller gets the count through `onStats`. Empty file → EMPTY_FILE.
// No coord columns identifiable → NO_COORD_COLUMNS. Papa-level parse failure
// → PARSE_FAILED.
//
// Optional geocoder hook (CsvReadOptions.geocoder). When set AND the CSV has
// an address column, rows that don't already carry a valid lat/lng pair are
// resolved via the geocoder. The geocoder is operator-configured, so there is
// no call-home (docs/architecture/adr/0006-telemetry.md and
// 0011-hosted-mode-telemetry.md); when `opts.geocoder` is absent the reader
// makes no network call.

import Papa from "papaparse";

import { parseWKT } from "./wkt.js";

import type { Feature, FeatureCollection } from "geojson";

import type { PhotonGeocoder } from "./geocode.js";

/**
 * Optional parameters for `parseCSV`. A caller that passes nothing gets no
 * geocoding and no stats.
 */
export interface CsvReadOptions {
  /**
   * Photon-compatible geocoder used to resolve rows that have
   * an address column but no parseable lat/lng. When omitted, geocoding is
   * skipped entirely and the reader makes NO network calls.
   */
  geocoder?: PhotonGeocoder;
  /**
   * Called once, just before the FeatureCollection is returned, with the row
   * accounting for this import.
   *
   * CSV is the only format here that drops silently — a row whose lat/lng
   * won't parse and that can't be geocoded is skipped so one bad line can't
   * fail a 10k-row file. That is the right resilience trade, but it means the
   * FeatureCollection alone cannot say how much of the file made it. The
   * caller records `dropped` as layer provenance so the panel can show it
   * instead of the user discovering the gap by counting dots.
   */
  onStats?: (stats: CsvImportStats) => void;
  /** Called after each geocoded address, with the count done and the total. */
  onGeocodeProgress?: (done: number, total: number) => void;
}

/** Row accounting for one `parseCSV` call. `read = emitted + dropped`. */
export interface CsvImportStats {
  /** Data rows Papa produced (header excluded, blank lines skipped). */
  read: number;
  /** Features in the returned FeatureCollection. */
  emitted: number;
  /** Rows with no usable coordinates, geocoded or otherwise. */
  dropped: number;
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
const WKT_NAME_RE = /^(wkt|geometry|the_geom)$/i;

type CSVErrorCode =
  | "EMPTY_FILE"
  | "NO_COORD_COLUMNS"
  | "NO_VALID_WKT"
  | "PARSE_FAILED"
  | "PROJECTED_COORDINATES";

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

  const wktCol = headers.find((h) => WKT_NAME_RE.test(h.trim()));
  if (wktCol !== undefined) {
    return readWktRows(headers, rows, wktCol, opts);
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

  // If there are no coord columns but a geocoder + address column are
  // available, fall through to the geocoder pass instead of throwing.
  // Without a geocoder, throw.
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
  const numberColumns = numericColumns(headers, rows);
  /** A row whose coordinates are numbers off the globe, for the message. */
  let offGlobe: { lng: number; lat: number } | null = null;

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
      properties[key] = numberColumns.has(key)
        ? toFiniteNumber(row[key])
        : row[key];
    }
    if (addressCol !== undefined) {
      properties._addressColumn_v1 = addressCol;
    }

    if (!(latOk && lngOk) && lat !== null && lng !== null) {
      offGlobe ??= { lng, lat };
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
    // address value, defer to pass 2. Otherwise the row is dropped.
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
    let geocoded = 0;
    opts.onGeocodeProgress?.(0, pending.length);
    const resolved = await runWithConcurrency(
      pending,
      GEOCODE_MAX_CONCURRENCY,
      async (p) => {
        try {
          const r = await opts.geocoder!.geocode(p.address);
          opts.onGeocodeProgress?.(++geocoded, pending.length);
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
          opts.onGeocodeProgress?.(++geocoded, pending.length);
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

  if (features.length === 0 && offGlobe) {
    throw new CSVParseError(
      "PROJECTED_COORDINATES",
      `The columns ${lngCol} and ${latCol} hold values like ${offGlobe.lng}, ${offGlobe.lat}: ` +
        "these look like metres in a projected system, not longitude and " +
        "latitude. Convert the coordinates to longitude and latitude " +
        "(EPSG:4326) and import the file again.",
    );
  }

  opts?.onStats?.({
    read: rows.length,
    emitted: features.length,
    dropped: rows.length - features.length,
  });

  return { type: "FeatureCollection", features };
}

/**
 * One feature per row whose `wktCol` cell is a geometry; the other columns
 * are its properties. A row whose cell is not a geometry is dropped and
 * counted. A file with no geometry in the column at all is refused.
 */
function readWktRows(
  headers: string[],
  rows: Row[],
  wktCol: string,
  opts: CsvReadOptions | undefined,
): FeatureCollection {
  const numberColumns = numericColumns(headers, rows);
  const features: Feature[] = [];
  for (const row of rows) {
    const cell = row[wktCol];
    const geometry = typeof cell === "string" ? parseWKT(cell) : null;
    if (!geometry) {
      continue;
    }
    const properties: Record<string, unknown> = {};
    for (const key of headers) {
      if (key !== wktCol) {
        properties[key] = numberColumns.has(key)
          ? toFiniteNumber(row[key])
          : row[key];
      }
    }
    features.push({ type: "Feature", geometry, properties });
  }
  if (features.length === 0) {
    throw new CSVParseError(
      "NO_VALID_WKT",
      `No row of the column "${wktCol}" holds a geometry in Well-Known ` +
        "Text, for example POINT (30 10) or LINESTRING (30 10, 10 30).",
    );
  }
  opts?.onStats?.({
    read: rows.length,
    emitted: features.length,
    dropped: rows.length - features.length,
  });
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

const NUMBER_LITERAL_RE = /^[-+]?(\d+\.?\d*|\.\d+)([eE][-+]?\d+)?$/;
/** "02134" is a code, not a number: the zero would be lost. */
const LEADING_ZERO_RE = /^[-+]?0\d/;

/**
 * The columns whose every non-empty value is a number. Their values become
 * numbers (an empty cell becomes null), so a graduated style can use them.
 * A column with a code such as "02134" stays text.
 */
function numericColumns(headers: string[], rows: Row[]): Set<string> {
  const out = new Set<string>();
  for (const col of headers) {
    let any = false;
    let numeric = true;
    for (const row of rows) {
      const v = row[col];
      const text = typeof v === "string" ? v.trim() : "";
      if (text === "") {
        continue;
      }
      if (!NUMBER_LITERAL_RE.test(text) || LEADING_ZERO_RE.test(text)) {
        numeric = false;
        break;
      }
      any = true;
    }
    if (any && numeric) {
      out.add(col);
    }
  }
  return out;
}

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
