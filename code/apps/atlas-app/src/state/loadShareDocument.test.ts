// SPDX-License-Identifier: AGPL-3.0-only
// The read-only viewer's document loader.
import { describe, it, expect } from "vitest";
import LZString from "lz-string";

import { uint8ArrayToBase64Url, write } from "@atlasdraw/data";

import {
  ShareExpiredError,
  type HttpStorageClient,
} from "../services/createHttpStorageClient";

import { decodeHashDoc, loadShareDocument } from "./loadShareDocument";
import {
  geoRect,
  savedDocument,
  savedManifest,
} from "./__tests__/fixtures/documentWorld";
import { PNG_BYTES } from "./__tests__/fixtures/admitted";

/** A Blob's bytes; jsdom's Blob has no arrayBuffer(). */
function blobBytes(blob: Blob): Promise<Uint8Array> {
  return new Promise((resolve, reject) => {
    const reader = new FileReader();
    reader.onload = () => resolve(new Uint8Array(reader.result as ArrayBuffer));
    reader.onerror = () => reject(reader.error);
    reader.readAsArrayBuffer(blob);
  });
}

// A link made before v2: a v1 manifest and the drawing, as JSON.
const sampleDoc = {
  manifest: savedManifest(),
  scene: [geoRect("rect-1")],
};
const hashFor = (doc: unknown) =>
  `#v1:${LZString.compressToBase64(JSON.stringify(doc))}`;

// A 21-char token in the accepted charset.
const TOKEN = "abcdefghij_klmnop-qrs";

describe("decodeHashDoc", () => {
  it("reads a v1 hash through the migrations: the manifest and the drawing", async () => {
    const { doc } = await decodeHashDoc(hashFor(sampleDoc));

    expect(doc.manifest.id).toBe(sampleDoc.manifest.id);
    expect(doc.manifest.version).toBe(2);
    expect(doc.manifest.layers).toEqual([]);
    expect(doc.scene.map((e) => e.id)).toEqual(["rect-1"]);
    expect(doc.layers).toEqual(new Map());
    expect(doc.files).toEqual(new Map());
  });

  it("reads a v2 hash: the document's own bytes, layers and files included", async () => {
    const fc = {
      type: "FeatureCollection" as const,
      features: [],
    };
    const source = savedDocument({
      manifest: savedManifest({
        layers: [
          {
            kind: "data",
            id: "dl:wells",
            label: "Wells",
            visible: true,
            featureCount: 0,
            style: {},
            source: "data/layer-dl:wells.geojson",
          },
        ] as never,
      }),
      scene: [
        geoRect("rect-1"),
        { ...geoRect("pic"), type: "image", fileId: "img-1" },
      ] as never,
      layers: new Map([["dl:wells", fc]]),
      files: new Map([["img-1", new Blob([PNG_BYTES])]]),
    });
    const bytes = await blobBytes(await write(source));

    const { doc } = await decodeHashDoc(`#v2:${uint8ArrayToBase64Url(bytes)}`);

    expect(doc.manifest.id).toBe(source.manifest.id);
    expect(doc.layers.get("dl:wells")).toEqual(fc);
    expect(doc.files.has("img-1")).toBe(true);
  });

  it("rejects an unsupported version prefix", async () => {
    await expect(decodeHashDoc("#v9:abc")).rejects.toThrow(/Unsupported/);
  });

  it("rejects a payload that isn't a JSON document", async () => {
    const bad = `#v1:${LZString.compressToBase64("not json{{")}`;
    await expect(decodeHashDoc(bad)).rejects.toThrow();
  });

  it("rejects a v1 payload whose manifest is not a manifest", async () => {
    const bad = hashFor({ manifest: { id: "x" }, scene: [] });
    await expect(decodeHashDoc(bad)).rejects.toThrow(/Corrupted/);
  });
});

describe("loadShareDocument", () => {
  it("resolves a hash document", async () => {
    const r = await loadShareDocument({ hash: hashFor(sampleDoc).slice(1) });
    expect(r.kind).toBe("ready");
    expect(r.kind === "ready" && r.admitted.doc.manifest.id).toBe(
      sampleDoc.manifest.id,
    );
  });

  it("returns an error for a corrupt hash", async () => {
    const r = await loadShareDocument({
      hash: `v1:${LZString.compressToBase64("not json{{")}`,
    });
    expect(r.kind).toBe("error");
  });

  it("returns an error for a damaged link", async () => {
    const r = await loadShareDocument(null);
    expect(r).toEqual({ kind: "error", message: "Invalid share link." });
  });

  it("maps a missing blob (null) to not-found", async () => {
    const client = {
      getShareBlob: async () => null,
    } as unknown as HttpStorageClient;
    const r = await loadShareDocument({ token: TOKEN }, client);
    expect(r.kind).toBe("not-found");
  });

  it("maps ShareExpiredError to expired", async () => {
    const client = {
      getShareBlob: async () => {
        throw new ShareExpiredError();
      },
    } as unknown as HttpStorageClient;
    const r = await loadShareDocument({ token: TOKEN }, client);
    expect(r.kind).toBe("expired");
  });

  it("maps an unexpected fetch failure to error", async () => {
    const client = {
      getShareBlob: async () => {
        throw new Error("network down");
      },
    } as unknown as HttpStorageClient;
    const r = await loadShareDocument({ token: TOKEN }, client);
    expect(r).toEqual({ kind: "error", message: "network down" });
  });
});
