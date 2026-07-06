// SPDX-License-Identifier: AGPL-3.0-only
// Tests for useGeocoderSearch — debounced place search + camera fly-to.
//
// The hook takes an injectable PlaceSearchSource, so we drive it with a fake
// source (no module mocking needed). The search backends themselves are tested
// in services/placeSearch.test.ts.
//
// Per .claude/rules/test-fixtures.md: this file owns its own fixtures.

import { describe, it, expect, vi, beforeEach, afterEach } from "vitest";
import { renderHook, act, cleanup } from "@testing-library/react";

import { useGeocoderSearch } from "./useGeocoderSearch";

import type maplibregl from "maplibre-gl";

import type { PlaceHit, PlaceSearchSource } from "../services/placeSearch";

function makeMap(): maplibregl.Map {
  return { flyTo: vi.fn() } as unknown as maplibregl.Map;
}

const hit = (over: Partial<PlaceHit> = {}): PlaceHit => ({
  lng: 2.3522,
  lat: 48.8566,
  label: "Paris",
  kind: "locality",
  zoom: 11,
  ...over,
});

let search: ReturnType<typeof vi.fn>;
let source: PlaceSearchSource;

beforeEach(() => {
  vi.useFakeTimers();
  search = vi.fn();
  source = { search };
});

afterEach(() => {
  vi.useRealTimers();
  cleanup();
});

describe("useGeocoderSearch — availability", () => {
  it("is always enabled (offline local search needs no endpoint)", () => {
    const { result } = renderHook(() => useGeocoderSearch(makeMap(), source));
    expect(result.current.enabled).toBe(true);
  });
});

describe("useGeocoderSearch — query lifecycle", () => {
  it("stays idle and does not search for queries below the min length", () => {
    const { result } = renderHook(() => useGeocoderSearch(makeMap(), source));
    act(() => result.current.setQuery("a"));
    expect(result.current.status).toBe("idle");
    expect(search).not.toHaveBeenCalled();
  });

  it("debounces, then populates results and status=success", async () => {
    search.mockResolvedValue([hit({ label: "Paris" })]);
    const { result } = renderHook(() => useGeocoderSearch(makeMap(), source));

    act(() => result.current.setQuery("paris"));
    expect(result.current.status).toBe("loading");
    expect(search).not.toHaveBeenCalled(); // within debounce

    await act(async () => {
      await vi.advanceTimersByTimeAsync(250);
    });

    expect(search).toHaveBeenCalledTimes(1);
    expect(search).toHaveBeenCalledWith("paris", expect.any(Number));
    expect(result.current.status).toBe("success");
    expect(result.current.results).toHaveLength(1);
    expect(result.current.results[0].label).toBe("Paris");
  });

  it("collapses rapid keystrokes into a single request (debounce)", async () => {
    search.mockResolvedValue([]);
    const { result } = renderHook(() => useGeocoderSearch(makeMap(), source));

    act(() => result.current.setQuery("par"));
    act(() => result.current.setQuery("pari"));
    act(() => result.current.setQuery("paris"));

    await act(async () => {
      await vi.advanceTimersByTimeAsync(250);
    });

    expect(search).toHaveBeenCalledTimes(1);
    expect(search).toHaveBeenCalledWith("paris", expect.any(Number));
  });

  it("reports status=empty when the source returns no matches", async () => {
    search.mockResolvedValue([]);
    const { result } = renderHook(() => useGeocoderSearch(makeMap(), source));
    act(() => result.current.setQuery("zzzzz"));
    await act(async () => {
      await vi.advanceTimersByTimeAsync(250);
    });
    expect(result.current.status).toBe("empty");
    expect(result.current.results).toEqual([]);
  });

  it("reset clears query, results and status back to idle", async () => {
    search.mockResolvedValue([hit()]);
    const { result } = renderHook(() => useGeocoderSearch(makeMap(), source));
    act(() => result.current.setQuery("paris"));
    await act(async () => {
      await vi.advanceTimersByTimeAsync(250);
    });
    expect(result.current.status).toBe("success");

    act(() => result.current.reset());
    expect(result.current.query).toBe("");
    expect(result.current.results).toEqual([]);
    expect(result.current.status).toBe("idle");
  });
});

describe("useGeocoderSearch — error handling", () => {
  it("sets status=error with a message when the source rejects", async () => {
    search.mockRejectedValue(new Error("place index HTTP 404"));
    const { result } = renderHook(() => useGeocoderSearch(makeMap(), source));
    act(() => result.current.setQuery("paris"));
    await act(async () => {
      await vi.advanceTimersByTimeAsync(250);
    });
    expect(result.current.status).toBe("error");
    expect(result.current.errorMessage).toBeTruthy();
  });
});

describe("useGeocoderSearch — flyTo", () => {
  it("flies to the hit's [lng, lat] using its kind-aware zoom", () => {
    const map = makeMap();
    const { result } = renderHook(() => useGeocoderSearch(map, source));
    act(() =>
      result.current.flyTo(hit({ lng: -122.68, lat: 45.52, zoom: 11 })),
    );
    expect(map.flyTo).toHaveBeenCalledTimes(1);
    const opts = (map.flyTo as unknown as ReturnType<typeof vi.fn>).mock
      .calls[0][0];
    expect(opts.center).toEqual([-122.68, 45.52]);
    expect(opts.zoom).toBe(11);
  });

  it("no-ops when the map is not ready (null)", () => {
    const { result } = renderHook(() => useGeocoderSearch(null, source));
    act(() => result.current.flyTo(hit()));
    expect(result.current.enabled).toBe(true);
  });
});
