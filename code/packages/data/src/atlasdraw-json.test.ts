// SPDX-License-Identifier: MIT
// packages/data/src/atlasdraw-json.test.ts
// Phase 3 Wave 1 Task 4 — colocated tests for the pure-JSON variant.

import { describe, expect, it } from "vitest";

import { AtlasdrawJSONError, readJSON, writeJSON } from "./atlasdraw-json.js";

import type { FeatureCollection } from "geojson";

import type { AtlasdrawDocument, Manifest } from "./manifest-schema.js";

// 26-char Crockford base32 ULID — matches /^[0-9A-HJKMNP-TV-Z]{26}$/
const VALID_ULID = "01H5KZ9PWAJ7Q2VBYR3MNT4DEF";

const sampleFC: FeatureCollection = {
  type: "FeatureCollection",
  features: [
    {
      type: "Feature",
      geometry: { type: "Point", coordinates: [-122.4, 37.8] },
      properties: { name: "SF" },
    },
  ],
};

function synthDoc(
  overrides: Partial<AtlasdrawDocument> = {},
): AtlasdrawDocument {
  const manifest: Manifest = {
    id: VALID_ULID,
    version: 1,
    title: "Test Map",
    createdAt: "2026-05-03T00:00:00.000Z",
    updatedAt: "2026-05-03T00:00:00.000Z",
    basemap: { type: "registry", id: "default" },
    camera: { center: [0, 0], zoom: 2, bearing: 0, pitch: 0 },
    layers: [
      { kind: "annotation", id: "anno-1", label: "Notes", visible: true },
      {
        kind: "data",
        id: "dl:cities",
        label: "Cities",
        visible: true,
        featureCount: 1,
        style: { color: "#f00" },
        source: "data/layer-dl:cities.geojson",
      },
    ],
    permissions: { publicView: false },
  };

  return {
    manifest,
    scene: [
      {
        type: "rectangle",
        id: "el-1",
        version: 1,
        x: 0,
        y: 0,
        width: 10,
        height: 10,
      },
    ],
    layers: new Map<string, FeatureCollection>([["dl:cities", sampleFC]]),
    styleRef: { version: 8, name: "atlas-default" },
    files: new Map<string, Blob>(),
    ...overrides,
  };
}

describe("atlasdraw-json round-trip", () => {
  it("writeJSON + readJSON preserves manifest, scene, layers, styleRef", async () => {
    const doc = synthDoc();
    const blob = await writeJSON(doc);
    const round = await readJSON(blob);

    expect(round.manifest.id).toBe(doc.manifest.id);
    expect(round.scene).toEqual(doc.scene);
    expect(Array.from(round.layers.keys())).toEqual(["dl:cities"]);
    const fc = round.layers.get("dl:cities");
    expect(fc?.type).toBe("FeatureCollection");
    expect(fc?.features.length).toBe(1);
    expect(round.styleRef).toEqual({ version: 8, name: "atlas-default" });
  });

  it("output Blob has application/atlasdraw+json mime", async () => {
    const blob = await writeJSON(synthDoc());
    expect(blob.type).toBe("application/atlasdraw+json");
  });

  it("doc.files is always an empty Map after readJSON", async () => {
    const blob = await writeJSON(synthDoc());
    const round = await readJSON(blob);
    expect(round.files).toBeInstanceOf(Map);
    expect(round.files.size).toBe(0);
  });
});

describe("atlasdraw-json errors", () => {
  it("writeJSON throws HAS_BINARY_ATTACHMENTS when files is non-empty", async () => {
    const doc = synthDoc({
      files: new Map<string, Blob>([
        ["images/x.png", new Blob(["fake-png"], { type: "image/png" })],
      ]),
    });
    try {
      await writeJSON(doc);
      throw new Error("expected writeJSON to reject");
    } catch (err) {
      expect(err).toBeInstanceOf(AtlasdrawJSONError);
      expect((err as AtlasdrawJSONError).code).toBe("HAS_BINARY_ATTACHMENTS");
    }
  });

  it("readJSON on garbage body throws INVALID_JSON", async () => {
    const blob = new Blob(["not json {"], {
      type: "application/atlasdraw+json",
    });
    try {
      await readJSON(blob);
      throw new Error("expected readJSON to reject");
    } catch (err) {
      expect(err).toBeInstanceOf(AtlasdrawJSONError);
      expect((err as AtlasdrawJSONError).code).toBe("INVALID_JSON");
    }
  });

  it("readJSON on shape-mismatched body throws INVALID_STRUCTURE or INVALID_MANIFEST", async () => {
    const blob = new Blob([`{"manifest":"oops"}`], {
      type: "application/atlasdraw+json",
    });
    try {
      await readJSON(blob);
      throw new Error("expected readJSON to reject");
    } catch (err) {
      expect(err).toBeInstanceOf(AtlasdrawJSONError);
      const code = (err as AtlasdrawJSONError).code;
      expect(["INVALID_STRUCTURE", "INVALID_MANIFEST"]).toContain(code);
    }
  });

  it("readJSON throws INVALID_MANIFEST for valid structure but bad ULID", async () => {
    const doc = synthDoc();
    // Valid envelope shape, but the manifest's id is not a real ULID.
    const payload = {
      manifest: { ...doc.manifest, id: "not-a-ulid" },
      scene: doc.scene,
      layers: Object.fromEntries(doc.layers),
      styleRef: doc.styleRef ?? null,
    };
    const blob = new Blob([JSON.stringify(payload)], {
      type: "application/atlasdraw+json",
    });
    try {
      await readJSON(blob);
      throw new Error("expected readJSON to reject");
    } catch (err) {
      expect(err).toBeInstanceOf(AtlasdrawJSONError);
      expect((err as AtlasdrawJSONError).code).toBe("INVALID_MANIFEST");
    }
  });
});
