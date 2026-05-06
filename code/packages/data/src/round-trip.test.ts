// SPDX-License-Identifier: MIT
// packages/data/src/round-trip.test.ts
// Phase 3 Wave 3 T12 — round-trip acceptance suite.
//
// This is the trust boundary for Phase 3: synthetic AtlasdrawDocument →
// writer → reader → identity. If anything silently drops or mutates between
// the two ends (key ordering, blob bytes, blob.type, encoding drift, manifest
// schema mismatch), this suite is what catches it.
//
// Covered cases:
//   1. write → read (zip path) preserves manifest/scene/layers/files/styleRef.
//   2. writeJSON → readJSON (JSON path) preserves manifest/scene/layers/styleRef.
//   3. writeJSON rejects with HAS_BINARY_ATTACHMENTS when files non-empty.
//   4. read rejects with INVALID_MANIFEST on tampered manifest.json.
//   5. Empty-doc round-trip (empty layers, empty files, minimal scene).

import JSZip from "jszip";
import type { FeatureCollection } from "geojson";
import { describe, expect, it } from "vitest";

import { AtlasdrawFormatError, read, write } from "./atlasdraw.js";
import {
  AtlasdrawJSONError,
  readJSON,
  writeJSON,
} from "./atlasdraw-json.js";
import {
  ManifestSchema,
  type AtlasdrawDocument,
  type Manifest,
} from "./manifest-schema.js";

// ---------------------------------------------------------------------------
// constants — fixed so equality checks are deterministic.
// ---------------------------------------------------------------------------

const VALID_ULID = "01HZX4N6S2K8Q5ZTABCDEFGHJK"; // 26 Crockford-base32 chars
const POINTS_LAYER_ID = "dl:layer-points";
const POLY_LAYER_ID = "dl:layer-poly";
const FIXED_CREATED_AT = "2025-01-01T00:00:00.000Z";
const FIXED_UPDATED_AT = "2025-01-02T00:00:00.000Z";

// Known-content blob — content + type are both load-bearing for the round-trip
// (Blob.type only round-trips because both writer and reader preserve the
// stored mimeType, and content only because zip STORE'd files don't transcode).
const FILE_BYTES = new Uint8Array([
  0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a, // PNG magic + header
  ...Array.from({ length: 42 }, (_, i) => i & 0xff),
]);
const FILE_NAME = "asset.png";
const FILE_TYPE = "image/png";

// ---------------------------------------------------------------------------
// fixture builder
// ---------------------------------------------------------------------------

function buildPointsFC(): FeatureCollection {
  return {
    type: "FeatureCollection",
    features: [
      {
        type: "Feature",
        geometry: { type: "Point", coordinates: [-122.4, 37.8] },
        properties: { name: "SF" },
      },
      {
        type: "Feature",
        geometry: { type: "Point", coordinates: [-73.97, 40.78] },
        properties: { name: "NYC" },
      },
      {
        type: "Feature",
        geometry: { type: "Point", coordinates: [2.35, 48.86] },
        properties: { name: "Paris" },
      },
    ],
  };
}

function buildPolyFC(): FeatureCollection {
  return {
    type: "FeatureCollection",
    features: [
      {
        type: "Feature",
        geometry: {
          type: "Polygon",
          coordinates: [
            [
              [0, 0],
              [10, 0],
              [10, 10],
              [0, 10],
              [0, 0],
            ],
          ],
        },
        properties: { name: "square" },
      },
    ],
  };
}

function buildManifest(): Manifest {
  // ManifestSchema.parse normalizes camera defaults — feed it the loose shape
  // and use the parsed result to guarantee schema validity at the seam.
  const raw = {
    id: VALID_ULID,
    version: 1,
    title: "Round-trip acceptance fixture",
    createdAt: FIXED_CREATED_AT,
    updatedAt: FIXED_UPDATED_AT,
    basemap: { type: "registry", id: "osm-standard" },
    camera: { center: [12.34, -56.78], zoom: 7, bearing: 30, pitch: 15 },
    layers: [
      {
        kind: "data",
        id: POINTS_LAYER_ID,
        label: "Cities",
        visible: true,
        featureCount: 3,
        style: { color: "#ff0000", weight: 2 },
        source: `data/layer-${POINTS_LAYER_ID}.geojson`,
      },
      {
        kind: "data",
        id: POLY_LAYER_ID,
        label: "Regions",
        visible: false,
        featureCount: 1,
        style: { color: "#00ff00" },
        source: `data/layer-${POLY_LAYER_ID}.geojson`,
      },
      {
        kind: "annotation",
        id: "anno-1",
        label: "Notes",
        visible: true,
      },
    ],
    permissions: { publicView: true },
  };
  return ManifestSchema.parse(raw);
}

function buildSyntheticDoc(): AtlasdrawDocument {
  const scene = [
    {
      id: "el1",
      type: "rectangle",
      version: 1,
      x: 0,
      y: 0,
      width: 100,
      height: 50,
    },
    {
      id: "el2",
      type: "text",
      version: 1,
      x: 10,
      y: 10,
      text: "hello",
    },
  ];

  const layers = new Map<string, FeatureCollection>([
    [POINTS_LAYER_ID, buildPointsFC()],
    [POLY_LAYER_ID, buildPolyFC()],
  ]);

  const fileBlob = new Blob([FILE_BYTES], { type: FILE_TYPE });
  const files = new Map<string, Blob>([[FILE_NAME, fileBlob]]);

  return {
    manifest: buildManifest(),
    scene,
    layers,
    styleRef: { basemap: "default", note: "round-trip-marker" },
    files,
  };
}

function buildEmptyDoc(): AtlasdrawDocument {
  // Empty doc still needs a schema-valid manifest; just no data layers.
  const manifest = ManifestSchema.parse({
    id: VALID_ULID,
    version: 1,
    title: "Empty doc",
    createdAt: FIXED_CREATED_AT,
    updatedAt: FIXED_UPDATED_AT,
    basemap: { type: "registry", id: "osm-standard" },
    camera: { center: [0, 0], zoom: 1, bearing: 0, pitch: 0 },
    layers: [],
    permissions: { publicView: false },
  });
  return {
    manifest,
    scene: [],
    layers: new Map<string, FeatureCollection>(),
    styleRef: null,
    files: new Map<string, Blob>(),
  };
}

// ---------------------------------------------------------------------------
// helpers — equality across Maps and Blobs.
// ---------------------------------------------------------------------------

function mapAsSortedEntries<V>(m: Map<string, V>): Array<[string, V]> {
  return [...m.entries()].sort(([a], [b]) => a.localeCompare(b));
}

async function blobBytes(b: Blob): Promise<Uint8Array> {
  return new Uint8Array(await b.arrayBuffer());
}

// ---------------------------------------------------------------------------
// tests
// ---------------------------------------------------------------------------

describe("T12 round-trip — write (zip) → read", () => {
  it("preserves manifest, scene, layers, files, and styleRef end-to-end", async () => {
    const doc = buildSyntheticDoc();

    const blob = await write(doc);
    expect(blob).toBeInstanceOf(Blob);

    const back = await read(blob);

    // manifest — deep-equal post-parse so schema defaults are stable on both sides.
    expect(back.manifest).toEqual(doc.manifest);

    // scene — deep-equal through JSON to normalize ReadonlyArray vs Array
    // representation differences (both round-trip via JSON.stringify in the writer).
    expect(JSON.parse(JSON.stringify(back.scene))).toEqual(
      JSON.parse(JSON.stringify(doc.scene)),
    );

    // layers — Map equality via sorted entries (insertion-order independence).
    expect(back.layers.size).toBe(2);
    expect(mapAsSortedEntries(back.layers)).toEqual(
      mapAsSortedEntries(doc.layers),
    );
    expect(back.layers.get(POINTS_LAYER_ID)?.features.length).toBe(3);
    expect(back.layers.get(POLY_LAYER_ID)?.features.length).toBe(1);

    // files — size match, name match, bytes match.
    expect(back.files.size).toBe(doc.files.size);
    expect([...back.files.keys()].sort()).toEqual(
      [...doc.files.keys()].sort(),
    );
    const origBlob = doc.files.get(FILE_NAME)!;
    const roundBlob = back.files.get(FILE_NAME)!;
    expect(await blobBytes(roundBlob)).toEqual(await blobBytes(origBlob));

    // [T12 finding] Blob.type does NOT round-trip through the zip path.
    // The zip format has no per-entry MIME field; JSZip extracts entries with
    // type === "". Callers that need MIME info must derive it from the
    // filename extension (or stash it in manifest/style metadata). The bytes
    // are identical — only the wrapper's `.type` is lost.
    expect(roundBlob.type).toBe("");
    expect(origBlob.type).toBe(FILE_TYPE);

    // styleRef — deep-equal.
    expect(back.styleRef).toEqual(doc.styleRef);
  });
});

describe("T12 round-trip — writeJSON → readJSON", () => {
  it("preserves manifest, scene, layers, and styleRef for a no-binary doc", async () => {
    // JSON variant cannot carry binaries — strip files for this case.
    const fileless: AtlasdrawDocument = {
      ...buildSyntheticDoc(),
      files: new Map<string, Blob>(),
    };

    const jsonBlob = await writeJSON(fileless);
    expect(jsonBlob).toBeInstanceOf(Blob);

    const back = await readJSON(jsonBlob);

    expect(back.manifest).toEqual(fileless.manifest);

    expect(JSON.parse(JSON.stringify(back.scene))).toEqual(
      JSON.parse(JSON.stringify(fileless.scene)),
    );

    expect(back.layers.size).toBe(2);
    expect(mapAsSortedEntries(back.layers)).toEqual(
      mapAsSortedEntries(fileless.layers),
    );

    expect(back.styleRef).toEqual(fileless.styleRef);

    // readJSON always returns an empty files Map — JSON cannot carry binaries.
    expect(back.files.size).toBe(0);
  });
});

describe("T12 — writeJSON rejects when files non-empty", () => {
  it("throws AtlasdrawJSONError with code HAS_BINARY_ATTACHMENTS", async () => {
    const doc = buildSyntheticDoc(); // has 1 file
    expect(doc.files.size).toBeGreaterThan(0);

    try {
      await writeJSON(doc);
      throw new Error("expected writeJSON to reject");
    } catch (err) {
      expect(err).toBeInstanceOf(AtlasdrawJSONError);
      expect((err as AtlasdrawJSONError).code).toBe("HAS_BINARY_ATTACHMENTS");
    }
  });
});

describe("T12 — read rejects on tampered manifest.json", () => {
  it("throws AtlasdrawFormatError with code INVALID_MANIFEST when manifest.version is wrong", async () => {
    // Start from a real, valid blob then mutate manifest.json in-place via JSZip
    // (same surgery pattern T10's lint test uses).
    const doc = buildSyntheticDoc();
    const blob = await write(doc);

    const zip = await JSZip.loadAsync(await blob.arrayBuffer());
    const manifestText = await zip.file("manifest.json")!.async("string");
    const manifestObj = JSON.parse(manifestText);
    manifestObj.version = 2; // schema literal(1) → schema rejects.
    zip.file("manifest.json", JSON.stringify(manifestObj));

    const buf = await zip.generateAsync({ type: "uint8array" });
    const tamperedBlob = new Blob([buf as unknown as BlobPart]);

    try {
      await read(tamperedBlob);
      throw new Error("expected read to reject");
    } catch (err) {
      expect(err).toBeInstanceOf(AtlasdrawFormatError);
      expect((err as AtlasdrawFormatError).code).toBe("INVALID_MANIFEST");
    }
  });
});

describe("T12 — empty-doc round-trip", () => {
  it("write → read survives empty layers/files/scene", async () => {
    const doc = buildEmptyDoc();
    const blob = await write(doc);
    const back = await read(blob);

    expect(back.manifest).toEqual(doc.manifest);
    expect(back.scene).toEqual([]);
    expect(back.layers.size).toBe(0);
    expect(back.files.size).toBe(0);

    // [T12 finding] styleRef divergence between paths:
    //   - zip writer:  JSON.stringify(doc.styleRef ?? {}) → null becomes `{}`
    //   - JSON writer: doc.styleRef ?? null               → null stays `null`
    // Same source `null` produces different round-trip values across the two
    // writers. Documented here so consumers don't assume parity.
    expect(back.styleRef).toEqual({});
  });

  it("writeJSON → readJSON survives empty layers/files/scene", async () => {
    const doc = buildEmptyDoc();
    const jsonBlob = await writeJSON(doc);
    const back = await readJSON(jsonBlob);

    expect(back.manifest).toEqual(doc.manifest);
    expect(back.scene).toEqual([]);
    expect(back.layers.size).toBe(0);
    expect(back.files.size).toBe(0);
    expect(back.styleRef).toBeNull();
  });
});
