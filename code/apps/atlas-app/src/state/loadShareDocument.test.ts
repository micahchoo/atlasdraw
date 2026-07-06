// SPDX-License-Identifier: AGPL-3.0-only
// Unit tests for the shared read-only document loader (ShareView + EmbedView).
import { describe, it, expect } from "vitest";
import LZString from "lz-string";

import {
  ShareExpiredError,
  type HttpStorageClient,
} from "../services/createHttpStorageClient";

import {
  decodeHashDoc,
  tokenFromPath,
  loadShareDocument,
} from "./loadShareDocument";

const sampleDoc = {
  manifest: {
    id: "01ARZ3NDEKTSV4RRFFQ69G5FAV",
    camera: { center: [0, 0], zoom: 1 },
  },
  scene: [],
};
const hashFor = (doc: unknown) =>
  `#v1:${LZString.compressToBase64(JSON.stringify(doc))}`;

// A 21-char token in the accepted charset.
const TOKEN = "abcdefghij_klmnop-qrs";

describe("decodeHashDoc", () => {
  it("round-trips a v1 hash", () => {
    expect(decodeHashDoc(hashFor(sampleDoc))).toEqual(sampleDoc);
  });

  it("rejects an unsupported version prefix", () => {
    expect(() => decodeHashDoc("#v2:abc")).toThrow(/Unsupported/);
  });

  it("rejects a payload that isn't a JSON document", () => {
    const bad = `#v1:${LZString.compressToBase64("not json{{")}`;
    expect(() => decodeHashDoc(bad)).toThrow();
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
    expect(r).toEqual({ kind: "ready", doc: sampleDoc });
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
