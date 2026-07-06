// SPDX-License-Identifier: AGPL-3.0-only
//
// Place-search backends for the toolbar geo-search control.
//
// The DEFAULT source is LocalPlaceIndex: a fully offline, zero-call-home search
// over public/data/places-index.json, which is prebuilt from the bundled world
// basemap pmtiles (see scripts/build-place-index.mjs). When an operator has
// configured a Photon endpoint (VITE_GEOCODER_ENDPOINT), PhotonSource is used
// instead for richer/address geocoding — an explicit opt-in to calling out.
//
// Both implement PlaceSearchSource so the hook/UI don't care which is active.

import { PhotonGeocoder } from "@atlasdraw/data";

/** A search result: where to fly and what to show. */
export interface PlaceHit {
  lng: number;
  lat: number;
  /** Display text (place name). */
  label: string;
  /** Coarse category for disambiguation + zoom ("country" | "region" | "locality" | …). */
  kind?: string;
  /** Ideal fly-to zoom for this result. */
  zoom: number;
}

export interface PlaceSearchSource {
  /** Return up to `limit` candidates, best first. Rejects on transport failure. */
  search(query: string, limit: number): Promise<PlaceHit[]>;
}

/** Shape of an entry in places-index.json (short keys keep the asset small). */
interface IndexedPlace {
  n: string; // name
  x: number; // lng
  y: number; // lat
  k: string; // kind
  r: number; // population_rank
}

/** Fly-to zoom by place kind — a country frames the whole nation, a city a metro. */
export function zoomForKind(kind: string | undefined): number {
  switch (kind) {
    case "country":
      return 4;
    case "region":
      return 6;
    default:
      return 11; // locality / city / anything else
  }
}

/** Fly-to zoom from a Photon 0..1 confidence (city vs street granularity). */
export function zoomForConfidence(confidence: number): number {
  if (confidence >= 0.9) {
    return 12;
  }
  if (confidence >= 0.6) {
    return 15;
  }
  return 13;
}

/**
 * Pure, synchronous ranked search over a pre-loaded place list. The list is
 * assumed pre-sorted by importance (population_rank desc), so within each match
 * tier we preserve order. Tiering: exact name > prefix > substring.
 */
export function searchPlaces(
  places: readonly IndexedPlace[],
  query: string,
  limit: number,
): PlaceHit[] {
  const q = query.trim().toLowerCase();
  if (q === "") {
    return [];
  }

  const exact: IndexedPlace[] = [];
  const prefix: IndexedPlace[] = [];
  const substr: IndexedPlace[] = [];

  for (const p of places) {
    const name = p.n.toLowerCase();
    if (name === q) {
      exact.push(p);
    } else if (name.startsWith(q)) {
      prefix.push(p);
    } else if (name.includes(q)) {
      substr.push(p);
    }
    // Cheap early-out: once we have plenty of exact+prefix hits, substring
    // matches won't outrank them, so we can stop scanning.
    if (exact.length + prefix.length >= limit && substr.length >= limit) {
      break;
    }
  }

  return [...exact, ...prefix, ...substr].slice(0, limit).map((p) => ({
    lng: p.x,
    lat: p.y,
    label: p.n,
    kind: p.k,
    zoom: zoomForKind(p.k),
  }));
}

/**
 * Offline place search over the prebuilt index JSON. Fetches once and caches
 * the parsed list; a failed fetch clears the cache so the next search retries.
 */
export class LocalPlaceIndex implements PlaceSearchSource {
  private placesPromise: Promise<readonly IndexedPlace[]> | null = null;

  constructor(
    private readonly url: string,
    // Bind the default to the global: calling `this.fetchImpl(...)` with an
    // unbound `window.fetch` throws "Illegal invocation" (fetch needs a window
    // `this`). Tests inject their own fetchImpl and are unaffected.
    private readonly fetchImpl: typeof fetch = globalThis.fetch.bind(
      globalThis,
    ),
  ) {}

  private load(): Promise<readonly IndexedPlace[]> {
    if (!this.placesPromise) {
      this.placesPromise = this.fetchImpl(this.url)
        .then((res) => {
          if (!res.ok) {
            throw new Error(`place index HTTP ${res.status}`);
          }
          return res.json();
        })
        .then((body) =>
          body && Array.isArray(body.places)
            ? (body.places as IndexedPlace[])
            : [],
        )
        .catch((err) => {
          this.placesPromise = null; // allow retry on next search
          throw err;
        });
    }
    return this.placesPromise;
  }

  async search(query: string, limit: number): Promise<PlaceHit[]> {
    const places = await this.load();
    return searchPlaces(places, query, limit);
  }
}

/** Photon-backed search (calls out). Used only when an endpoint is configured. */
export class PhotonSource implements PlaceSearchSource {
  private readonly geocoder: PhotonGeocoder;

  constructor(endpoint: string) {
    this.geocoder = new PhotonGeocoder({ endpoint });
  }

  async search(query: string, limit: number): Promise<PlaceHit[]> {
    const results = await this.geocoder.geocodeCandidates(query, limit);
    return results.map((r) => ({
      lng: r.lng,
      lat: r.lat,
      label: r.displayName,
      zoom: zoomForConfidence(r.confidence),
    }));
  }
}
