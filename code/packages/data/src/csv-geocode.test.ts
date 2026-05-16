// SPDX-License-Identifier: MIT
// packages/data/src/csv-geocode.test.ts
// Phase 6 A8 — integration tests for CSV + geocoder wire-up.

import { describe, expect, it, vi } from "vitest";

import { parseCSV } from "./csv.js";
import { PhotonGeocoder } from "./geocode.js";

const csvBlob = (text: string): Blob => new Blob([text], { type: "text/csv" });

function photonOk(coords: [number, number], osmValue = "city"): Response {
  return new Response(
    JSON.stringify({
      type: "FeatureCollection",
      features: [
        {
          type: "Feature",
          geometry: { type: "Point", coordinates: coords },
          properties: { name: "Result", osm_value: osmValue },
        },
      ],
    }),
    { status: 200, headers: { "content-type": "application/json" } },
  );
}

function photonEmpty(): Response {
  return new Response(
    JSON.stringify({ type: "FeatureCollection", features: [] }),
    { status: 200, headers: { "content-type": "application/json" } },
  );
}

describe("parseCSV — geocoder OFF (pre-A8 behaviour preserved)", () => {
  it("does NOT call fetch when no geocoder is passed", async () => {
    // Spy on globalThis.fetch — if anyone bypasses our injected stub, this
    // will fail the test. Critical for the zero-call-home audit.
    const fetchSpy = vi.spyOn(globalThis, "fetch");
    try {
      const fc = await parseCSV(
        csvBlob("address,name\n1 Main St,Foo\n2 Other St,Bar"),
      );
      // No coord columns → previously this would throw, but a CSV with
      // only an address column + no geocoder still throws.
      expect.fail("expected NO_COORD_COLUMNS when geocoder absent");
      expect(fc).toBeDefined(); // unreachable
    } catch (err) {
      expect((err as Error).name).toBe("CSVParseError");
    }
    expect(fetchSpy).not.toHaveBeenCalled();
    fetchSpy.mockRestore();
  });

  it("with lat/lng + address but no geocoder, still no fetch", async () => {
    const fetchSpy = vi.spyOn(globalThis, "fetch");
    const fc = await parseCSV(
      csvBlob("lat,lng,address\n40,-74,Times Sq\n34,-118,Hollywood"),
    );
    expect(fc.features).toHaveLength(2);
    expect(fetchSpy).not.toHaveBeenCalled();
    fetchSpy.mockRestore();
  });
});

describe("parseCSV — geocoder ON", () => {
  it("geocodes rows missing lat/lng but with an address", async () => {
    const fetchMock = vi.fn(async () => photonOk([10, 20]));
    const g = new PhotonGeocoder(
      { endpoint: "https://photon.example" },
      fetchMock as unknown as typeof fetch,
    );
    const fc = await parseCSV(
      csvBlob("address,name\n1 Main St,Foo\n2 Other St,Bar"),
      { geocoder: g },
    );
    expect(fc.features).toHaveLength(2);
    expect(fc.features[0]!.geometry).toEqual({
      type: "Point",
      coordinates: [10, 20],
    });
    expect((fc.features[0]!.properties as Record<string, unknown>)._geocoded_v1).toBe(
      true,
    );
    expect(fetchMock).toHaveBeenCalledTimes(2);
  });

  it("prefers explicit lat/lng over geocoding when both present", async () => {
    const fetchMock = vi.fn(async () => photonOk([999, 999]));
    const g = new PhotonGeocoder(
      { endpoint: "https://photon.example" },
      fetchMock as unknown as typeof fetch,
    );
    const fc = await parseCSV(
      csvBlob("lat,lng,address\n40,-74,Should-be-ignored"),
      { geocoder: g },
    );
    expect(fc.features).toHaveLength(1);
    expect(fc.features[0]!.geometry).toEqual({
      type: "Point",
      coordinates: [-74, 40],
    });
    expect(fetchMock).not.toHaveBeenCalled();
  });

  it("mixed: lat/lng for some rows, geocode the rest", async () => {
    const fetchMock = vi.fn(async () => photonOk([10, 20]));
    const g = new PhotonGeocoder(
      { endpoint: "https://photon.example" },
      fetchMock as unknown as typeof fetch,
    );
    const fc = await parseCSV(
      csvBlob(
        "lat,lng,address,name\n40,-74,Skip,A\n,,Resolve me,B\n34,-118,Skip,C",
      ),
      { geocoder: g },
    );
    expect(fc.features).toHaveLength(3);
    expect(fetchMock).toHaveBeenCalledTimes(1);
  });

  it("null geocode result → row skipped (no throw)", async () => {
    const fetchMock = vi.fn(async () => photonEmpty());
    const g = new PhotonGeocoder(
      { endpoint: "https://photon.example" },
      fetchMock as unknown as typeof fetch,
    );
    const fc = await parseCSV(
      csvBlob("address,name\nbogus,Foo\nfake,Bar"),
      { geocoder: g },
    );
    expect(fc.features).toHaveLength(0);
  });

  it("geocoder throwing on a row → row skipped, others succeed", async () => {
    let i = 0;
    const fetchMock = vi.fn(async () => {
      i++;
      if (i === 1) throw new TypeError("ECONNREFUSED");
      return photonOk([10, 20]);
    });
    const g = new PhotonGeocoder(
      { endpoint: "https://photon.example" },
      fetchMock as unknown as typeof fetch,
    );
    const fc = await parseCSV(
      csvBlob("address,name\nfails,A\nworks,B"),
      { geocoder: g },
    );
    // With max-concurrency 5 and 2 rows, both fire in parallel; the failing
    // one drops, the other succeeds. Order is preserved by runWithConcurrency.
    expect(fc.features).toHaveLength(1);
  });

  it("rows with empty address are silently skipped, no fetch", async () => {
    const fetchMock = vi.fn(async () => photonOk([10, 20]));
    const g = new PhotonGeocoder(
      { endpoint: "https://photon.example" },
      fetchMock as unknown as typeof fetch,
    );
    const fc = await parseCSV(
      csvBlob("address,name\n,Foo\n   ,Bar\nReal Address,Baz"),
      { geocoder: g },
    );
    expect(fc.features).toHaveLength(1);
    expect(fetchMock).toHaveBeenCalledTimes(1);
  });

  it("concurrency cap: at most 5 in-flight fetches", async () => {
    let inFlight = 0;
    let peak = 0;
    const fetchMock = vi.fn(async () => {
      inFlight++;
      peak = Math.max(peak, inFlight);
      // Yield so other tasks can ramp before this one resolves.
      await new Promise((r) => setTimeout(r, 5));
      inFlight--;
      return photonOk([1, 1]);
    });
    const g = new PhotonGeocoder(
      { endpoint: "https://photon.example" },
      fetchMock as unknown as typeof fetch,
    );
    // 20 unique rows → 20 fetches required, must not exceed cap of 5.
    const rows: string[] = [];
    for (let i = 0; i < 20; i++) rows.push(`addr-${i},name${i}`);
    const fc = await parseCSV(
      csvBlob(`address,name\n${rows.join("\n")}`),
      { geocoder: g },
    );
    expect(fc.features).toHaveLength(20);
    expect(fetchMock).toHaveBeenCalledTimes(20);
    expect(peak).toBeLessThanOrEqual(5);
    expect(peak).toBeGreaterThan(1); // must actually parallelize
  });

  it("does not throw NO_COORD_COLUMNS when address+geocoder available", async () => {
    const fetchMock = vi.fn(async () => photonOk([1, 2]));
    const g = new PhotonGeocoder(
      { endpoint: "https://photon.example" },
      fetchMock as unknown as typeof fetch,
    );
    await expect(
      parseCSV(csvBlob("address,name\nfoo,Bar"), { geocoder: g }),
    ).resolves.toBeDefined();
  });
});
