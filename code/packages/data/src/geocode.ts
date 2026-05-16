// SPDX-License-Identifier: MIT
// packages/data/src/geocode.ts
// Phase 6 A7 — Photon-compatible geocoder client + in-process LRU cache.
//
// Pure module. Single dependency surface is the global `fetch`. No SDK,
// no node-fetch polyfill — Vite/jsdom/Node 18+ all provide native fetch.
//
// CALL-HOME POLICY (ADR-0006 telemetry, ADR-0011 hosted-mode telemetry):
//   The Photon endpoint is OPERATOR-CONFIGURED and OPT-IN. There is NO
//   default endpoint. Constructing a `PhotonGeocoder` requires the caller
//   to supply an endpoint URL — there's nowhere for atlasdraw itself to
//   "phone home" because no URL is baked into this module. Self-hosters
//   opt in by setting `VITE_GEOCODER_ENDPOINT` (atlas-app build) or the
//   `[geocoder] endpoint = "..."` stanza in `config.toml` (compose).
//
// Photon API shape (https://photon.komoot.io/):
//   GET ${endpoint}/api?q=<encoded>&limit=<n>
//   → GeoJSON FeatureCollection. Each feature:
//        geometry.coordinates: [lng, lat]
//        properties.name, properties.city, properties.country
//        properties.osm_value: e.g. "city" | "town" | "street" | "yes" | ...
//
// Compatible servers: Nominatim's Photon fork, Pelias (with a thin shim —
// out of scope here; v1 targets Photon-shape JSON only).

/** A successful geocode result. */
export interface GeocodeResult {
  /** Longitude (WGS84). */
  lng: number;
  /** Latitude (WGS84). */
  lat: number;
  /** Human-readable place name assembled from Photon properties. */
  displayName: string;
  /**
   * 0..1 heuristic confidence derived from `osm_value`. NOT a standardized
   * Photon field — see `confidenceFromOsmValue` for the mapping table.
   */
  confidence: number;
}

/** Geocoder construction config. */
export interface GeocoderConfig {
  /**
   * Photon-compatible base URL — e.g. "https://photon.komoot.io" or a
   * self-hosted instance. NO trailing slash required; we strip one if
   * present. Required: there is no default per ADR-0006 + ADR-0011.
   */
  endpoint: string;
  /** Max in-memory cache entries. Default 500. */
  cacheSize?: number;
  /** Optional `limit` query param. Default 1 (we only consume the first). */
  limitPerQuery?: number;
}

/** Thrown when the underlying `fetch` rejects (offline, DNS, abort, etc). */
export class GeocoderNetworkError extends Error {
  readonly cause?: unknown;
  constructor(message: string, cause?: unknown) {
    super(message);
    this.name = "GeocoderNetworkError";
    this.cause = cause;
  }
}

/** Thrown when the server returns a non-2xx response. */
export class GeocoderResponseError extends Error {
  readonly status: number;
  constructor(status: number, message: string) {
    super(message);
    this.name = "GeocoderResponseError";
    this.status = status;
  }
}

/**
 * Confidence heuristic. Photon doesn't return a confidence score, so we
 * synthesize one from `osm_value`. Tuned for the CSV-import use case:
 * a city/state/country match is "high confidence" because the geocoder
 * could anchor to an administrative boundary; a street match is medium
 * (block-level accuracy varies); anything else falls to the floor.
 *
 * Not standardized — consumers should treat the score as advisory.
 */
function confidenceFromOsmValue(osmValue: unknown): number {
  if (typeof osmValue !== "string") return 0.4;
  const v = osmValue.toLowerCase();
  if (v === "yes") return 0.9; // Photon's catch-all for high-confidence POIs
  if (
    v === "city" ||
    v === "town" ||
    v === "village" ||
    v === "state" ||
    v === "country" ||
    v === "administrative"
  ) {
    return 0.9;
  }
  if (
    v === "street" ||
    v === "residential" ||
    v === "tertiary" ||
    v === "secondary" ||
    v === "primary"
  ) {
    return 0.6;
  }
  return 0.4;
}

function buildDisplayName(props: Record<string, unknown> | undefined): string {
  if (!props) return "";
  const parts: string[] = [];
  for (const key of ["name", "city", "country"] as const) {
    const v = props[key];
    if (typeof v === "string" && v.trim() !== "") {
      parts.push(v.trim());
    }
  }
  return parts.join(", ");
}

// ---------------------------------------------------------------------------
// Inline LRU — Map preserves insertion order, so re-inserting on access
// moves a key to "most recently used". When size > cap, delete the first
// (oldest) key. ~20 lines, no dep.

class LruCache<V> {
  private readonly cap: number;
  private readonly map = new Map<string, V>();
  hits = 0;
  misses = 0;

  constructor(cap: number) {
    this.cap = Math.max(1, cap);
  }

  get(key: string): V | undefined {
    const v = this.map.get(key);
    if (v === undefined) {
      this.misses++;
      return undefined;
    }
    // Move-to-most-recent.
    this.map.delete(key);
    this.map.set(key, v);
    this.hits++;
    return v;
  }

  set(key: string, value: V): void {
    if (this.map.has(key)) this.map.delete(key);
    this.map.set(key, value);
    if (this.map.size > this.cap) {
      const oldest = this.map.keys().next().value;
      if (oldest !== undefined) this.map.delete(oldest);
    }
  }

  get size(): number {
    return this.map.size;
  }
}

// ---------------------------------------------------------------------------

const DEFAULT_CACHE_SIZE = 500;
const DEFAULT_LIMIT = 1;

/**
 * Stateful Photon geocoder. Construct once per session and reuse — the
 * LRU cache lives inside the instance so repeated CSV imports of the
 * same address (common in real datasets) hit the cache.
 */
export class PhotonGeocoder {
  private readonly endpoint: string;
  private readonly limitPerQuery: number;
  private readonly cache: LruCache<GeocodeResult | null>;
  // Allow tests to inject a fetch stub; defaults to globalThis.fetch.
  private readonly fetchImpl: typeof fetch;

  constructor(config: GeocoderConfig, fetchImpl?: typeof fetch) {
    if (!config.endpoint || typeof config.endpoint !== "string") {
      throw new Error(
        "PhotonGeocoder: endpoint is required. " +
          "No default is provided per ADR-0006 / ADR-0011 (zero call-home).",
      );
    }
    this.endpoint = config.endpoint.replace(/\/+$/, "");
    this.limitPerQuery = config.limitPerQuery ?? DEFAULT_LIMIT;
    this.cache = new LruCache<GeocodeResult | null>(
      config.cacheSize ?? DEFAULT_CACHE_SIZE,
    );
    this.fetchImpl = fetchImpl ?? globalThis.fetch.bind(globalThis);
  }

  /**
   * Geocode a free-text address. Returns `null` when the server returns
   * an empty feature collection. Throws `GeocoderNetworkError` on transport
   * failure and `GeocoderResponseError` on non-2xx.
   *
   * Cache key: `query.toLowerCase().trim()`. Null results ARE cached so a
   * known-bad address doesn't hammer the endpoint on every retry.
   */
  async geocode(query: string): Promise<GeocodeResult | null> {
    const key = query.toLowerCase().trim();
    if (key === "") return null;

    const cached = this.cache.get(key);
    if (cached !== undefined) return cached;

    // Note: the operator-configured endpoint is the only outbound URL.
    // See ADR-0006 / ADR-0011 — atlasdraw never calls home; this fetch
    // only fires when an operator has opted in by supplying `endpoint`.
    const url = `${this.endpoint}/api?q=${encodeURIComponent(query)}&limit=${this.limitPerQuery}`;

    let res: Response;
    try {
      res = await this.fetchImpl(url);
    } catch (err) {
      throw new GeocoderNetworkError(
        `Geocoder fetch failed for ${JSON.stringify(query)}: ${
          err instanceof Error ? err.message : String(err)
        }`,
        err,
      );
    }

    if (!res.ok) {
      throw new GeocoderResponseError(
        res.status,
        `Geocoder returned HTTP ${res.status} for ${JSON.stringify(query)}.`,
      );
    }

    let body: unknown;
    try {
      body = await res.json();
    } catch (err) {
      throw new GeocoderResponseError(
        res.status,
        `Geocoder returned non-JSON body: ${
          err instanceof Error ? err.message : String(err)
        }`,
      );
    }

    const result = parsePhotonResponse(body);
    this.cache.set(key, result);
    return result;
  }

  /** Cache stats for tests / debug. */
  cacheStats(): { size: number; hits: number; misses: number } {
    return {
      size: this.cache.size,
      hits: this.cache.hits,
      misses: this.cache.misses,
    };
  }
}

// ---------------------------------------------------------------------------
// internal

interface PhotonFeature {
  geometry?: { coordinates?: unknown };
  properties?: Record<string, unknown>;
}

function parsePhotonResponse(body: unknown): GeocodeResult | null {
  if (!body || typeof body !== "object") return null;
  const features = (body as { features?: unknown }).features;
  if (!Array.isArray(features) || features.length === 0) return null;

  const first = features[0] as PhotonFeature;
  const coords = first.geometry?.coordinates;
  if (!Array.isArray(coords) || coords.length < 2) return null;
  const lng = coords[0];
  const lat = coords[1];
  if (typeof lng !== "number" || typeof lat !== "number") return null;
  if (!Number.isFinite(lng) || !Number.isFinite(lat)) return null;

  return {
    lng,
    lat,
    displayName: buildDisplayName(first.properties),
    confidence: confidenceFromOsmValue(first.properties?.osm_value),
  };
}
