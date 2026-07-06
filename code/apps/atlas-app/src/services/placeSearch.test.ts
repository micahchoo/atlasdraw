// SPDX-License-Identifier: AGPL-3.0-only
// Tests for the offline place-search core: ranked matching, kind-aware zoom,
// and the LocalPlaceIndex fetch/cache/retry behavior.
//
// Per .claude/rules/test-fixtures.md: this file owns its own fixtures.

import { describe, it, expect, vi } from "vitest";

import {
  LocalPlaceIndex,
  searchPlaces,
  zoomForKind,
  zoomForConfidence,
} from "./placeSearch";

// Pre-sorted by population_rank desc, as the real index JSON is.
const PLACES = [
  { n: "India", x: 78.9, y: 22.0, k: "country", r: 18 },
  { n: "Paris", x: 2.3522, y: 48.8566, k: "locality", r: 13 },
  { n: "Paradise", x: -115.14, y: 36.09, k: "locality", r: 7 },
  { n: "Paris", x: -95.5555, y: 33.6609, k: "locality", r: 6 }, // Paris, Texas
];

describe("searchPlaces — matching + ranking", () => {
  it("returns [] for an empty query", () => {
    expect(searchPlaces(PLACES, "", 8)).toEqual([]);
    expect(searchPlaces(PLACES, "   ", 8)).toEqual([]);
  });

  it("returns exact matches, higher population first", () => {
    const hits = searchPlaces(PLACES, "paris", 8);
    expect(hits).toHaveLength(2);
    expect(hits[0].label).toBe("Paris");
    expect(hits[0].lng).toBe(2.3522); // the rank-13 Paris (France) leads
    expect(hits[1].lng).toBe(-95.5555); // rank-6 Paris (Texas)
  });

  it("orders exact > prefix > substring", () => {
    // 'par' prefixes all three localities; ordered by rank within the tier.
    const hits = searchPlaces(PLACES, "par", 8);
    expect(hits.map((h) => `${h.label}@${h.lng}`)).toEqual([
      "Paris@2.3522",
      "Paradise@-115.14",
      "Paris@-95.5555",
    ]);
  });

  it("matches substrings when there is no prefix match", () => {
    const hits = searchPlaces(PLACES, "aris", 8);
    expect(hits.map((h) => h.label)).toEqual(["Paris", "Paris"]);
  });

  it("is case-insensitive", () => {
    expect(searchPlaces(PLACES, "PARIS", 8)).toHaveLength(2);
  });

  it("respects the limit", () => {
    expect(searchPlaces(PLACES, "par", 2)).toHaveLength(2);
  });

  it("maps an index entry to a PlaceHit with kind-aware zoom", () => {
    const [india] = searchPlaces(PLACES, "india", 8);
    expect(india).toEqual({
      lng: 78.9,
      lat: 22.0,
      label: "India",
      kind: "country",
      zoom: 4, // country frames the whole nation
    });
  });
});

describe("zoom heuristics", () => {
  it("zoomForKind: country < region < city", () => {
    expect(zoomForKind("country")).toBe(4);
    expect(zoomForKind("region")).toBe(6);
    expect(zoomForKind("locality")).toBe(11);
    expect(zoomForKind(undefined)).toBe(11);
  });

  it("zoomForConfidence: city vs street", () => {
    expect(zoomForConfidence(0.9)).toBe(12);
    expect(zoomForConfidence(0.6)).toBe(15);
    expect(zoomForConfidence(0.4)).toBe(13);
  });
});

describe("LocalPlaceIndex — fetch, cache, retry", () => {
  const okResponse = (body: unknown) =>
    ({ ok: true, json: async () => body } as Response);

  it("fetches the index once and serves later searches from cache", async () => {
    const fetchImpl = vi.fn(async () => okResponse({ v: 1, places: PLACES }));
    const idx = new LocalPlaceIndex("/data/places-index.json", fetchImpl);

    expect(await idx.search("paris", 8)).toHaveLength(2);
    expect(await idx.search("india", 8)).toHaveLength(1);
    expect(fetchImpl).toHaveBeenCalledTimes(1); // cached across searches
  });

  it("tolerates a malformed body (no places array) → empty results", async () => {
    const fetchImpl = vi.fn(async () => okResponse({ nope: true }));
    const idx = new LocalPlaceIndex("/data/places-index.json", fetchImpl);
    expect(await idx.search("paris", 8)).toEqual([]);
  });

  it("rejects on a non-ok response and retries on the next search", async () => {
    const fetchImpl = vi
      .fn()
      .mockResolvedValueOnce({ ok: false, status: 500 } as Response)
      .mockResolvedValueOnce(okResponse({ v: 1, places: PLACES }));
    const idx = new LocalPlaceIndex("/data/places-index.json", fetchImpl);

    await expect(idx.search("paris", 8)).rejects.toThrow(/500/);
    // cache was cleared → a fresh fetch on the next attempt succeeds
    expect(await idx.search("paris", 8)).toHaveLength(2);
    expect(fetchImpl).toHaveBeenCalledTimes(2);
  });

  it("falls back to the global fetch when none is injected", async () => {
    // Guards the "Illegal invocation" regression: the default fetchImpl must be
    // the (bound) global fetch, not left unset/unbound.
    const spy = vi.fn(async () => okResponse({ v: 1, places: PLACES }));
    vi.stubGlobal("fetch", spy);
    try {
      const idx = new LocalPlaceIndex("/data/places-index.json"); // no injection
      expect(await idx.search("paris", 8)).toHaveLength(2);
      expect(spy).toHaveBeenCalledWith("/data/places-index.json");
    } finally {
      vi.unstubAllGlobals();
    }
  });
});
