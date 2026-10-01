// SPDX-License-Identifier: AGPL-3.0-only
// Unit tests for the shared read-only document loader (ShareView + EmbedView).
import { describe, it, expect } from "vitest";
import LZString from "lz-string";

import { uint8ArrayToBase64Url, write } from "@atlasdraw/data";

import {
  ShareExpiredError,
  type HttpStorageClient,
} from "../services/createHttpStorageClient";

import {
  decodeHashDoc,
  tokenFromPath,
  loadShareDocument,
} from "./loadShareDocument";
import {
  savedDocument,
  savedManifest,
} from "./__tests__/fixtures/documentWorld";

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
  scene: [{ id: "rect-1", type: "rectangle", version: 1 }],
};
const hashFor = (doc: unknown) =>
  `#v1:${LZString.compressToBase64(JSON.stringify(doc))}`;

// A 21-char token in the accepted charset.
const TOKEN = "abcdefghij_klmnop-qrs";

describe("decodeHashDoc", () => {
  it("reads a v1 hash through the migrations: the manifest and the drawing", async () => {
    const doc = await decodeHashDoc(hashFor(sampleDoc));

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
      layers: new Map([["dl:wells", fc]]),
      files: new Map([["img-1", new Blob(["png"])]]),
    });
    const bytes = await blobBytes(await write(source));

    const doc = await decodeHashDoc(`#v2:${uint8ArrayToBase64Url(bytes)}`);

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

describe("tokenFromPath", () => {
  it("extracts a token under the given prefix", () => {
    expect(tokenFromPath(`/embed/${TOKEN}`, "/embed/")).toBe(TOKEN);
    expect(tokenFromPath(`/m/${TOKEN}`, "/m/")).toBe(TOKEN);
  });

  it("returns null for a mismatched prefix, wrong length, or bare prefix", () => {
    expect(tokenFromPath(`/embed/${TOKEN}`, "/m/")).toBeNull();
    expect(tokenFromPath("/embed/short", "/embed/")).toBeNull();
    expect(tokenFromPath("/embed", "/embed/")).toBeNull();
  });
});

describe("loadShareDocument", () => {
  it("resolves a hash document (hash wins over token)", async () => {
    const r = await loadShareDocument(hashFor(sampleDoc), TOKEN);
    expect(r.kind).toBe("ready");
    expect(r.kind === "ready" && r.doc.manifest.id).toBe(sampleDoc.manifest.id);
  });

  it("returns an error for a corrupt hash", async () => {
    const r = await loadShareDocument(
      `#v1:${LZString.compressToBase64("not json{{")}`,
      null,
    );
    expect(r.kind).toBe("error");
  });

  it("returns an error when neither hash nor token is present", async () => {
    const r = await loadShareDocument("", null);
    expect(r).toEqual({ kind: "error", message: "Invalid share link." });
  });

  it("maps a missing blob (null) to not-found", async () => {
    const client = {
      getShareBlob: async () => null,
    } as unknown as HttpStorageClient;
    const r = await loadShareDocument("", TOKEN, client);
    expect(r.kind).toBe("not-found");
  });

  it("maps ShareExpiredError to expired", async () => {
    const client = {
      getShareBlob: async () => {
        throw new ShareExpiredError();
      },
    } as unknown as HttpStorageClient;
    const r = await loadShareDocument("", TOKEN, client);
    expect(r.kind).toBe("expired");
  });

  it("maps an unexpected fetch failure to error", async () => {
    const client = {
      getShareBlob: async () => {
        throw new Error("network down");
      },
    } as unknown as HttpStorageClient;
    const r = await loadShareDocument("", TOKEN, client);
    expect(r).toEqual({ kind: "error", message: "network down" });
  });
});
