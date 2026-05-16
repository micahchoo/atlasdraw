// SPDX-License-Identifier: MIT
// packages/data/src/geocode.test.ts
// Phase 6 A7 — colocated tests for PhotonGeocoder + LRU cache.

import { describe, expect, it, vi } from "vitest";

import {
  GeocoderNetworkError,
  GeocoderResponseError,
  PhotonGeocoder,
} from "./geocode.js";

// Build a minimal Photon-shaped FeatureCollection for a fetch mock.
function photonFC(
  features: Array<{
    coords: [number, number];
    name?: string;
    city?: string;
    country?: string;
    osm_value?: string;
  }>,
): unknown {
  return {
    type: "FeatureCollection",
    features: features.map((f) => ({
      type: "Feature",
      geometry: { type: "Point", coordinates: f.coords },
      properties: {
        name: f.name,
        city: f.city,
        country: f.country,
        osm_value: f.osm_value,
      },
    })),
  };
}

function okResponse(body: unknown): Response {
  return new Response(JSON.stringify(body), {
    status: 200,
    headers: { "content-type": "application/json" },
  });
}

describe("PhotonGeocoder — construction", () => {
  it("requires an endpoint (zero-call-home; ADR-0006 / ADR-0011)", () => {
    // @ts-expect-error — exercising the runtime guard.
    expect(() => new PhotonGeocoder({})).toThrow(/endpoint is required/);
    expect(() => new PhotonGeocoder({ endpoint: "" })).toThrow(
      /endpoint is required/,
    );
  });

  it("strips trailing slashes from the endpoint", async () => {
    const fetchMock = vi.fn(async () =>
      okResponse(photonFC([{ coords: [10, 20] }])),
    );
    const g = new PhotonGeocoder(
      { endpoint: "https://photon.example/" },
      fetchMock as unknown as typeof fetch,
    );
    await g.geocode("test");
    const firstCall = fetchMock.mock.calls[0] as unknown as [string];
    const calledUrl = firstCall?.[0] ?? "";
    expect(calledUrl).toMatch(/^https:\/\/photon\.example\/api\?/);
  });
});

describe("PhotonGeocoder.geocode — request shape", () => {
  it("hits ${endpoint}/api with q + limit, URL-encoding the query", async () => {
    const fetchMock = vi.fn(async () =>
      okResponse(photonFC([{ coords: [-74, 40.7], city: "New York" }])),
    );
    const g = new PhotonGeocoder(
      { endpoint: "https://photon.example", limitPerQuery: 3 },
      fetchMock as unknown as typeof fetch,
    );
    await g.geocode("Times Square, NYC");
    const firstCall = fetchMock.mock.calls[0] as unknown as [string];
    const url = firstCall[0];
    expect(url).toBe(
      "https://photon.example/api?q=Times%20Square%2C%20NYC&limit=3",
    );
  });

  it("returns the first feature mapped to {lng,lat,displayName,confidence}", async () => {
    const fetchMock = vi.fn(async () =>
      okResponse(
        photonFC([
          {
            coords: [13.4, 52.5],
            name: "Berlin",
            country: "Germany",
            osm_value: "city",
          },
        ]),
      ),
    );
    const g = new PhotonGeocoder(
      { endpoint: "https://photon.example" },
      fetchMock as unknown as typeof fetch,
    );
    const r = await g.geocode("Berlin");
    expect(r).not.toBeNull();
    expect(r!.lng).toBe(13.4);
    expect(r!.lat).toBe(52.5);
    expect(r!.displayName).toBe("Berlin, Germany");
    expect(r!.confidence).toBeGreaterThanOrEqual(0.9);
  });

  it("returns null on empty FeatureCollection", async () => {
    const fetchMock = vi.fn(async () => okResponse(photonFC([])));
    const g = new PhotonGeocoder(
      { endpoint: "https://photon.example" },
      fetchMock as unknown as typeof fetch,
    );
    expect(await g.geocode("nowhere")).toBeNull();
  });

  it("returns null on malformed geometry (missing coords)", async () => {
    const fetchMock = vi.fn(async () =>
      okResponse({
        type: "FeatureCollection",
        features: [{ type: "Feature", geometry: {}, properties: {} }],
      }),
    );
    const g = new PhotonGeocoder(
      { endpoint: "https://photon.example" },
      fetchMock as unknown as typeof fetch,
    );
    expect(await g.geocode("broken")).toBeNull();
  });
});

describe("PhotonGeocoder — confidence heuristic", () => {
  const cases: Array<[string, number, "≥" | "~"]> = [
    ["city", 0.9, "≥"],
    ["country", 0.9, "≥"],
    ["state", 0.9, "≥"],
    ["yes", 0.9, "≥"],
    ["street", 0.6, "~"],
    ["residential", 0.6, "~"],
    ["unknown-foo", 0.4, "~"],
  ];

  for (const [osmValue, expected, mode] of cases) {
    it(`osm_value=${osmValue} → confidence ${mode === "≥" ? "≥" : "~"} ${expected}`, async () => {
      const fetchMock = vi.fn(async () =>
        okResponse(photonFC([{ coords: [0, 0], osm_value: osmValue }])),
      );
      const g = new PhotonGeocoder(
        { endpoint: "https://photon.example" },
        fetchMock as unknown as typeof fetch,
      );
      const r = await g.geocode(`q-${osmValue}`);
      expect(r).not.toBeNull();
      if (mode === "≥") expect(r!.confidence).toBeGreaterThanOrEqual(expected);
      else expect(r!.confidence).toBeCloseTo(expected, 5);
    });
  }
});

describe("PhotonGeocoder — caching", () => {
  it("a repeated query hits the cache (fetch called once)", async () => {
    const fetchMock = vi.fn(async () =>
      okResponse(photonFC([{ coords: [1, 2], osm_value: "city" }])),
    );
    const g = new PhotonGeocoder(
      { endpoint: "https://photon.example" },
      fetchMock as unknown as typeof fetch,
    );
    await g.geocode("Paris");
    await g.geocode("paris"); // case-insensitive key
    await g.geocode("  Paris  "); // whitespace-trimmed key
    expect(fetchMock).toHaveBeenCalledTimes(1);
    const stats = g.cacheStats();
    expect(stats.size).toBe(1);
    expect(stats.hits).toBe(2);
    expect(stats.misses).toBe(1);
  });

  it("null results are cached (don't re-hit on known-bad addresses)", async () => {
    const fetchMock = vi.fn(async () => okResponse(photonFC([])));
    const g = new PhotonGeocoder(
      { endpoint: "https://photon.example" },
      fetchMock as unknown as typeof fetch,
    );
    expect(await g.geocode("blank")).toBeNull();
    expect(await g.geocode("blank")).toBeNull();
    expect(fetchMock).toHaveBeenCalledTimes(1);
  });

  it("evicts oldest when size exceeds cacheSize", async () => {
    let i = 0;
    const fetchMock = vi.fn(async () => {
      i++;
      return okResponse(photonFC([{ coords: [i, i], osm_value: "city" }]));
    });
    const g = new PhotonGeocoder(
      { endpoint: "https://photon.example", cacheSize: 2 },
      fetchMock as unknown as typeof fetch,
    );
    await g.geocode("a"); // [a]
    await g.geocode("b"); // [a, b]
    await g.geocode("c"); // [b, c]  ← a evicted
    expect(g.cacheStats().size).toBe(2);

    // 'a' was evicted — a fresh fetch should fire.
    await g.geocode("a");
    expect(fetchMock).toHaveBeenCalledTimes(4);

    // 'b' was evicted by 'a' becoming MRU again — verify by re-querying.
    await g.geocode("b");
    expect(fetchMock).toHaveBeenCalledTimes(5);
  });

  it("empty / whitespace-only queries short-circuit to null without a fetch", async () => {
    const fetchMock = vi.fn();
    const g = new PhotonGeocoder(
      { endpoint: "https://photon.example" },
      fetchMock as unknown as typeof fetch,
    );
    expect(await g.geocode("")).toBeNull();
    expect(await g.geocode("   ")).toBeNull();
    expect(fetchMock).not.toHaveBeenCalled();
  });
});

describe("PhotonGeocoder — error paths", () => {
  it("throws GeocoderNetworkError when fetch rejects", async () => {
    const fetchMock = vi.fn(async () => {
      throw new TypeError("ECONNREFUSED");
    });
    const g = new PhotonGeocoder(
      { endpoint: "https://photon.example" },
      fetchMock as unknown as typeof fetch,
    );
    await expect(g.geocode("Berlin")).rejects.toBeInstanceOf(
      GeocoderNetworkError,
    );
  });

  it("throws GeocoderResponseError on non-2xx response", async () => {
    const fetchMock = vi.fn(
      async () =>
        new Response("Bad Request", { status: 400 }),
    );
    const g = new PhotonGeocoder(
      { endpoint: "https://photon.example" },
      fetchMock as unknown as typeof fetch,
    );
    await expect(g.geocode("Berlin")).rejects.toMatchObject({
      name: "GeocoderResponseError",
      status: 400,
    });
  });

  it("throws GeocoderResponseError on non-JSON body", async () => {
    const fetchMock = vi.fn(
      async () =>
        new Response("<html>oops</html>", {
          status: 200,
          headers: { "content-type": "text/html" },
        }),
    );
    const g = new PhotonGeocoder(
      { endpoint: "https://photon.example" },
      fetchMock as unknown as typeof fetch,
    );
    await expect(g.geocode("Berlin")).rejects.toBeInstanceOf(
      GeocoderResponseError,
    );
  });
});
