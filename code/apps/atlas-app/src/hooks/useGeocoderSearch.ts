// SPDX-License-Identifier: AGPL-3.0-only
//
// Interactive place-search: free-text query -> ranked candidates -> fly the
// MapLibre camera to the picked result. The logic half of the toolbar
// GeoSearchControl; the UI half lives in components/GeoSearchControl.tsx.
//
// Backend selection (see services/placeSearch.ts):
//   - DEFAULT: LocalPlaceIndex — fully offline search over the prebuilt
//     public/data/places-index.json (from the bundled world pmtiles). No
//     network, no call-home. Always available, so the control always renders.
//   - If VITE_GEOCODER_ENDPOINT is set: PhotonSource — richer/address geocoding
//     via the operator's endpoint (an explicit opt-in to calling out).

import { useCallback, useEffect, useMemo, useRef, useState } from "react";

import { GeocoderNetworkError, GeocoderResponseError } from "@atlasdraw/data";

import { getAppConfig } from "../config/app-config";
import {
  LocalPlaceIndex,
  PhotonSource,
  type PlaceHit,
  type PlaceSearchSource,
} from "../services/placeSearch";

import type maplibregl from "maplibre-gl";

export type { PlaceHit } from "../services/placeSearch";

export type GeoSearchStatus =
  | "idle" // query too short / empty
  | "loading" // request in flight (or debounce pending)
  | "success" // >=1 candidate
  | "empty" // request returned no matches
  | "error"; // load / network failure

export interface UseGeocoderSearchResult {
  /** Whether the control should render. Local search is always available. */
  enabled: boolean;
  query: string;
  /** Update the query; schedules a debounced candidate search. */
  setQuery: (query: string) => void;
  results: readonly PlaceHit[];
  status: GeoSearchStatus;
  errorMessage: string | null;
  /** Animate the map camera to a chosen candidate (kind-aware zoom). */
  flyTo: (hit: PlaceHit) => void;
  reset: () => void;
}

const DEBOUNCE_MS = 250; // local index is in-memory; short debounce feels snappy
const MIN_QUERY_LENGTH = 2;
const CANDIDATE_LIMIT = 8;

/** Pick the search backend: offline local index unless a geocoder is configured. */
function defaultSource(): PlaceSearchSource {
  const cfg = getAppConfig().geocoder;
  if (cfg) {
    return new PhotonSource(cfg.endpoint);
  }
  const base = import.meta.env.BASE_URL || "/";
  return new LocalPlaceIndex(`${base}data/places-index.json`);
}

export function useGeocoderSearch(
  map: maplibregl.Map | null,
  sourceOverride?: PlaceSearchSource,
): UseGeocoderSearchResult {
  const source = useMemo(
    () => sourceOverride ?? defaultSource(),
    [sourceOverride],
  );

  const [query, setQueryState] = useState("");
  const [results, setResults] = useState<readonly PlaceHit[]>([]);
  const [status, setStatus] = useState<GeoSearchStatus>("idle");
  const [errorMessage, setErrorMessage] = useState<string | null>(null);

  const debounceRef = useRef<ReturnType<typeof setTimeout> | null>(null);
  // Monotonic id so a slow response for a stale query can't clobber a newer one.
  const queryIdRef = useRef(0);

  const runSearch = useCallback(
    async (trimmed: string, queryId: number) => {
      try {
        const found = await source.search(trimmed, CANDIDATE_LIMIT);
        if (queryId !== queryIdRef.current) {
          return; // superseded
        }
        setResults(found);
        setStatus(found.length === 0 ? "empty" : "success");
        setErrorMessage(null);
      } catch (err) {
        if (queryId !== queryIdRef.current) {
          return;
        }
        setResults([]);
        setStatus("error");
        setErrorMessage(
          err instanceof GeocoderNetworkError
            ? "Couldn't reach the geocoder — check your connection."
            : err instanceof GeocoderResponseError
            ? `Geocoder error (HTTP ${err.status}).`
            : "Place search failed.",
        );
      }
    },
    [source],
  );

  const setQuery = useCallback(
    (next: string) => {
      setQueryState(next);
      const trimmed = next.trim();
      const queryId = ++queryIdRef.current;

      if (debounceRef.current) {
        clearTimeout(debounceRef.current);
        debounceRef.current = null;
      }

      if (trimmed.length < MIN_QUERY_LENGTH) {
        setResults([]);
        setStatus("idle");
        setErrorMessage(null);
        return;
      }

      setStatus("loading");
      debounceRef.current = setTimeout(() => {
        void runSearch(trimmed, queryId);
      }, DEBOUNCE_MS);
    },
    [runSearch],
  );

  const flyTo = useCallback(
    (hit: PlaceHit) => {
      if (!map) {
        return;
      }
      map.flyTo({ center: [hit.lng, hit.lat], zoom: hit.zoom });
    },
    [map],
  );

  const reset = useCallback(() => {
    if (debounceRef.current) {
      clearTimeout(debounceRef.current);
      debounceRef.current = null;
    }
    queryIdRef.current++; // invalidate any in-flight response
    setQueryState("");
    setResults([]);
    setStatus("idle");
    setErrorMessage(null);
  }, []);

  useEffect(() => {
    return () => {
      if (debounceRef.current) {
        clearTimeout(debounceRef.current);
      }
    };
  }, []);

  return {
    // Local search is always available (offline); nothing to gate on.
    enabled: true,
    query,
    setQuery,
    results,
    status,
    errorMessage,
    flyTo,
    reset,
  };
}
