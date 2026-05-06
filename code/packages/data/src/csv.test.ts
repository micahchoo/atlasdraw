// SPDX-License-Identifier: MIT
// packages/data/src/csv.test.ts
// Phase 3 Wave 1 Task 6 — colocated tests for CSV parser.

import { describe, expect, it } from "vitest";

import {
  CSVParseError,
  CSV_HEURISTIC_THRESHOLD,
  CSV_HEURISTIC_THRESHOLD_SMALL_DATASET,
  parseCSV,
} from "./csv.js";

const csvBlob = (text: string): Blob =>
  new Blob([text], { type: "text/csv" });

describe("parseCSV — header-name detection", () => {
  it("detects lat/lng headers", async () => {
    const fc = await parseCSV(
      csvBlob("lat,lng,name\n40.7,-74,NYC\n34.0,-118,LA"),
    );
    expect(fc.type).toBe("FeatureCollection");
    expect(fc.features).toHaveLength(2);
    const f = fc.features[0]!;
    expect(f.geometry).toEqual({ type: "Point", coordinates: [-74, 40.7] });
    expect(f.properties).toEqual({ name: "NYC" });
  });

  it("detects latitude/longitude headers", async () => {
    const fc = await parseCSV(
      csvBlob("latitude,longitude,city\n40.7,-74,NYC"),
    );
    expect(fc.features).toHaveLength(1);
    expect(fc.features[0]!.geometry).toEqual({
      type: "Point",
      coordinates: [-74, 40.7],
    });
  });

  it("detects y/x headers", async () => {
    const fc = await parseCSV(csvBlob("y,x,name\n40.7,-74,NYC"));
    expect(fc.features).toHaveLength(1);
    expect(fc.features[0]!.geometry).toEqual({
      type: "Point",
      coordinates: [-74, 40.7],
    });
  });

  it("detects case-insensitive headers", async () => {
    const fc = await parseCSV(csvBlob("Latitude,Longitude\n40.7,-74"));
    expect(fc.features).toHaveLength(1);
  });

  it("name-based detection wins over sparse values", async () => {
    // lat column has 1 valid row out of 3 — would fail value heuristic, but
    // name-match should still pick it up.
    const fc = await parseCSV(
      csvBlob("lat,lng\n40.7,-74\n,\nfoo,bar"),
    );
    expect(fc.features).toHaveLength(1);
    expect(fc.features[0]!.geometry).toEqual({
      type: "Point",
      coordinates: [-74, 40.7],
    });
  });
});

describe("parseCSV — value-range detection", () => {
  it("detects coords by value when no coord headers", async () => {
    const rows = [
      "40.7,-74,foo",
      "34.0,-118,bar",
      "41.8,-87,baz",
      "29.7,-95,qux",
      "33.4,-112,a",
      "39.7,-104,b",
      "47.6,-122,c",
      "32.7,-117,d",
      "38.9,-77,e",
      "42.3,-71,f",
    ].join("\n");
    const fc = await parseCSV(csvBlob(`a,b,c\n${rows}`));
    expect(fc.features).toHaveLength(10);
    expect(fc.features[0]!.geometry).toEqual({
      type: "Point",
      coordinates: [-74, 40.7],
    });
    // c (the non-numeric column) should remain in properties.
    expect(fc.features[0]!.properties).toMatchObject({ c: "foo" });
  });

  it("80% threshold accepts ≥10 rows with 8/10 valid", async () => {
    // 10 rows, 8 with valid lat/lng, 2 with non-numeric in BOTH coord cols.
    const rows: string[] = [];
    for (let i = 0; i < 8; i++) rows.push(`${40 + i * 0.1},${-74 - i * 0.1}`);
    rows.push("foo,bar");
    rows.push("baz,qux");
    const fc = await parseCSV(csvBlob(`a,b\n${rows.join("\n")}`));
    expect(fc.features).toHaveLength(8);
  });

  it("80% threshold rejects ≥10 rows with only 7/10 valid", async () => {
    const rows: string[] = [];
    for (let i = 0; i < 7; i++) rows.push(`${40 + i * 0.1},${-74 - i * 0.1}`);
    for (let i = 0; i < 3; i++) rows.push(`foo${i},bar${i}`);
    await expect(parseCSV(csvBlob(`a,b\n${rows.join("\n")}`))).rejects.toThrow(
      CSVParseError,
    );
    await expect(
      parseCSV(csvBlob(`a,b\n${rows.join("\n")}`)),
    ).rejects.toMatchObject({ code: "NO_COORD_COLUMNS" });
  });

  it("100% threshold for <10 rows accepts all-valid", async () => {
    const rows = ["40.7,-74", "34.0,-118", "41.8,-87", "29.7,-95", "33.4,-112"];
    const fc = await parseCSV(csvBlob(`a,b\n${rows.join("\n")}`));
    expect(fc.features).toHaveLength(5);
  });

  it("100% threshold for <10 rows rejects 1-of-5 non-numeric", async () => {
    const rows = [
      "40.7,-74",
      "34.0,-118",
      "41.8,-87",
      "29.7,-95",
      "foo,bar",
    ];
    await expect(parseCSV(csvBlob(`a,b\n${rows.join("\n")}`))).rejects.toMatchObject(
      { code: "NO_COORD_COLUMNS" },
    );
  });

  it("threshold constants are 0.8 / 1.0", () => {
    expect(CSV_HEURISTIC_THRESHOLD).toBe(0.8);
    expect(CSV_HEURISTIC_THRESHOLD_SMALL_DATASET).toBe(1.0);
  });
});

describe("parseCSV — coordinate edge cases", () => {
  it("accepts Antarctica edge (lat=-89.99)", async () => {
    const fc = await parseCSV(csvBlob("lat,lng\n-89.99,0"));
    expect(fc.features).toHaveLength(1);
    expect(fc.features[0]!.geometry).toEqual({
      type: "Point",
      coordinates: [0, -89.99],
    });
  });

  it("accepts dateline edge (lng=179.99)", async () => {
    const fc = await parseCSV(csvBlob("lat,lng\n0,179.99"));
    expect(fc.features).toHaveLength(1);
    expect(fc.features[0]!.geometry).toEqual({
      type: "Point",
      coordinates: [179.99, 0],
    });
  });

  it("skips rows with out-of-range lng (180.01) when name-detected", async () => {
    // Name-detection picks the cols; out-of-range row drops at feature-build.
    const fc = await parseCSV(
      csvBlob("lat,lng\n40.7,-74\n0,180.01\n34.0,-118"),
    );
    expect(fc.features).toHaveLength(2);
  });

  it("does not let out-of-range value count toward column score (value-detection)", async () => {
    // 5 rows where col b has 1 out-of-range (180.01). With strict <10 row
    // threshold of 100%, that single out-of-range value should disqualify
    // the column (4/5 = 0.8 < 1.0).
    const rows = ["40.7,-74", "34.0,-118", "41.8,-87", "29.7,-95", "33.4,180.01"];
    await expect(parseCSV(csvBlob(`a,b\n${rows.join("\n")}`))).rejects.toMatchObject(
      { code: "NO_COORD_COLUMNS" },
    );
  });
});

describe("parseCSV — properties + address column", () => {
  it("captures address column name in _addressColumn_v1", async () => {
    const fc = await parseCSV(
      csvBlob("address,lat,lng\n123 Main,40,-74"),
    );
    expect(fc.features).toHaveLength(1);
    expect(fc.features[0]!.properties).toMatchObject({
      address: "123 Main",
      _addressColumn_v1: "address",
    });
  });

  it("recognises location/street/addr as address columns", async () => {
    for (const name of ["location", "street", "addr", "Address", "STREET"]) {
      const fc = await parseCSV(
        csvBlob(`${name},lat,lng\nfoo,40,-74`),
      );
      expect(fc.features[0]!.properties).toMatchObject({
        _addressColumn_v1: name,
      });
    }
  });

  it("omits _addressColumn_v1 when no address column", async () => {
    const fc = await parseCSV(csvBlob("lat,lng,name\n40,-74,NYC"));
    const props = fc.features[0]!.properties as Record<string, unknown>;
    expect("_addressColumn_v1" in props).toBe(false);
    expect(props["name"]).toBe("NYC");
  });

  it("preserves all non-coord columns on properties", async () => {
    const fc = await parseCSV(
      csvBlob("lat,lng,name,population,country\n40.7,-74,NYC,8000000,US"),
    );
    expect(fc.features[0]!.properties).toEqual({
      name: "NYC",
      population: "8000000",
      country: "US",
    });
  });
});

describe("parseCSV — error cases", () => {
  it("throws EMPTY_FILE for empty string", async () => {
    await expect(parseCSV(csvBlob(""))).rejects.toMatchObject({
      code: "EMPTY_FILE",
    });
  });

  it("throws EMPTY_FILE for header-only file", async () => {
    await expect(parseCSV(csvBlob("lat,lng\n"))).rejects.toMatchObject({
      code: "EMPTY_FILE",
    });
  });

  it("throws NO_COORD_COLUMNS when only text columns", async () => {
    const rows: string[] = [];
    for (let i = 0; i < 12; i++) rows.push(`name${i},city${i},desc${i}`);
    await expect(
      parseCSV(csvBlob(`name,city,desc\n${rows.join("\n")}`)),
    ).rejects.toMatchObject({ code: "NO_COORD_COLUMNS" });
  });

  it("CSVParseError exposes name + code", async () => {
    try {
      await parseCSV(csvBlob(""));
      throw new Error("expected throw");
    } catch (err) {
      expect(err).toBeInstanceOf(CSVParseError);
      expect((err as CSVParseError).name).toBe("CSVParseError");
      expect((err as CSVParseError).code).toBe("EMPTY_FILE");
    }
  });
});

describe("parseCSV — malformed-row tolerance", () => {
  it("skips rows with unparseable lat/lng without throwing", async () => {
    const fc = await parseCSV(
      csvBlob("lat,lng,name\n40.7,-74,NYC\nabc,xyz,bad\n34.0,-118,LA"),
    );
    expect(fc.features).toHaveLength(2);
    expect(fc.features.map((f) => (f.properties as { name: string }).name))
      .toEqual(["NYC", "LA"]);
  });

  it("skips rows with empty lat/lng", async () => {
    const fc = await parseCSV(
      csvBlob("lat,lng,name\n40.7,-74,NYC\n,,empty\n34.0,-118,LA"),
    );
    expect(fc.features).toHaveLength(2);
  });
});
